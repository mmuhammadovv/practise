-- Схема базы D1. Запуск: npm run db:init:local (локально) или npm run db:init (в Cloudflare)

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash  TEXT NOT NULL,          -- PBKDF2-SHA256, hex
  salt       TEXT NOT NULL,          -- случайная соль, hex
  created_at INTEGER NOT NULL
);

-- В базе храним только SHA-256 от токена сессии, а сам токен живёт в HttpOnly-cookie
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS progress (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id   TEXT NOT NULL,
  solved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id)
);

-- Защита от перебора паролей: счётчик неудачных попыток входа
CREATE TABLE IF NOT EXISTS login_attempts (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
