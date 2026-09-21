// Cron: перевіряє нагадування щохвилини, шле ті що настали.
// Vercel викликає це автоматично за розкладом (див. vercel.json)

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_TG_ID = parseInt(process.env.OWNER_TG_ID);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function sb(method, path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  return r.ok ? r.json() : null;
}

async function tgSend(chatId, text) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

module.exports = async (req, res) => {
  try {
    const now = new Date().toISOString();
    const due = await sb('GET', `reminders?sent=eq.false&remind_at=lte.${now}`);
    if (due && due.length > 0) {
      for (const r of due) {
        await tgSend(r.tg_id, `⏰ <b>Нагадування:</b>\n${r.text}`);
        await sb('PATCH', `reminders?id=eq.${r.id}`, { sent: true });
      }
    }
    return res.status(200).json({ sent: due?.length || 0 });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
