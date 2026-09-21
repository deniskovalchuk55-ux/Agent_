// Aware Agent — Telegram bot webhook
// Endpoint: /api/webhook — Telegram шле сюди всі повідомлення.

const BOT_TOKEN = process.env.BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_TG_ID = parseInt(process.env.OWNER_TG_ID); // тільки ти можеш писати
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const CLAUDE_MAX_TOKENS = 2048;
const HISTORY_LIMIT = 30; // скільки останніх повідомлень тримати в контексті

// ==================== HELPERS ====================

async function tgSend(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'HTML', ...extra };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function tgGetFile(fileId) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  const j = await r.json();
  if (!j.ok) throw new Error('getFile failed');
  const path = j.result.file_path;
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`;
  const fileR = await fetch(url);
  return Buffer.from(await fileR.arrayBuffer());
}

async function sb(method, path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Supabase ${r.status}: ${err}`);
  }
  return r.status === 204 ? null : r.json();
}

// ==================== ПАМʼЯТЬ ====================

async function saveMessage(tgId, role, content) {
  await sb('POST', 'messages', { tg_id: tgId, role, content });
}

async function loadHistory(tgId) {
  const rows = await sb('GET', `messages?tg_id=eq.${tgId}&order=created_at.desc&limit=${HISTORY_LIMIT}`);
  return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

// ==================== ЗАДАЧІ ====================

async function addTask(tgId, title, priority = 'yellow') {
  const [row] = await sb('POST', 'tasks', { tg_id: tgId, title, priority });
  return row;
}

async function listTasks(tgId) {
  return sb('GET', `tasks?tg_id=eq.${tgId}&status=eq.active&order=priority.asc,created_at.desc`);
}

async function completeTask(tgId, id) {
  return sb('PATCH', `tasks?id=eq.${id}&tg_id=eq.${tgId}`, {
    status: 'done',
    completed_at: new Date().toISOString()
  });
}

// ==================== НАГАДУВАННЯ ====================

async function addReminder(tgId, text, remindAt) {
  return sb('POST', 'reminders', { tg_id: tgId, text, remind_at: remindAt });
}

// ==================== ІДЕЇ ====================

async function saveIdea(tgId, rawText, structured) {
  return sb('POST', 'ideas', { tg_id: tgId, raw_text: rawText, structured });
}

// ==================== WHISPER (голос → текст) ====================

async function transcribeVoice(fileId) {
  const audioBuffer = await tgGetFile(fileId);
  // Використовуємо OpenAI Whisper через їхній API, або можна Groq (безкоштовно)
  // Тимчасово — просто скажемо "голосові в наступному пакеті"
  // Треба ключ OPENAI_API_KEY або GROQ_API_KEY
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return null;
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'uk');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: form
  });
  const j = await r.json();
  return j.text;
}

// ==================== CLAUDE ====================

const SYSTEM_PROMPT = `Ти персональний асистент користувача на імʼя Денис. Спілкуєшся українською.

Твої функції:
1. Спілкування — відповідаєш на будь-які питання, допомагаєш думати, розкладаєш ідеї по поличках.
2. Задачі — коли Денис каже додати задачу, ти маєш викликати функцію ADD_TASK.
3. Нагадування — коли просить нагадати про щось на певний час — виклик ADD_REMINDER.
4. Ідеї — коли скидає ідею, розклади її на: суть, плюси, мінуси, наступні кроки.

Формат виклику функцій — просто спеціальний блок у відповіді:
[ACTION:ADD_TASK title="назва" priority="red|yellow|green"]
[ACTION:ADD_REMINDER text="що" at="2026-01-15T14:30:00+02:00"]
[ACTION:LIST_TASKS]
[ACTION:COMPLETE_TASK id=123]

Пріоритети задач:
- red = цього тижня
- yellow = цього місяця (default)
- green = 3 місяці

Пиши коротко і по суті. Не давай зайвих порад. Дениса цінуєш за прямоту.`;

async function askClaude(history) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: history
    })
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.content[0].text;
}

// ==================== ОБРОБКА ACTION-БЛОКІВ ====================

