# Aware Agent — Telegram AI-асистент

## Що вміє (Пакет 1)

- 💬 Спілкування з Claude українською
- 🧠 Памʼятає останні 30 повідомлень розмови
- 📋 Задачі з пріоритетами: 🔴 (тиждень) / 🟡 (місяць) / 🟢 (3 місяці)
- ⏰ Нагадування о заданий час
- 🎤 Голосові → текст (потрібен OpenAI API)
- 🔒 Тільки твій Telegram ID може писати

## Деплой (5 кроків)

### 1. Створи Supabase таблиці

- Заходь у свій Supabase проєкт → **SQL Editor** → **New Query**.
- Скопіюй увесь вміст `schema.sql` і встав.
- **Run**.

### 2. Залий у GitHub

Створи новий репозиторій `aware-agent` і залий усі файли.

### 3. Задеплой у Vercel

- Заходь на Vercel → **Add New** → **Project** → обери `aware-agent`.
- Framework: **Other**.
- Deploy.

### 4. Додай ENV-змінні у Vercel

Settings → Environment Variables:

```
BOT_TOKEN           = токен від @BotFather
ANTHROPIC_API_KEY   = ключ з console.anthropic.com
OWNER_TG_ID         = твій Telegram ID (число)
SUPABASE_URL        = https://ecngnezajknbkdotfcls.supabase.co
SUPABASE_KEY        = anon public key з Supabase
OPENAI_API_KEY      = (опційно, для голосових)
```

Після додавання → **Redeploy** (Deployments → останній → ··· → Redeploy).

### 5. Прикріпи webhook Telegram → Vercel

У браузері відкрий (заміни `YOUR_BOT_TOKEN` і `YOUR_APP.vercel.app`):

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_APP>.vercel.app/api/webhook
```

Побачиш `{"ok":true,"result":true,"description":"Webhook was set"}`.

## Використання

Пиши боту в Telegram як другові. Приклади:

- `Привіт` → просто відповість
- `Додай задачу купити молоко на завтра` → додасть задачу
- `Покажи мої задачі` → список
- `Нагадай завтра о 9 подзвонити мамі` → нагадування
- Скинь голосове → розшифрує → обробить

## Файли

- `api/webhook.js` — головний endpoint для повідомлень Telegram
- `api/cron.js` — перевірка нагадувань щохвилини
- `schema.sql` — таблиці Supabase
- `vercel.json` — конфігурація cron
