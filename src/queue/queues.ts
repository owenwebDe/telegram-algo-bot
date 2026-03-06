import { Queue, ConnectionOptions, QueueEvents } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../config/logger';

// Use a plain connection options object — avoids the BullMQ/ioredis version
// mismatch that arises when passing a live IORedis instance from the top-level
// ioredis package (BullMQ v5 bundles its own internal ioredis copy).
export const redisConnectionOptions: ConnectionOptions = {
  host: (() => {
    try {
      return new URL(env.redisUrl).hostname;
    } catch {
      return '127.0.0.1';
    }
  })(),
  port: (() => {
    try {
      return parseInt(new URL(env.redisUrl).port || '6379', 10);
    } catch {
      return 6379;
    }
  })(),
  maxRetriesPerRequest: null,
};

// ── Job Data Types ────────────────────────────────────────────────────────────

export interface Mt5LaunchJobData {
  accountId: string;       // bigint serialised as string for JSON
  userId: string;          // internal DB user id
  telegramId: string;
  login: string;
  encryptedPassword: string;
  server: string;
}

export type Mt5JobName = 'launch' | 'restart';

// ── Queue ─────────────────────────────────────────────────────────────────────

export const mt5LaunchQueue = new Queue<Mt5LaunchJobData, void, Mt5JobName>('mt5-launch', {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10_000,  // 10 s → 20 s → 40 s
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

export const mt5QueueEvents = new QueueEvents('mt5-launch', {
  connection: redisConnectionOptions,
});

// Separate IORedis connection for graceful shutdown signalling (uses plain options)
import IORedis from 'ioredis';
export const redisConnection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('connect', () => logger.info('Redis connected'));
redisConnection.on('error', (err) => logger.error('Redis error', { error: err.message }));

logger.info('BullMQ queue initialised', { queue: 'mt5-launch' });
