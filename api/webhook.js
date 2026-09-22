// Aware Agent — Telegram bot webhook
// Endpoint: /api/webhook — Telegram шле сюди всі повідомлення.

const BOT_TOKEN = process.env.BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_TG_ID = parseInt(process.env.OWNER_TG_ID);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_MAX_TOKENS = 2048;
const HISTORY_LIMIT = 30;

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

async function deleteTask(tgId, id) {
  return sb('DELETE', `tasks?id=eq.${id}&tg_id=eq.${tgId}`);
}

async function editTask(tgId, id, patch) {
  return sb('PATCH', `tasks?id=eq.${id}&tg_id=eq.${tgId}`, patch);
}

// ==================== НАГАДУВАННЯ ====================

async function addReminder(tgId, text, remindAt) {
  const [row] = await sb('POST', 'reminders', { tg_id: tgId, text, remind_at: remindAt });
  return row;
}

async function listReminders(tgId) {
  return sb('GET', `reminders?tg_id=eq.${tgId}&sent=eq.false&order=remind_at.asc`);
}

async function deleteReminder(tgId, id) {
  return sb('DELETE', `reminders?id=eq.${id}&tg_id=eq.${tgId}`);
}

async function editReminder(tgId, id, patch) {
  return sb('PATCH', `reminders?id=eq.${id}&tg_id=eq.${tgId}`, patch);
}

// ==================== ІДЕЇ ====================

async function saveIdea(tgId, rawText, structured) {
  return sb('POST', 'ideas', { tg_id: tgId, raw_text: rawText, structured });
}

async function listIdeas(tgId) {
  return sb('GET', `ideas?tg_id=eq.${tgId}&order=created_at.desc&limit=20`);
}

async function deleteIdea(tgId, id) {
  return sb('DELETE', `ideas?id=eq.${id}&tg_id=eq.${tgId}`);
}

// ==================== WHISPER ====================

async function transcribeVoice(fileId) {
  const audioBuffer = await tgGetFile(fileId);
  const GROQ_KEY = process.env.GROQ_API_KEY;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  // 1. Спочатку пробуємо Groq (безкоштовно, швидко)
  if (GROQ_KEY) {
    try {
      const form = new FormData();
      form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
      form.append('model', 'whisper-large-v3-turbo');
      form.append('language', 'uk');
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
        body: form
      });
      const j = await r.json();
      if (j.text) return j.text;
    } catch(e) { console.error('Groq failed:', e); }
  }

  // 2. Fallback на OpenAI (платно)
  if (OPENAI_KEY) {
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
  return null;
}

// Отримати фото з Telegram і повернути base64 + mime
async function tgGetPhotoBase64(fileId) {
  const buf = await tgGetFile(fileId);
  const b64 = Buffer.from(buf).toString('base64');
  // Telegram завжди JPEG для фото
  return { data: b64, mediaType: 'image/jpeg' };
}


// ==================== NOTION ====================

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_EXPENSES = process.env.DB_EXPENSES;
const DB_INCOMES = process.env.DB_INCOMES;
const DB_CAT_EXPENSES = process.env.DB_CAT_EXPENSES;
const DB_CAT_INCOMES = process.env.DB_CAT_INCOMES;

async function notionCall(path, method = 'POST', body = null) {
  if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN not set');
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://api.notion.com/v1/${path}`, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(`Notion ${r.status}: ${j.message || JSON.stringify(j)}`);
  return j;
}

// Читаємо всі категорії з бази (враховує пагінацію)
async function notionQueryAll(dbId) {
  let results = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const j = await notionCall(`databases/${dbId}/query`, 'POST', body);
    results = results.concat(j.results || []);
    if (!j.has_more) break;
    cursor = j.next_cursor;
  }
  return results;
}

function parseCat(page) {
  const props = page.properties;
  const title = props['Назва']?.title?.map(t => t.plain_text).join('').trim() || '';
  const shared = props['Загальна']?.checkbox || false;
  const tgId = props['Telegram ID']?.number || null;
  return { id: page.id, name: title, shared, tgId };
}

