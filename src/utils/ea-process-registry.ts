import { EventEmitter } from 'events';
import { logger } from '../config/logger';

export interface EaRecord {
    userId: string;
    login: string;
    pid: number;
    startedAt: Date;
    status: 'running' | 'stopped' | 'crashed';
    lastHeartbeat?: {
        spreadBuy: number;
        spreadSell: number;
        spreadDir: string;
        activeLevels: string[];
        openPairs: number;
        eaProfit: number;
        tick1: { bid: number; ask: number } | null;
        tick2: { bid: number; ask: number } | null;
        trade_allowed: boolean;
        level_statuses: any[];
        tracker: { executed: number; placed: number };
        active_trades: { key: string; level: string; lot: number; spread: number }[];
        symbol1: string;
        symbol2: string;
        logs: { time: string; type: string; msg: string; latency_ms?: number }[];
        account?: { balance: number; equity: number; margin: number; free_margin: number; margin_level: number; };
    };
}

/**
 * In-memory registry of running ea_engine.py processes.
 * Keyed by `${userId}_${login}` — same pattern as ProcessRegistry.
 */
class EaProcessRegistry extends EventEmitter {
    private records = new Map<string, EaRecord>();

    register(record: EaRecord): void {
        const key = `${record.userId}_${record.login}`;
        this.records.set(key, record);
        logger.info('EA engine registered', { userId: record.userId, login: record.login, pid: record.pid });
    }

    unregister(userId: string, login: string): void {
        const key = `${userId}_${login}`;
        this.records.delete(key);
        logger.info('EA engine unregistered', { userId, login });
    }

    get(userId: string, login: string): EaRecord | undefined {
        return this.records.get(`${userId}_${login}`);
    }

    updateHeartbeat(userId: string, login: string, hb: EaRecord['lastHeartbeat']): void {
        const rec = this.get(userId, login);
        if (rec) rec.lastHeartbeat = hb;
    }

    all(): EaRecord[] {
        return Array.from(this.records.values());
    }
}

export const eaRegistry = new EaProcessRegistry();
