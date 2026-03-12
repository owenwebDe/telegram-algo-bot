import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const env = {
  port: parseInt(optional('PORT', '8080'), 10),
  host: optional('HOST', '0.0.0.0'),

  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),

  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  webappUrl: optional('WEBAPP_URL', 'https://localhost:8080'),

  // 32-byte hex string → 64-character hex
  encryptionKey: required('MT5_SECRET_KEY'),

  mt5BaseDir: optional('MT5_BASE_DIR', 'C:/mt5_base'),
  mt5InstancesDir: optional('MT5_INSTANCES_DIR', 'C:/mt5_instances'),
  mt5TerminalExe: optional('MT5_TERMINAL_EXE', 'terminal64.exe'),

  mt5MaxConcurrent: parseInt(optional('MT5_MAX_CONCURRENT', '5'), 10),
  mt5LoginTimeoutMs: parseInt(optional('MT5_LOGIN_TIMEOUT_MS', '60000'), 10),

  logLevel: optional('LOG_LEVEL', 'info'),
  logDir: optional('LOG_DIR', 'logs'),

  allowAuthBypass: optional('ALLOW_AUTH_BYPASS', 'true') === 'true',
} as const;

export type Env = typeof env;