// Список категорій витрат/доходів для юзера (свої + shared)
async function listCategories(dbId, tgId) {
  const rows = await notionQueryAll(dbId);
  return rows.map(parseCat).filter(c => c.shared || c.tgId === tgId);
}

async function createCategory(dbId, tgId, name, shared = false) {
  const body = {
    parent: { database_id: dbId },
    properties: {
      'Назва': { title: [{ text: { content: name } }] },
      'Загальна': { checkbox: shared },
      'Telegram ID': { number: shared ? null : tgId }
    }
  };
  const j = await notionCall('pages', 'POST', body);
  return parseCat(j);
}

async function createExpense(tgId, { amount, currency, date, categoryId, note }) {
  const body = {
    parent: { database_id: DB_EXPENSES },
    properties: {
      'Назва': { title: [{ text: { content: note || 'без назви' } }] },
      'Сума': { number: amount },
      'Валюта': { select: { name: currency } },
      'Дата': { date: { start: date } },
      'Категорія': { relation: categoryId ? [{ id: categoryId }] : [] },
      'Опис': { rich_text: note ? [{ text: { content: note } }] : [] },
      'Telegram ID': { number: tgId }
    }
  };
  return notionCall('pages', 'POST', body);
}

async function createIncome(tgId, { amount, currency, date, categoryId, note }) {
  const body = {
    parent: { database_id: DB_INCOMES },
    properties: {
      'Назва': { title: [{ text: { content: note || 'без назви' } }] },
      'Сума': { number: amount },
      'Валюта': { select: { name: currency } },
      'Дата': { date: { start: date } },
      'Категорія': { relation: categoryId ? [{ id: categoryId }] : [] },
      'Опис': { rich_text: note ? [{ text: { content: note } }] : [] },
      'Telegram ID': { number: tgId }
    }
  };
  return notionCall('pages', 'POST', body);
}

// Знайти категорію по назві (case-insensitive, з fuzzy)
function findCategory(cats, query) {
  const q = query.toLowerCase().trim();
  return cats.find(c => c.name.toLowerCase() === q)
      || cats.find(c => c.name.toLowerCase().includes(q))
      || cats.find(c => q.includes(c.name.toLowerCase()));
}

// ==================== CLAUDE ====================

function nowKievString() {
  // Формуємо ISO 8601 з тайм-зоною Kyiv, а не toLocaleString
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(now);
  const get = (t) => parts.find(p => p.type === t)?.value || '00';
  const y = get('year'), m = get('month'), d = get('day');
  const h = get('hour'), min = get('minute'), s = get('second');
  // Визначаємо offset (+02 або +03)
  const janOffset = -new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const julOffset = -new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  // приблизно: Kyiv літом +03, взимку +02
  const nowLocalStr = now.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' });
  const nowLocal = new Date(nowLocalStr);
  const nowUtc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMinutes = (nowLocal - nowUtc) / 60000;
  const offH = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const offM = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const iso = `${y}-${m}-${d}T${h}:${min}:${s}${sign}${offH}:${offM}`;
  const weekday = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Warsaw', weekday: 'long' }).format(now);
  return `${iso} (${weekday})`;
}