async function processActions(tgId, replyText) {
  const actions = [];
  const cleanText = replyText.replace(/\[ACTION:([^\]]+)\]/g, (_, body) => {
    actions.push(body);
    return '';
  }).trim();

  const executed = [];
  for (const act of actions) {
    try {
      if (act.startsWith('ADD_TASK')) {
        const title = /title="([^"]+)"/.exec(act)?.[1];
        const priority = /priority="(red|yellow|green)"/.exec(act)?.[1] || 'yellow';
        if (title) {
          const t = await addTask(tgId, title, priority);
          executed.push(`✅ Задача додана: ${priorityEmoji(priority)} ${title}`);
        }
      } else if (act.startsWith('ADD_REMINDER')) {
        const text = /text="([^"]+)"/.exec(act)?.[1];
        const at = /at="([^"]+)"/.exec(act)?.[1];
        if (text && at) {
          await addReminder(tgId, text, at);
          executed.push(`⏰ Нагадаю: ${text} (${new Date(at).toLocaleString('uk-UA')})`);
        }
      } else if (act.startsWith('LIST_TASKS')) {
        const tasks = await listTasks(tgId);
        if (tasks.length === 0) {
          executed.push('📋 Активних задач немає');
        } else {
          const grouped = { red: [], yellow: [], green: [] };
          for (const t of tasks) grouped[t.priority || 'yellow'].push(t);
          let out = '📋 <b>Твої задачі:</b>\n';
          if (grouped.red.length) out += '\n🔴 <b>Цього тижня:</b>\n' + grouped.red.map(t => `  • ${t.title} <i>(#${t.id})</i>`).join('\n');
          if (grouped.yellow.length) out += '\n🟡 <b>Цього місяця:</b>\n' + grouped.yellow.map(t => `  • ${t.title} <i>(#${t.id})</i>`).join('\n');
          if (grouped.green.length) out += '\n🟢 <b>Далі:</b>\n' + grouped.green.map(t => `  • ${t.title} <i>(#${t.id})</i>`).join('\n');
          executed.push(out);
        }
      } else if (act.startsWith('COMPLETE_TASK')) {
        const id = parseInt(/id=(\d+)/.exec(act)?.[1]);
        if (id) {
          await completeTask(tgId, id);
          executed.push(`✅ Задача #${id} виконана`);
        }
      }
    } catch (e) {
      executed.push(`⚠️ Помилка: ${e.message}`);
    }
  }

  const finalText = [cleanText, ...executed].filter(Boolean).join('\n\n');
  return finalText || '✓';
}

function priorityEmoji(p) {
  return { red: '🔴', yellow: '🟡', green: '🟢' }[p] || '🟡';
}

// ==================== ГОЛОВНИЙ WEBHOOK ====================

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const update = req.body;
    const msg = update.message || update.edited_message;
    if (!msg) return res.status(200).send('OK');

    const tgId = msg.from.id;
    const chatId = msg.chat.id;

    // Захист: тільки власник може писати
    if (tgId !== OWNER_TG_ID) {
      await tgSend(chatId, 'Цей бот приватний.');
      return res.status(200).send('OK');
    }

    // Швидкі команди
    if (msg.text === '/start') {
      await tgSend(chatId, '👋 Привіт, Денисе! Я твій персональний асистент.\n\nМожу:\n• Спілкуватись і думати разом\n• Записувати задачі 🔴🟡🟢\n• Нагадувати про важливе\n• Розкладати ідеї по поличках\n\nПиши як з другом.');
      return res.status(200).send('OK');
    }

    // Отримуємо текст (з тексту або з голосового)
    let userText = msg.text;
    if (!userText && msg.voice) {
      await tgSend(chatId, '🎤 Слухаю голосове...');
      userText = await transcribeVoice(msg.voice.file_id);
      if (!userText) {
        await tgSend(chatId, '⚠️ Голосові поки не працюють. Додай OPENAI_API_KEY у Vercel ENV.');
        return res.status(200).send('OK');
      }
      await tgSend(chatId, `📝 <i>Розшифровка:</i>\n${userText}`);
    }

    if (!userText) {
      return res.status(200).send('OK');
    }

    // Зберігаємо повідомлення юзера
    await saveMessage(tgId, 'user', userText);

    // Тягнемо історію + шлемо Claude
    const history = await loadHistory(tgId);
    const rawReply = await askClaude(history);

    // Обробляємо action-блоки і формуємо фінальний текст
    const finalReply = await processActions(tgId, rawReply);

    // Зберігаємо відповідь
    await saveMessage(tgId, 'assistant', rawReply);

    // Шлемо юзеру
    await tgSend(chatId, finalReply);

    return res.status(200).send('OK');
  } catch (e) {
    console.error(e);
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) await tgSend(chatId, `⚠️ Помилка: ${e.message}`);
    } catch(_) {}
    return res.status(200).send('OK');
  }
};
