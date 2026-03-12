import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      telegramUser?: TelegramUser;
    }
  }
}

/**
 * Validates the Telegram Web App init data according to the official spec:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Returns the parsed user or null if validation fails.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 600,
): { ok: true; user: TelegramUser } | { ok: false; reason: string } {
  if (!initData || !botToken) {
    return { ok: false, reason: 'Missing initData or bot token' };
  }

  const params = new URLSearchParams(initData);
  const providedHash = params.get('hash');
  if (!providedHash) {
    return { ok: false, reason: 'Missing Telegram hash' };
  }

  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  let hashMatch: boolean;
  try {
    hashMatch = crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(providedHash, 'hex'),
    );
  } catch {
    return { ok: false, reason: 'Hash length mismatch' };
  }

  if (!hashMatch) {
    return { ok: false, reason: 'Invalid Telegram hash signature' };
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'Expired Telegram session' };
  }

  let user: TelegramUser | null = null;
  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    return { ok: false, reason: 'Invalid user JSON in initData' };
  }

  if (!user?.id) {
    return { ok: false, reason: 'Missing user.id in Telegram data' };
  }

  return { ok: true, user };
}

/**
 * Express middleware that validates the `x-telegram-init-data` header.
 * On success, attaches `req.telegramUser`.
 */
export function telegramAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const initData = req.headers['x-telegram-init-data'];

  // ── Dev-mode bypass ───────────────────────────────────────────────────────
  // When running outside of production AND no initData is provided,
  // assign a dev user so the full flow can be tested from any browser.
  if (!initData || typeof initData !== 'string' || initData.trim() === '') {
    if (env.allowAuthBypass) {
      logger.warn('DEV MODE: Telegram auth bypassed — assigning dev user (id: 1)');
      req.telegramUser = {
        id: 1,
        first_name: 'DevUser',
        username: 'dev_tester',
      };
      next();
      return;
    }

    logger.warn('Frontend connection blocked: Missing Telegram initData.');
    res.status(401).json({ error: 'Unauthorized', message: 'Missing Telegram environment. Please open within the Telegram App Bot Menu.' });
    return;
  }

  const result = verifyTelegramInitData(initData, env.telegramBotToken);
  if (!result.ok) {
    if (env.allowAuthBypass) {
      logger.warn('DEV MODE: Telegram auth failed but bypassed', { reason: result.reason });
      req.telegramUser = { id: 1, first_name: 'DevUser', username: 'dev_tester' };
      next();
      return;
    }
    logger.warn('Telegram auth failed', { reason: result.reason, ip: req.ip });
    res.status(401).json({ error: 'Unauthorized', message: result.reason });
    return;
  }

  req.telegramUser = result.user;
  next();
}