const SYSTEM_PROMPT = `Ти персональний асистент користувача на імʼя Денис. Спілкуєшся українською.

⚠️ ПОТОЧНИЙ ЧАС (Europe/Warsaw): ${nowKievString()}
Використовуй цей час як точку відліку для "сьогодні", "завтра", "через годину" тощо.
Часовий пояс користувача: Europe/Warsaw (літом UTC+03:00, взимку UTC+02:00).

Твої функції:
1. Спілкування — відповідаєш на питання, допомагаєш думати, розкладаєш ідеї.
2. Задачі — додавання, показ, виконання, редагування, видалення.
3. Нагадування — на конкретний час, показ, видалення, редагування.
4. Ідеї — розкладати структурно, зберігати, показувати.

Формат виклику функцій (кілька можна в одній відповіді):

ЗАДАЧІ:
[ACTION:ADD_TASK title="назва" priority="red|yellow|green"]
[ACTION:LIST_TASKS]
[ACTION:COMPLETE_TASK id=123]
[ACTION:DELETE_TASK id=123]
[ACTION:EDIT_TASK id=123 title="нова назва" priority="red|yellow|green"]

НАГАДУВАННЯ:
[ACTION:ADD_REMINDER text="що" at="ISO_ДАТА"]
[ACTION:LIST_REMINDERS]
[ACTION:DELETE_REMINDER id=123]
[ACTION:EDIT_REMINDER id=123 text="новий текст" at="ISO_ДАТА"]

ІДЕЇ:
[ACTION:SAVE_IDEA raw="як казав користувач" structured="твоя розкладка"]
[ACTION:LIST_IDEAS]
[ACTION:DELETE_IDEA id=123]

ФІНАНСИ (Notion):
[ACTION:LIST_EXPENSE_CATEGORIES] — показує тобі список категорій витрат з Notion
[ACTION:LIST_INCOME_CATEGORIES] — показує список категорій доходів
[ACTION:ADD_EXPENSE amount=60 currency="UAH" date="2026-09-22" category="Кава" note="кава вранці"]
[ACTION:ADD_INCOME amount=500 currency="UAH" date="2026-09-22" category="Робота" note="Іван оплатив"]
[ACTION:CREATE_EXPENSE_CATEGORY name="Кава"] — тільки після згоди юзера
[ACTION:CREATE_INCOME_CATEGORY name="Фріланс"] — тільки після згоди юзера

🏦 ПРАВИЛА ДЛЯ ФІНАНСІВ:
- Валюта за замовчуванням: **PLN** якщо користувач не вказав.
- Розпізнавай сленг: "грн" → UAH, "зл"/"злотих" → PLN, "$"/"долари" → USD, "євро" → EUR.
- Дата: "сьогодні" = поточна дата, "вчора" = поточна - 1 день, конкретна дата — як сказав.
- Формат дати завжди YYYY-MM-DD.
- **Перед додаванням**: спочатку виклик LIST_EXPENSE_CATEGORIES (або INCOME) щоб побачити наявні категорії.
- Якщо у списку є підходяща (навіть частково) — вибирай її (наприклад "кава" → категорія "Кава" або "Ресторани" або "Їжа").
- Якщо нічого не підходить — **перепитай юзера**: "Не знайшов категорію для 'X'. Створити нову 'Y' або поклади в існуючу?" і покажи 3-5 найближчих варіантів.
- Не створюй нові категорії без згоди юзера.
- category — це НАЗВА категорії (не id!). Бот сам знайде id.

Пріоритети задач:
- red = цього тижня (термінове)
- yellow = цього місяця (стандарт)
- green = 3 місяці

🕐 СУВОРІ ПРАВИЛА ПРО ЧАС:
- Формат "at" — ЗАВЖДИ ISO 8601 з зсувом Києва, приклад: "2026-09-22T09:00:00+03:00".
- "Сьогодні" = поточна дата з блоку ПОТОЧНИЙ ЧАС вгорі. Не вигадуй іншу дату!
- "Завтра" = поточна дата + 1 день.
- "Через X хвилин/годин" = точний розрахунок від ПОТОЧНОГО часу.
- НЕ конвертуй час в UTC! Пиши локальний час Києва + зсув +03:00 (або +02:00 взимку).
- Приклад: користувач каже "нагадай о 9 ранку сьогодні" — a поточний час 2026-09-22T06:35+03:00 — ти пишеш at="2026-09-22T09:00:00+03:00".
- Якщо час двозначний (наприклад "нагадай о 3" — 3 ранку чи 15:00?) — перепитай.

ІНШІ ПРАВИЛА:
- Якщо користувач каже "видали нагадування про X" — спочатку LIST_REMINDERS, потім у наступному ти побачиш id і викликаєш DELETE_REMINDER.
- Якщо створив помилково — пропонуй видалити.
- Ідеї структуруй: Суть → Плюси → Мінуси → Наступні кроки.

Пиши коротко, по суті, з повагою до часу Дениса.`;

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

