-- Migration 003: Add slippage column to ea_configs

BEGIN;

ALTER TABLE ea_configs ADD COLUMN IF NOT EXISTS slippage REAL NOT NULL DEFAULT 1;

COMMIT;
