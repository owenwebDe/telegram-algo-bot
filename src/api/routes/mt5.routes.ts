import { Router, Request, Response, NextFunction } from 'express';
import { telegramAuthMiddleware } from '../middleware/telegram-auth.middleware';
import { validateMt5Connect } from '../middleware/validate';
import {
  connectAccount,
  getAccountStatusByLogin,
  disconnectAccount,
  getTradeHistory,
  closeAllAccountTrades,
} from '../../services/mt5.service';
import { logger } from '../../config/logger';

const router = Router();

/**
 * POST /api/mt5/log
 * Frontend sends log messages here so they appear in the VPS terminal.
 * No auth required — this is a debugging/monitoring tool.
 */
router.post(
  '/log',
  (req: Request, res: Response): void => {
    const msg = req.body?.message || '(empty)';
    logger.info(`[FRONTEND] ${msg}`);
    res.status(200).json({ ok: true });
  },
);

/**
 * POST /api/mt5/connect
 *
 * Body: { login: string, password: string, server: string }
 * Header: x-telegram-init-data (Telegram Mini App initData)
 *
 * Validates the request, encrypts the password, queues an MT5 launch job,
 * and returns immediately with job tracking information.
 */
router.post(
  '/connect',
  telegramAuthMiddleware,
  ...validateMt5Connect,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { login, password, server } = req.body as {
        login: string;
        password: string;
        server: string;
      };

      const telegramId = req.telegramUser!.id;

      logger.info(`VPS TERMINAL EVENT: User clicked Connect Terminal button! [Telegram ID: ${telegramId}, Login: ${login}, Server: ${server}]`);

      const result = await connectAccount(telegramId, login, password, server);

      res.status(200).json({
        status: result.status,
        account: parseInt(login, 10) || login,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/mt5/status/:accountId
 *
 * Returns current connection status.
 */
router.get(
  '/status/:accountId',
  telegramAuthMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const accountId = req.params.accountId as string;

      if (!accountId) {
        res.status(400).json({
          error: 'BadRequest',
          message: 'Missing accountId param',
        });
        return;
      }

      const status = await getAccountStatusByLogin(req.telegramUser!.id, accountId);

      if (!status) {
        res.status(404).json({
          error: 'NotFound',
          message: 'MT5 account not found for this user',
        });
        return;
      }

      res.json({
        status: status.status,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/mt5/disconnect/:login?server=SERVER_NAME
 *
 * Kills the running MT5 terminal and marks account as disconnected.
 */
router.delete(
  '/disconnect/:login',
  telegramAuthMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const login = req.params.login as string;
      const server = req.query['server'] as string;

      if (!login || !server) {
        res.status(400).json({
          error: 'BadRequest',
          message: 'Missing login param or server query param',
        });
        return;
      }

      const result = await disconnectAccount(req.telegramUser!.id, login, server);

      if (!result.ok) {
        res.status(404).json({ error: 'NotFound', message: result.message });
        return;
      }

      res.json({ status: 'disconnected', message: result.message });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/mt5/data/:login
 *
 * Returns real-time account info, prices, and open positions.
 */
router.get(
  '/data/:login',
  telegramAuthMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const login = req.params.login as string;
      const telegramId = req.telegramUser!.id;

      if (!login) {
        res.status(400).json({ error: 'BadRequest', message: 'Missing login param' });
        return;
      }

      const { getAccountData } = await import('../../services/mt5.service');
      const data = await getAccountData(telegramId, login);

      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/mt5/close-all/:login
 *
 * Closes all open MT5 positions for the account.
 * Body: { magic?: number }  — if magic provided, only closes positions with that magic number.
 */
router.post(
  '/close-all/:login',
  telegramAuthMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const login      = req.params.login as string;
      const magic      = req.body?.magic ? parseInt(req.body.magic) : undefined;
      const telegramId = req.telegramUser!.id;

      if (!login) {
        res.status(400).json({ error: 'BadRequest', message: 'Missing login param' });
        return;
      }

      logger.info('Close all trades requested', { telegramId, login, magic });

      const result = await closeAllAccountTrades(telegramId, login, magic);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/mt5/history/:login?days=1&magic=12345
 *
 * Returns closed trade pair history from MT5 deal history.
 * days=1 → today, days=7 → week, days=90 → all
 */
router.get(
  '/history/:login',
  telegramAuthMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const login  = req.params.login as string;
      const hours  = Math.min(Math.max(parseInt(req.query['hours'] as string) || 24, 1), 8760);
      const magic  = req.query['magic'] ? parseInt(req.query['magic'] as string) : undefined;
      const telegramId = req.telegramUser!.id;

      if (!login) {
        res.status(400).json({ error: 'BadRequest', message: 'Missing login param' });
        return;
      }

      const data = await getTradeHistory(telegramId, login, hours, magic);

      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