// Розпізнати чек через Claude Vision → JSON з позиціями
async function parseReceipt(imageBase64, mediaType, expenseCategories) {
  const catNames = expenseCategories.map(c => c.name).join(', ') || 'немає';
  const systemPrompt = `Ти OCR-експерт для магазинних чеків. Отримуєш фото чека — розпізнаєш ВСІ позиції.

Твої існуючі категорії витрат у Notion: ${catNames}

ЗАВДАННЯ:
1. Знайди всі товари з цінами (включно з таблицями).
2. Для кожного товару окремо:
   - name: короткий український опис ("Молоко 2.5%", "Хліб бородинський") — навіть якщо в чеку іншою мовою.
   - qty: кількість штук (якщо є).
   - unitPrice: ціна за 1 шт (якщо qty>1, розділи total на qty).
   - total: сума за цю позицію (unitPrice*qty).
   - category: обери з існуючих категорій, або запропонуй нову. Обирай точну (Хліб → Продукти або Їжа; Печиво → Солодощі).
3. Валюта чека: PLN, UAH, USD, EUR (з чека).
4. Дата чека (YYYY-MM-DD).
5. Магазин (короткою назвою).

Формат відповіді — ТІЛЬКИ JSON без markdown, без коментарів:
{
  "shop": "Auchan",
  "date": "2026-09-22",
  "currency": "PLN",
  "items": [
    {"name":"Хліб","qty":1,"unitPrice":5.99,"total":5.99,"category":"Продукти"},
    {"name":"Печиво","qty":2,"unitPrice":5.25,"total":10.50,"category":"Солодощі"}
  ],
  "totalSum": 340.50
}

Якщо чек нечитабельний — {"error":"причина"}.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: 'Розпізнай цей чек і поверни JSON.' }
        ]
      }]
    })
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  let text = j.content[0].text.trim();
  // видаляємо можливий markdown-обгортку
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('Не вдалось розпарсити JSON з Vision: ' + text.slice(0, 200)); }
}

// ==================== ОБРОБКА ACTION-БЛОКІВ ====================

function extractAttr(act, name) {
  const rx = new RegExp(`${name}="([^"]+)"`);
  return rx.exec(act)?.[1];
}
function extractNum(act, name) {
  const rx = new RegExp(`${name}=(\\d+)`);
  const m = rx.exec(act)?.[1];
  return m ? parseInt(m) : null;
}
function priorityEmoji(p) {
  return { red: '🔴', yellow: '🟡', green: '🟢' }[p] || '🟡';
}
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    // конвертуємо у Warsaw для показу
    const inWarsaw = new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Warsaw',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
    return inWarsaw;
  }
  catch(_) { return iso; }
}

