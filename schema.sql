-- Aware Agent — Пакет 1: базові таблиці

-- ==================== MESSAGES (памʼять розмов) ====================
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL,
  role TEXT NOT NULL,  -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_tg ON messages(tg_id, created_at);

-- ==================== TASKS (задачі з пріоритетами) ====================
CREATE TABLE tasks (
  id BIGSERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'yellow',  -- 'red' | 'yellow' | 'green'
  status TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'done' | 'cancelled'
  deadline_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_tasks_tg ON tasks(tg_id, status);

-- ==================== REMINDERS (нагадування на час) ====================
CREATE TABLE reminders (
  id BIGSERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL,
  text TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_reminders_pending ON reminders(remind_at, sent) WHERE sent = false;

-- ==================== IDEAS (ідеї які ти скидаєш) ====================
CREATE TABLE ideas (
  id BIGSERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL,
  raw_text TEXT NOT NULL,       -- як ти сказав
  structured TEXT,               -- як бот розклав
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ideas_tg ON ideas(tg_id, created_at);
