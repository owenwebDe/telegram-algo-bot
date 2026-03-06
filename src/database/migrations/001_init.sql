-- Migration 001: Initial schema
-- Run manually or via: node scripts/migrate.js

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id);

CREATE TABLE IF NOT EXISTS mt5_accounts (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login              VARCHAR(64) NOT NULL,
  encrypted_password TEXT NOT NULL,
  server             VARCHAR(128) NOT NULL,
  instance_path      TEXT,
  status             VARCHAR(32) NOT NULL DEFAULT 'pending',
  -- possible values: pending | launching | connected | failed | disconnected
  pid                INTEGER,
  last_seen_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_login_server UNIQUE (user_id, login, server)
);

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_user_id ON mt5_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_status  ON mt5_accounts (status);

COMMIT;
