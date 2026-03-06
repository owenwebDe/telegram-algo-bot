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
