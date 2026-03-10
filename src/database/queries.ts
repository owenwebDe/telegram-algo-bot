import { query } from './pool';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: bigint;
  telegram_id: bigint;
  created_at: Date;
}

export interface Mt5AccountRow {
  id: bigint;
  user_id: bigint;
  login: string;
  encrypted_password: string;
  server: string;
  instance_path: string | null;
  status: string;
  pid: number | null;
  last_seen_at: Date | null;
  created_at: Date;
}

// ─── User Queries ─────────────────────────────────────────────────────────────

/**
 * Insert or return existing user by telegram_id.
 */
export async function upsertUser(telegramId: bigint): Promise<UserRow> {
  const result = await query<UserRow>(
    `INSERT INTO users (telegram_id)
     VALUES ($1)
     ON CONFLICT (telegram_id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id
     RETURNING *`,
    [telegramId],
  );
  return result.rows[0]!;
}

export async function getUserByTelegramId(
  telegramId: bigint,
): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT * FROM users WHERE telegram_id = $1`,
    [telegramId],
  );
  return result.rows[0] ?? null;
}

// ─── MT5 Account Queries ──────────────────────────────────────────────────────

export async function upsertMt5Account(params: {
  userId: bigint;
  login: string;
  encryptedPassword: string;
  server: string;
}): Promise<Mt5AccountRow> {
  const result = await query<Mt5AccountRow>(
    `INSERT INTO mt5_accounts (user_id, login, encrypted_password, server, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (user_id, login, server) DO UPDATE
       SET encrypted_password = EXCLUDED.encrypted_password,
           status             = 'pending',
           last_seen_at       = NOW()
     RETURNING *`,
    [params.userId, params.login, params.encryptedPassword, params.server],
  );
  return result.rows[0]!;
}

export async function updateMt5AccountStatus(params: {
  id: bigint;
  status: string;
  pid?: number | null;
  instancePath?: string | null;
}): Promise<void> {
  await query(
    `UPDATE mt5_accounts
     SET status        = $2,
         pid           = COALESCE($3, pid),
         instance_path = COALESCE($4, instance_path),
         last_seen_at  = NOW()
     WHERE id = $1`,
    [params.id, params.status, params.pid ?? null, params.instancePath ?? null],
  );
}

export async function getMt5Account(params: {
  userId: bigint;
  login: string;
  server: string;
}): Promise<Mt5AccountRow | null> {
  const result = await query<Mt5AccountRow>(
    `SELECT a.* FROM mt5_accounts a
     WHERE a.user_id = $1 AND a.login = $2 AND a.server = $3`,
    [params.userId, params.login, params.server],
  );
  return result.rows[0] ?? null;
}

export async function getMt5AccountByLogin(
  userId: bigint,
  login: string,
): Promise<Mt5AccountRow | null> {
  const result = await query<Mt5AccountRow>(
    `SELECT * FROM mt5_accounts WHERE user_id = $1 AND login = $2 ORDER BY id DESC LIMIT 1`,
    [userId, login],
  );
  return result.rows[0] ?? null;
}

export async function getMt5AccountById(
  id: bigint,
): Promise<Mt5AccountRow | null> {
  const result = await query<Mt5AccountRow>(
    `SELECT * FROM mt5_accounts WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getActiveMt5Accounts(): Promise<Mt5AccountRow[]> {
  const result = await query<Mt5AccountRow>(
    `SELECT * FROM mt5_accounts WHERE status IN ('launching','connected')`,
  );
  return result.rows;
}

// ─── EA Config Queries ────────────────────────────────────────────────────────

export interface EaConfigRow {
  id: bigint;
  user_id: bigint;
  account_id: bigint | null;
  login: string;
  is_running: boolean;
  trade_type: string;
  symbol1: string;
  symbol2: string;
  initial_lot: number;
  magic_no: number;
  stop_loss: number;
  take_profit: number;
  symbol_to_trade: string;
  symbol_to_close: string;
  trade_on_same_level: boolean;
  levels: object[];
  created_at: Date;
  updated_at: Date;
}

export async function upsertEaConfig(params: {
  userId: bigint;
  login: string;
  config: Partial<EaConfigRow>;
}): Promise<EaConfigRow> {
  const c = params.config;
  const result = await query<EaConfigRow>(
    `INSERT INTO ea_configs
       (user_id, login, trade_type, symbol1, symbol2, initial_lot, magic_no, stop_loss,
        take_profit, symbol_to_trade, symbol_to_close, trade_on_same_level, levels, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb, NOW())
     ON CONFLICT (user_id, login) DO UPDATE SET
       trade_type          = EXCLUDED.trade_type,
       symbol1             = EXCLUDED.symbol1,
       symbol2             = EXCLUDED.symbol2,
       initial_lot         = EXCLUDED.initial_lot,
       magic_no            = EXCLUDED.magic_no,
       stop_loss           = EXCLUDED.stop_loss,
       take_profit         = EXCLUDED.take_profit,
       symbol_to_trade     = EXCLUDED.symbol_to_trade,
       symbol_to_close     = EXCLUDED.symbol_to_close,
       trade_on_same_level = EXCLUDED.trade_on_same_level,
       levels              = EXCLUDED.levels,
       updated_at          = NOW()
     RETURNING *`,
    [
      params.userId, params.login,
      c.trade_type ?? 'buy', c.symbol1 ?? 'XAUUSD', c.symbol2 ?? 'XAUUSD.',
      c.initial_lot ?? 0.1, c.magic_no ?? 12345, c.stop_loss ?? 0, c.take_profit ?? 0,
      c.symbol_to_trade ?? 'Sym1', c.symbol_to_close ?? 'Sym1',
      c.trade_on_same_level ?? false, JSON.stringify(c.levels ?? []),
    ],
  );
  return result.rows[0]!;
}

export async function getEaConfig(userId: bigint, login: string): Promise<EaConfigRow | null> {
  const result = await query<EaConfigRow>(
    `SELECT * FROM ea_configs WHERE user_id = $1 AND login = $2`,
    [userId, login],
  );
  return result.rows[0] ?? null;
}

export async function setEaRunning(userId: bigint, login: string, isRunning: boolean): Promise<void> {
  await query(
    `UPDATE ea_configs SET is_running = $3, updated_at = NOW() WHERE user_id = $1 AND login = $2`,
    [userId, login, isRunning],
  );
}

// ─── Subscription Queries ─────────────────────────────────────────────────────

export interface SubscriptionRow {
  id: bigint;
  user_id: bigint;
  tier: string;
  expires_at: Date | null;
  activated_by: string | null;
  activation_code: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function getSubscription(userId: bigint): Promise<SubscriptionRow | null> {
  const result = await query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function upsertSubscription(params: {
  userId: bigint;
  tier: string;
  expiresAt: Date | null;
  activatedBy: string;
  activationCode?: string;
}): Promise<SubscriptionRow> {
  const result = await query<SubscriptionRow>(
    `INSERT INTO subscriptions (user_id, tier, expires_at, activated_by, activation_code, updated_at)
     VALUES ($1,$2,$3,$4,$5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       tier            = EXCLUDED.tier,
       expires_at      = EXCLUDED.expires_at,
       activated_by    = EXCLUDED.activated_by,
       activation_code = EXCLUDED.activation_code,
       updated_at      = NOW()
     RETURNING *`,
    [params.userId, params.tier, params.expiresAt, params.activatedBy, params.activationCode ?? null],
  );
  return result.rows[0]!;
}

// ─── Activation Code Queries ──────────────────────────────────────────────────

export interface ActivationCodeRow {
  id: bigint;
  code: string;
  tier: string;
  duration_days: number;
  used_by: bigint | null;
  used_at: Date | null;
  created_at: Date;
}

export async function getActivationCode(code: string): Promise<ActivationCodeRow | null> {
  const result = await query<ActivationCodeRow>(
    `SELECT * FROM activation_codes WHERE code = $1`,
    [code],
  );
  return result.rows[0] ?? null;
}

export async function markCodeUsed(codeId: bigint, userId: bigint): Promise<void> {
  await query(
    `UPDATE activation_codes SET used_by = $2, used_at = NOW() WHERE id = $1`,
    [codeId, userId],
  );
}

export async function insertActivationCode(params: {
  code: string;
  tier: string;
  durationDays: number;
}): Promise<ActivationCodeRow> {
  const result = await query<ActivationCodeRow>(
    `INSERT INTO activation_codes (code, tier, duration_days) VALUES ($1,$2,$3) RETURNING *`,
    [params.code, params.tier, params.durationDays],
  );
  return result.rows[0]!;
}
