/**
 * Server entry point.
 *
 * Boot order:
 *  1. Load & validate environment variables
 *  2. Verify PostgreSQL connection
 *  3. Start BullMQ worker
 *  4. Start ProcessRegistry polling
 *  5. Listen for crashed instance events → re-queue restart jobs
 *  6. Start HTTP server
 *  7. Register graceful shutdown handlers
 */

import { env } from './config/env';          // must be first — validates env
import { logger } from './config/logger';
import { createApp } from './app';
import { getPool, closePool } from './database/pool';
import { createMt5Worker } from './workers/mt5.worker';
import { mt5LaunchQueue, redisConnection } from './queue/queues';
import { processRegistry, InstanceRecord } from './utils/process-monitor';
import { getMt5AccountById } from './database/queries';
import { startBot, stopBot } from './services/telegram-bot';
import http from 'http';

let worker: ReturnType<typeof createMt5Worker> | null = null;
let httpServer: http.Server | null = null;

async function bootstrap(): Promise<void> {
  logger.info('Starting MT5 backend service', { version: '1.0.0' });

  // ── 1. PostgreSQL ───────────────────────────────────────────────────────────
  const pool = getPool();
  await pool.query('SELECT 1'); // connection check
  logger.info('PostgreSQL connected');

  // ── 2. BullMQ Worker ────────────────────────────────────────────────────────
  worker = createMt5Worker();

  // ── 3. Process monitor ───────────────────────────────────────────────────────
  processRegistry.start();

  // ── 4. Auto-restart crashed instances ────────────────────────────────────────
  processRegistry.on('crashed', async (record: InstanceRecord) => {
    logger.warn('Re-queuing crashed MT5 instance', {
      userId: record.userId,
      login: record.login,
      server: record.server,
    });

    try {
      const account = await getMt5AccountById(record.accountId);
      if (!account || account.status === 'disconnected') return;

      await mt5LaunchQueue.add('restart' as const, {
        accountId: record.accountId.toString(),
        userId: record.userId,
        telegramId: '0', // no Telegram context on restart
        login: record.login,
        encryptedPassword: account.encrypted_password,
        server: record.server,
      });

      logger.info('Restart job queued for crashed instance', {
        userId: record.userId,
        login: record.login,
      });
    } catch (err) {
      logger.error('Failed to re-queue crashed instance', {
        error: (err as Error).message,
        userId: record.userId,
      });
    }
  });

  // ── 5. HTTP Server ───────────────────────────────────────────────────────────
  const app = createApp();
  httpServer = http.createServer(app);

  httpServer.listen(env.port, env.host, () => {
    logger.info(`HTTP server listening on http://${env.host}:${env.port}`);
    logger.info('Health check: GET /api/health');
    logger.info('Metrics:      GET /api/metrics');
    logger.info('MT5 connect:  POST /api/mt5/connect');
  });

  // ── 6. Telegram Bot ──────────────────────────────────────────────────────────
  startBot();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down gracefully`);

  processRegistry.stop();
  stopBot();

  if (httpServer) {
    httpServer.close(() => logger.info('HTTP server closed'));
  }

  if (worker) {
    await worker.close();
    logger.info('BullMQ worker closed');
  }

  await mt5LaunchQueue.close();
  await redisConnection.quit();
  logger.info('Redis connection closed');

  await closePool();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

bootstrap().catch((err: Error) => {
  logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