async function processActions(tgId, replyText) {
  const actions = [];
  const cleanText = replyText.replace(/\[ACTION:([^\]]+)\]/g, (_, body) => {
    actions.push(body);
    return '';
  }).trim();

  const executed = [];
  for (const act of actions) {
    try {
      // ===== ЗАДАЧІ =====
      if (act.startsWith('ADD_TASK')) {
        const title = extractAttr(act, 'title');
        const priority = extractAttr(act, 'priority') || 'yellow';
        if (title) {
          const t = await addTask(tgId, title, priority);
          executed.push(`✅ Задача додана: ${priorityEmoji(priority)} ${title} <i>(#${t.id})</i>`);
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
        const id = extractNum(act, 'id');
        if (id) { await completeTask(tgId, id); executed.push(`✅ Задача #${id} виконана`); }
      } else if (act.startsWith('DELETE_TASK')) {
        const id = extractNum(act, 'id');
        if (id) { await deleteTask(tgId, id); executed.push(`🗑 Задача #${id} видалена`); }
      } else if (act.startsWith('EDIT_TASK')) {
        const id = extractNum(act, 'id');
        const title = extractAttr(act, 'title');
        const priority = extractAttr(act, 'priority');
        if (id) {
          const patch = {};
          if (title) patch.title = title;
          if (priority) patch.priority = priority;
          await editTask(tgId, id, patch);
          executed.push(`✏️ Задача #${id} оновлена`);
        }
      }

      // ===== НАГАДУВАННЯ =====
      else if (act.startsWith('ADD_REMINDER')) {
        const text = extractAttr(act, 'text');
        const at = extractAttr(act, 'at');
        if (text && at) {
          const r = await addReminder(tgId, text, at);
          executed.push(`⏰ Нагадаю: ${text} (${fmtDate(at)}) <i>(#${r.id})</i>`);
        }
      } else if (act.startsWith('LIST_REMINDERS')) {
        const rems = await listReminders(tgId);
        if (rems.length === 0) {
          executed.push('⏰ Активних нагадувань немає');
        } else {
          let out = '⏰ <b>Твої нагадування:</b>\n';
          out += rems.map(r => `  • ${r.text} — ${fmtDate(r.remind_at)} <i>(#${r.id})</i>`).join('\n');
          executed.push(out);
        }
      } else if (act.startsWith('DELETE_REMINDER')) {
        const id = extractNum(act, 'id');
        if (id) { await deleteReminder(tgId, id); executed.push(`🗑 Нагадування #${id} видалене`); }
      } else if (act.startsWith('EDIT_REMINDER')) {
        const id = extractNum(act, 'id');
        const text = extractAttr(act, 'text');
        const at = extractAttr(act, 'at');
        if (id) {
          const patch = {};
          if (text) patch.text = text;
          if (at) patch.remind_at = at;
          await editReminder(tgId, id, patch);
          executed.push(`✏️ Нагадування #${id} оновлене`);
        }
      }

      // ===== ІДЕЇ =====
      else if (act.startsWith('SAVE_IDEA')) {
        const raw = extractAttr(act, 'raw');
        const structured = extractAttr(act, 'structured');
        if (raw) {
          const i = await saveIdea(tgId, raw, structured || '');
          executed.push(`💡 Ідея збережена <i>(#${i[0]?.id || i.id})</i>`);
        }
      } else if (act.startsWith('LIST_IDEAS')) {
        const ideas = await listIdeas(tgId);
        if (ideas.length === 0) {
          executed.push('💡 Ідей поки немає');
        } else {
          let out = '💡 <b>Твої ідеї:</b>\n';
          out += ideas.map(i => `  • ${i.raw_text.slice(0, 60)}${i.raw_text.length > 60 ? '…' : ''} <i>(#${i.id})</i>`).join('\n');
          executed.push(out);
        }
      } else if (act.startsWith('DELETE_IDEA')) {
        const id = extractNum(act, 'id');
        if (id) { await deleteIdea(tgId, id); executed.push(`🗑 Ідея #${id} видалена`); }
      }

      // ===== ФІНАНСИ (Notion) =====
      else if (act.startsWith('LIST_EXPENSE_CATEGORIES')) {
        const cats = await listCategories(DB_CAT_EXPENSES, tgId);
        if (cats.length === 0) {
          executed.push('🏷 Категорій витрат немає у Notion');
        } else {
          const names = cats.map(c => c.shared ? `★ ${c.name}` : c.name).join(', ');
          executed.push(`🏷 <b>Категорії витрат:</b>\n${names}`);
        }
      } else if (act.startsWith('LIST_INCOME_CATEGORIES')) {
        const cats = await listCategories(DB_CAT_INCOMES, tgId);
        if (cats.length === 0) {
          executed.push('🏷 Категорій доходів немає у Notion');
        } else {
          const names = cats.map(c => c.shared ? `★ ${c.name}` : c.name).join(', ');
          executed.push(`🏷 <b>Категорії доходів:</b>\n${names}`);
        }
      } else if (act.startsWith('ADD_EXPENSE')) {
        const amount = parseFloat(extractAttr(act, 'amount') || extractNum(act, 'amount'));
        const currency = extractAttr(act, 'currency') || 'PLN';
        const date = extractAttr(act, 'date') || new Date().toISOString().slice(0, 10);
        const catName = extractAttr(act, 'category');
        const note = extractAttr(act, 'note') || '';
        if (!amount || amount <= 0) {
          executed.push('⚠️ Некоректна сума');
        } else {
          // шукаємо категорію
          const cats = await listCategories(DB_CAT_EXPENSES, tgId);
          const cat = catName ? findCategory(cats, catName) : null;
          await createExpense(tgId, {
            amount, currency, date,
            categoryId: cat?.id || null,
            note
          });
          const catLabel = cat ? cat.name : (catName ? `${catName} (без категорії)` : 'без категорії');
          executed.push(`💸 Витрата: ${amount} ${currency} — ${note || catLabel} · <i>${catLabel}</i> · ${date}`);
        }
      } else if (act.startsWith('ADD_INCOME')) {
        const amount = parseFloat(extractAttr(act, 'amount') || extractNum(act, 'amount'));
        const currency = extractAttr(act, 'currency') || 'PLN';
        const date = extractAttr(act, 'date') || new Date().toISOString().slice(0, 10);
        const catName = extractAttr(act, 'category');
        const note = extractAttr(act, 'note') || '';
        if (!amount || amount <= 0) {
          executed.push('⚠️ Некоректна сума');
        } else {
          const cats = await listCategories(DB_CAT_INCOMES, tgId);
          const cat = catName ? findCategory(cats, catName) : null;
          await createIncome(tgId, {
            amount, currency, date,
            categoryId: cat?.id || null,
            note
          });
          const catLabel = cat ? cat.name : (catName ? `${catName} (без категорії)` : 'без категорії');
          executed.push(`💰 Дохід: ${amount} ${currency} — ${note || catLabel} · <i>${catLabel}</i> · ${date}`);
        }
      } else if (act.startsWith('CREATE_EXPENSE_CATEGORY')) {
        const name = extractAttr(act, 'name');
        if (name) {
          const c = await createCategory(DB_CAT_EXPENSES, tgId, name);
          executed.push(`🏷 Створена категорія витрат: ${c.name}`);
        }
      } else if (act.startsWith('CREATE_INCOME_CATEGORY')) {
        const name = extractAttr(act, 'name');
        if (name) {
          const c = await createCategory(DB_CAT_INCOMES, tgId, name);
          executed.push(`🏷 Створена категорія доходів: ${c.name}`);
        }
      }
    } catch (e) {
      executed.push(`⚠️ Помилка: ${e.message}`);
    }
  }

  const finalText = [cleanText, ...executed].filter(Boolean).join('\n\n');
  return finalText || '✓';
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

    if (tgId !== OWNER_TG_ID) {
      await tgSend(chatId, 'Цей бот приватний.');
      return res.status(200).send('OK');
    }

    if (msg.text === '/start') {
      await tgSend(chatId, '👋 Привіт, Денисе! Я твій персональний асистент.\n\nМожу:\n• Спілкуватись і думати разом\n• Записувати задачі 🔴🟡🟢\n• Нагадувати про важливе\n• Розкладати ідеї по поличках\n• Записувати витрати/доходи в Notion\n• 🎤 Розпізнавати голосові\n• 📸 Розпізнавати чеки з фото\n\nПиши, говори або скидай фото чека.');
      return res.status(200).send('OK');
    }

    // ===== ФОТО (чек) =====
    if (msg.photo && msg.photo.length > 0) {
      const bestPhoto = msg.photo[msg.photo.length - 1]; // найбільша роздільна здатність
      await tgSend(chatId, '📸 Обробляю чек...');
      try {
        const { data, mediaType } = await tgGetPhotoBase64(bestPhoto.file_id);
        const cats = await listCategories(DB_CAT_EXPENSES, tgId);
        const receipt = await parseReceipt(data, mediaType, cats);
        if (receipt.error) {
          await tgSend(chatId, `⚠️ Не вдалось розпізнати: ${receipt.error}`);
          return res.status(200).send('OK');
        }

        // Створюємо кожну позицію окремим записом
        const created = [];
        const errors = [];
        for (const item of receipt.items || []) {
          try {
            const qty = item.qty || 1;
            const unitPrice = item.unitPrice || (item.total / qty);
            const note = item.name + (qty > 1 ? ` (${qty}шт по ${unitPrice.toFixed(2)})` : '');
            const cat = item.category ? findCategory(cats, item.category) : null;
            // Створюємо стільки записів скільки qty (щоб можна було потім аналізувати поштучно)
            for (let i = 0; i < qty; i++) {
              await createExpense(tgId, {
                amount: unitPrice,
                currency: receipt.currency || 'PLN',
                date: receipt.date || new Date().toISOString().slice(0, 10),
                categoryId: cat?.id || null,
                note: qty > 1 ? `${item.name} (${i+1}/${qty})` : item.name
              });
            }
            created.push({ ...item, qty, unitPrice, catName: cat?.name || item.category || 'без категорії' });
          } catch (e) {
            errors.push(`${item.name}: ${e.message}`);
          }
        }

        // Формуємо звіт
        let report = `📸 <b>${receipt.shop || 'Чек'}</b> · ${receipt.date || 'сьогодні'} · ${receipt.currency || 'PLN'}\n\n`;
        report += created.map(item => {
          const totalStr = item.qty > 1 ? `${item.qty}×${item.unitPrice.toFixed(2)} = ${(item.qty*item.unitPrice).toFixed(2)}` : item.unitPrice.toFixed(2);
          return `🛒 ${item.name} — ${totalStr} → <i>${item.catName}</i>`;
        }).join('\n');
        const totalSum = created.reduce((s, i) => s + i.unitPrice * i.qty, 0);
        report += `\n\n<b>Разом: ${totalSum.toFixed(2)} ${receipt.currency || 'PLN'}</b> (${created.length} ${created.length === 1 ? 'позиція' : 'позицій'})`;
        if (errors.length > 0) report += `\n\n⚠️ Помилки:\n${errors.join('\n')}`;
        report += `\n\n💡 Хочеш виправити категорію — напиши: "остання витрата X — категорія Y"`;

        // зберігаємо в памʼять щоб Claude пам'ятав про цей чек
        await saveMessage(tgId, 'user', `[скинув фото чека з ${receipt.shop || 'магазину'}]`);
        await saveMessage(tgId, 'assistant', report);

        await tgSend(chatId, report);
      } catch (e) {
        await tgSend(chatId, `⚠️ Помилка обробки чека: ${e.message}`);
      }
      return res.status(200).send('OK');
    }

    let userText = msg.text;
    if (!userText && msg.voice) {
      await tgSend(chatId, '🎤 Слухаю голосове...');
      userText = await transcribeVoice(msg.voice.file_id);
      if (!userText) {
        await tgSend(chatId, '⚠️ Голосові не налаштовані. Додай GROQ_API_KEY (безкоштовно) або OPENAI_API_KEY у Vercel ENV.');
        return res.status(200).send('OK');
      }
      await tgSend(chatId, `📝 <i>Розшифровка:</i>\n${userText}`);
    }

    if (!userText) {
      return res.status(200).send('OK');
    }

    await saveMessage(tgId, 'user', userText);

    const history = await loadHistory(tgId);
    const rawReply = await askClaude(history);

    const finalReply = await processActions(tgId, rawReply);

    await saveMessage(tgId, 'assistant', rawReply);

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
