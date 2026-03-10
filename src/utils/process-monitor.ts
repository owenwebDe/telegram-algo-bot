import { EventEmitter } from 'events';
import { logger } from '../config/logger';
import { mt5ActiveInstances } from '../config/metrics';

export interface InstanceRecord {
  userId: string;
  accountId: bigint;
  login: string;
  server: string;
  pid: number;
  startedAt: Date;
  status: 'launching' | 'connected' | 'crashed';
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * In-memory registry of running MT5 terminal processes.
 * Emits 'crashed' events with the InstanceRecord when a process exits unexpectedly.
 */
class ProcessRegistry extends EventEmitter {
  private records = new Map<string, InstanceRecord>();
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    logger.info('ProcessRegistry polling started', { interval_ms: POLL_INTERVAL_MS });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  register(record: InstanceRecord): void {
    const key = `${record.userId}_${record.login}`;
    this.records.set(key, record);
    mt5ActiveInstances.set(this.records.size);
    logger.info('Instance registered', {
      userId: record.userId,
      login: record.login,
      key,
      pid: record.pid,
    });
  }

  unregister(userId: string, login: string): void {
    const key = `${userId}_${login}`;
    this.records.delete(key);
    mt5ActiveInstances.set(this.records.size);
    logger.info('Instance unregistered', { userId, login, key });
  }

  get(userId: string, login: string): InstanceRecord | undefined {
    return this.records.get(`${userId}_${login}`);
  }

  all(): InstanceRecord[] {
    return Array.from(this.records.values());
  }

  size(): number {
    return this.records.size;
  }

  /** Check all registered PIDs; emit 'crashed' for any that have exited. */
  private poll(): void {
    for (const [key, record] of this.records) {
      if (!this.isAlive(record.pid)) {
        logger.warn('MT5 instance crashed', {
          userId: record.userId,
          login: record.login,
          key,
          pid: record.pid,
        });
        record.status = 'crashed';
        this.records.delete(key);
        mt5ActiveInstances.set(this.records.size);
        this.emit('crashed', record);
      }
    }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // signal 0 = check existence only
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton
export const processRegistry = new ProcessRegistry();
