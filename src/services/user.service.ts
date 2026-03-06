import { upsertUser, getUserByTelegramId, UserRow } from '../database/queries';

export async function upsertUserByTelegramId(telegramId: number | string): Promise<UserRow> {
  return upsertUser(BigInt(telegramId));
}

export async function getUserById(telegramId: number | string): Promise<UserRow | null> {
  return getUserByTelegramId(BigInt(telegramId));
}
