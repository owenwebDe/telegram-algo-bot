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
                symbolToTrade: config.symbol_to_trade,
                symbolToClose: config.symbol_to_close,
                tradeOnSameLevel: config.trade_on_same_level,
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
                    levels: Array.isArray(body.levels) ? body.levels : [],
                },
            });

            res.json({ ok: true, login, updatedAt: saved.updated_at });
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

            if (!config) {
                res.status(400).json({ error: 'NoConfig', message: 'Save configuration first.' });
                return;
            }

            const eaConfig = {
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
                levels: config.levels,
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

            if (!rec) {
                res.json({ running: false, spreadBuy: null, spreadSell: null, activeLevels: [], openPairs: 0, eaProfit: 0 });
                return;
            }

            res.json({
                running: rec.status === 'running',
                ...(rec.lastHeartbeat ?? { spreadBuy: null, spreadSell: null, activeLevels: [], openPairs: 0, eaProfit: 0 }),
            });
        } catch (err) {
            next(err);
        }
    },
);

export default router;
