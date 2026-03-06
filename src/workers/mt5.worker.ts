import { Worker, Job } from 'bullmq';
import { redisConnectionOptions, Mt5LaunchJobData, Mt5JobName } from '../queue/queues';
import { instanceManager } from '../mt5/instance-manager';
import { processRegistry } from '../utils/process-monitor';
import { decrypt } from '../utils/encryption';
import { updateMt5AccountStatus } from '../database/queries';
import { env } from '../config/env';
import { logger } from '../config/logger';
import {
  mt5LaunchSuccessTotal,
  mt5LaunchFailureTotal,
} from '../config/metrics';

async function processMt5LaunchJob(job: Job<Mt5LaunchJobData>): Promise<void> {
  const { accountId, userId, login, encryptedPassword, server } = job.data;
  const accountIdBig = BigInt(accountId);

  logger.info('MT5 launch job started', { jobId: job.id, userId, login, server });

  // ── Mark as launching ──────────────────────────────────────────────────────
  await updateMt5AccountStatus({ id: accountIdBig, status: 'launching' });

  // ── Decrypt password ───────────────────────────────────────────────────────
  // NEVER log the plaintext password
  const password = decrypt(encryptedPassword);

  // ── Create / verify instance directory ────────────────────────────────────
  const instanceDir = await instanceManager.createInstance(userId);

  // ── Write startup.ini ──────────────────────────────────────────────────────
  const iniPath = await instanceManager.writeStartupConfig(
    instanceDir,
    login,
    password,
    server,
  );

  const pid = await instanceManager.launchTerminal(instanceDir, iniPath);

  await updateMt5AccountStatus({
    id: accountIdBig,
    status: 'launching',
    pid,
    instancePath: instanceDir,
  });

  // ── Wait for authorization ─────────────────────────────────────────────────
  const authResult = await instanceManager.waitForAuth(
    instanceDir,
    login,
    env.mt5LoginTimeoutMs,
  );

  if (authResult.status === 'connected') {
    // Register in process monitor
    processRegistry.register({
      userId,
      accountId: accountIdBig,
      login,
      server,
      pid,
      startedAt: new Date(),
      status: 'connected',
    });

    await updateMt5AccountStatus({
      id: accountIdBig,
      status: 'connected',
      pid,
      instancePath: instanceDir,
    });

    mt5LaunchSuccessTotal.inc();
    logger.info('MT5 terminal connected', { userId, login, server, pid });
  } else {
    // Kill the orphaned process
    await instanceManager.killProcess(pid);

    await updateMt5AccountStatus({
      id: accountIdBig,
      status: 'failed',
      pid: null,
    });

    mt5LaunchFailureTotal.inc();
    logger.error('MT5 terminal failed to authenticate', {
      userId,
      login,
      server,
      message: authResult.message,
    });

    // Throw so BullMQ retries (up to 3×)
    throw new Error(authResult.message);
  }
}

/**
 * Handle a job that has permanently failed (all retries exhausted).
 */
async function onJobFailed(
  job: Job<Mt5LaunchJobData> | undefined,
  err: Error,
): Promise<void> {
  if (!job) return;
  logger.error('MT5 launch job permanently failed', {
    jobId: job.id,
    userId: job.data.userId,
    login: job.data.login,
    error: err.message,
  });
  try {
    await updateMt5AccountStatus({
      id: BigInt(job.data.accountId),
      status: 'failed',
      pid: null,
    });
  } catch (dbErr) {
    logger.error('Failed to update account status to failed', {
      error: (dbErr as Error).message,
    });
  }
}

export function createMt5Worker(): Worker<Mt5LaunchJobData, void, Mt5JobName> {
  const worker = new Worker<Mt5LaunchJobData, void, Mt5JobName>(
    'mt5-launch',
    processMt5LaunchJob,
    {
      connection: redisConnectionOptions,
      concurrency: env.mt5MaxConcurrent,
      autorun: true,
    },
  );

  worker.on('completed', (job) => {
    logger.info('MT5 launch job completed', { jobId: job.id, userId: job.data.userId });
  });

  worker.on('failed', onJobFailed);

  worker.on('error', (err) => {
    logger.error('MT5 worker error', { error: err.message });
  });

  logger.info('MT5 BullMQ worker started', { concurrency: env.mt5MaxConcurrent });
  return worker;
}
