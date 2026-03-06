import { Router, Request, Response, NextFunction } from 'express';
import { telegramAuthMiddleware } from '../middleware/telegram-auth.middleware';
import { validateMt5Connect } from '../middleware/validate';
import {
  connectAccount,
  getAccountStatusByLogin,
  disconnectAccount,
} from '../../services/mt5.service';
import { logger } from '../../config/logger';

const router = Router();

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

      logger.info('MT5 connect request received', {
        telegramId,
        login,
        server,
        // password intentionally omitted
      });

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

export default router;
