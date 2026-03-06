import { encrypt } from '../utils/encryption';
import {
  upsertMt5Account,
  getMt5Account,
  getMt5AccountByLogin,
  updateMt5AccountStatus,
} from '../database/queries';
import { upsertUserByTelegramId } from './user.service';
import { mt5LaunchQueue, Mt5LaunchJobData } from '../queue/queues';
import { processRegistry } from '../utils/process-monitor';
import { instanceManager } from '../mt5/instance-manager';
import { logger } from '../config/logger';
import { mt5ConnectTotal, mt5JobQueuedTotal } from '../config/metrics';

export interface ConnectResult {
  jobId: string;
  accountId: string;
  status: string;
}

export interface StatusResult {
  status: string;
}

/**
 * Orchestrate an MT5 connect request:
 * validate → upsert user → encrypt password → upsert account → enqueue job.
 */
export async function connectAccount(
  telegramId: number,
  login: string,
  password: string,  // raw — never stored, encrypted immediately
  server: string,
): Promise<ConnectResult> {
  mt5ConnectTotal.inc();

  const user = await upsertUserByTelegramId(telegramId);
  logger.info('User upserted for MT5 connect', { telegramId, userId: user.id.toString() });

  const encryptedPassword = encrypt(password);

  const account = await upsertMt5Account({
    userId: user.id,
    login,
    encryptedPassword,
    server,
  });

  const jobData: Mt5LaunchJobData = {
    accountId: account.id.toString(),
    userId: user.id.toString(),
    telegramId: telegramId.toString(),
    login,
    encryptedPassword,
    server,
  };

  const job = await mt5LaunchQueue.add('launch' as const, jobData);

  mt5JobQueuedTotal.inc();
  logger.info('MT5 launch job queued', {
    jobId: job.id,
    userId: user.id.toString(),
    login,
    server,
  });

  return {
    jobId: job.id ?? 'unknown',
    accountId: account.id.toString(),
    status: 'launching',
  };
}

/**
 * Return the current connection status for an account based solely on login ID.
 */
export async function getAccountStatusByLogin(
  telegramId: number,
  login: string,
): Promise<StatusResult | null> {
  const user = await upsertUserByTelegramId(telegramId);
  const account = await getMt5AccountByLogin(user.id, login);
  if (!account) return null;

  return {
    status: account.status,
  };
}

/**
 * Gracefully disconnect a user's MT5 account.
 */
export async function disconnectAccount(
  telegramId: number,
  login: string,
  server: string,
): Promise<{ ok: boolean; message: string }> {
  const user = await upsertUserByTelegramId(telegramId);
  const account = await getMt5Account({ userId: user.id, login, server });

  if (!account) {
    return { ok: false, message: 'Account not found' };
  }

  // Kill running process
  if (account.pid) {
    await instanceManager.killProcess(account.pid);
  }

  // Remove from registry
  processRegistry.unregister(user.id.toString());

  await updateMt5AccountStatus({ id: account.id, status: 'disconnected', pid: null });

  logger.info('MT5 account disconnected', {
    telegramId,
    login,
    server,
    previousPid: account.pid,
  });

  return { ok: true, message: 'Account disconnected' };
}
