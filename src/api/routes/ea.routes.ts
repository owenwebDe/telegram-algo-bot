import { Router, Request, Response, NextFunction } from 'express';
import { telegramAuthMiddleware } from '../middleware/telegram-auth.middleware';
import { upsertUserByTelegramId } from '../../services/user.service';
import {
    getEaConfig,
    upsertEaConfig,
    setEaRunning,
} from '../../database/queries';
import { eaRegistry } from '../../utils/ea-process-registry';
import { instanceManager } from '../../mt5/instance-manager';
import { logger } from '../../config/logger';

const router = Router();

// In-memory cache for placed count - avoids DB query on every 500ms EA status poll
const placedCache = new Map<string, { val: number; ts: number }>();

/**
 * GET /api/ea/config/:login
 * Returns saved EA configuration for the account.
 */
router.get(
    '/config/:login',
    telegramAuthMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const login = String(req.params.login);
            const user = await upsertUserByTelegramId(req.telegramUser!.id);
            const config = await getEaConfig(user.id, login);

            if (!config) {
                // Return defaults if no config saved yet
                res.json({
                    login,
                    tradeType: 'buy',
                    symbol1: 'XAUUSD',
                    symbol2: 'XAUUSD.',
                    initialLot: 0.1,
                    magicNo: 12345,
                    stopLoss: 0,
                    takeProfit: 0,
                    symbolToTrade: 'Sym1',
                    symbolToClose: 'Sym1',
                    tradeOnSameLevel: false,
                    slippage: 1,
                    levels: [],
                    isRunning: false,
                });
                return;
            }

            res.json({
                login: config.login,
                tradeType: config.trade_type,
                symbol1: config.symbol1,
                symbol2: config.symbol2,
                initialLot: config.initial_lot,
                magicNo: config.magic_no,
                stopLoss: config.stop_loss,
                takeProfit: config.take_profit,
                symbol_to_trade: config.symbol_to_trade,
                symbol_to_close: config.symbol_to_close,
                trade_on_same_level: config.trade_on_same_level,
                slippage: config.slippage,
                levels: config.levels,
                isRunning: config.is_running,
            });
        } catch (err) {
            next(err);
        }
    },
);

/**
 * POST /api/ea/config/:login
 * Saves EA configuration for the account.
 */
router.post(
    '/config/:login',
    telegramAuthMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const login = String(req.params.login);
            const user = await upsertUserByTelegramId(req.telegramUser!.id);
            const body = req.body;

            const saved = await upsertEaConfig({
                userId: user.id,
                login,
                config: {
                    trade_type: body.tradeType,
                    symbol1: body.symbol1,
                    symbol2: body.symbol2,
                    initial_lot: parseFloat(body.initialLot),
                    magic_no: parseInt(body.magicNo, 10),
                    stop_loss: parseFloat(body.stopLoss ?? 0),
                    take_profit: parseFloat(body.takeProfit ?? 0),
                    symbol_to_trade: body.symbolToTrade,
                    symbol_to_close: body.symbolToClose,
                    trade_on_same_level: Boolean(body.tradeOnSameLevel),
                    slippage: parseFloat(body.slippage ?? 1),
                    levels: Array.isArray(body.levels) ? body.levels : [],
                },
            });

            res.json({ ok: true, login, updatedAt: saved.updated_at });

            // Auto-restart EA if it's currently running so it picks up the new config
            const rec = eaRegistry.get(user.id.toString(), login);
            if (rec && rec.status === 'running') {
                logger.info('Config saved while EA running — auto-restarting', { userId: user.id, login });
                instanceManager.stopEaEngine(user.id.toString(), login);
                setTimeout(async () => {
                    try {
                        await instanceManager.startEaEngine(user.id.toString(), login);
                    } catch (e: any) {
                        logger.error('Auto-restart failed', { error: e.message });
                    }
                }, 3000);
            }
        } catch (err) {
            next(err);
        }
    },
);

/**
 * POST /api/ea/start/:login
 * Starts the EA engine for this account.
 */
router.post(
    '/start/:login',
    telegramAuthMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const login = String(req.params.login);
            const user = await upsertUserByTelegramId(req.telegramUser!.id);
            const config = await getEaConfig(user.id, login);

            // Allow starting even if no config is in DB - uses sensible defaults
            const eaConfig = config ? {
                tradeType: config.trade_type,
                symbol1: config.symbol1,
                symbol2: config.symbol2,
                initialLot: config.initial_lot,
                magicNo: config.magic_no,
                stopLoss: config.stop_loss,
                takeProfit: config.take_profit,
                symbolToTrade: config.symbol_to_trade,
                symbolToClose: config.symbol_to_close,
                tradeOnSameLevel: config.trade_on_same_level,
                slippage: config.slippage,
                levels: config.levels,
            } : {
                tradeType: 'buy',
                symbol1: 'XAUUSD',
                symbol2: 'XAUUSD.',
                initialLot: 0.01,
                magicNo: 12345,
                stopLoss: 0,
                takeProfit: 0,
                symbolToTrade: '1',
                symbolToClose: '1',
                tradeOnSameLevel: true,
                slippage: 1,
                levels: Array(11).fill(null).map((_, i) => ({
                    lot: 0.01 * Math.pow(2, i),
                    diffOpen: i + 1,
                    diffCut: i + 2,
                    numPairs: 1,
                    label: `Level ${i + 1}`,
                })),
            };

            instanceManager.startEaEngine(user.id.toString(), login, eaConfig);
            await setEaRunning(user.id, login, true);

            logger.info('EA engine start requested', { telegramId: req.telegramUser!.id, login });
            res.json({ ok: true, status: 'running' });
        } catch (err) {
            next(err);
        }
    },
);

/**
 * POST /api/ea/stop/:login
 * Stops the EA engine for this account.
 */
router.post(
    '/stop/:login',
    telegramAuthMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const login = String(req.params.login);
            const user = await upsertUserByTelegramId(req.telegramUser!.id);

            instanceManager.stopEaEngine(user.id.toString(), login);
            await setEaRunning(user.id, login, false);

            logger.info('EA engine stop requested', { telegramId: req.telegramUser!.id, login });
            res.json({ ok: true, status: 'stopped' });
        } catch (err) {
            next(err);
        }
    },
);

/**
 * GET /api/ea/status/:login
 * Returns live EA engine status + last heartbeat stats.
 */
router.get(
    '/status/:login',
    telegramAuthMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const login = String(req.params.login);
            const user = await upsertUserByTelegramId(req.telegramUser!.id);
            const rec = eaRegistry.get(user.id.toString(), login);

            // Use cached 'placed' count to avoid hammering DB on every 500ms poll
            const cacheKey = `${user.id}_${login}`;
            const cached = placedCache.get(cacheKey);
            let placedFromConfig = 0;
            if (cached && (Date.now() - cached.ts < 10000)) {
                placedFromConfig = cached.val;
            } else {
                try {
                    const config = await getEaConfig(user.id, login);
                    const levels: any[] = config?.levels || [];
                    for (const lvl of levels) {
                        const np = parseInt(lvl.numPairs || '0', 10);
                        if (np > 0 && (parseFloat(lvl.diffToTrade || '0') !== 0)) {
                            placedFromConfig += np;
                        }
                    }
                } catch { /* DB error — use 0 */ }
                placedCache.set(cacheKey, { val: placedFromConfig, ts: Date.now() });
            }

            if (!rec) {
                res.json({
                    running: false,
                    spreadBuy: null,
                    spreadSell: null,
                    activeLevels: [],
                    openPairs: 0,
                    eaProfit: 0,
                    tracker: { executed: 0, placed: placedFromConfig },
                    active_trades: [],
                    level_statuses: [],
                });
                return;
            }

            const hb = rec.lastHeartbeat;
            const liveExecuted = hb?.tracker?.executed ?? 0;

            res.json({
                running: rec.status === 'running',
                ...(hb ?? { spreadBuy: null, spreadSell: null, activeLevels: [], openPairs: 0, eaProfit: 0 }),
                tracker: { executed: liveExecuted, placed: placedFromConfig },
            });
        } catch (err) {
            next(err);
        }
    },
);

export default router;
