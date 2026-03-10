import { Router, Request, Response, NextFunction } from 'express';
import { telegramAuthMiddleware } from '../middleware/telegram-auth.middleware';
import { upsertUserByTelegramId } from '../../services/user.service';
import {
    getSubscription,
    upsertSubscription,
    getActivationCode,
    markCodeUsed,
    insertActivationCode,
} from '../../database/queries';
import { logger } from '../../config/logger';
import crypto from 'crypto';

const router = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'changeme-admin-secret';

/**
 * GET /api/subscription/status
 * Returns the current user's subscription tier and expiry.
 */
router.get(
    '/status',
    telegramAuthMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = await upsertUserByTelegramId(req.telegramUser!.id);
            const sub = await getSubscription(user.id);

            if (!sub) {
                res.json({ tier: 'free', expiresAt: null, maxLevels: 0 });
                return;
            }

            // Check expiry
            const now = new Date();
            if (sub.expires_at && sub.expires_at < now) {
                res.json({ tier: 'free', expiresAt: sub.expires_at, expired: true, maxLevels: 0 });
                return;
            }

            const maxLevels = sub.tier === 'premium' ? 11 : sub.tier === 'standard' ? 3 : 0;
            res.json({ tier: sub.tier, expiresAt: sub.expires_at, expired: false, maxLevels });
        } catch (err) {
            next(err);
        }
    },
);

/**
 * POST /api/subscription/activate
 * Body: { code: string }
 * Activates a subscription using an activation code.
 */
router.post(
    '/activate',
    telegramAuthMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const code = (req.body?.code as string || '').trim().toUpperCase();
            if (!code) {
                res.status(400).json({ error: 'BadRequest', message: 'Activation code is required.' });
                return;
            }

            const user = await upsertUserByTelegramId(req.telegramUser!.id);
            const codeRow = await getActivationCode(code);

            if (!codeRow) {
                res.status(404).json({ error: 'InvalidCode', message: 'Code not found.' });
                return;
            }

            if (codeRow.used_by !== null) {
                res.status(400).json({ error: 'CodeUsed', message: 'This code has already been used.' });
                return;
            }

            // Calculate expiry
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + codeRow.duration_days);

            await upsertSubscription({
                userId: user.id,
                tier: codeRow.tier,
                expiresAt,
                activatedBy: 'code',
                activationCode: code,
            });

            await markCodeUsed(codeRow.id, user.id);

            logger.info('Subscription activated', { telegramId: req.telegramUser!.id, tier: codeRow.tier, code });
            res.json({ ok: true, tier: codeRow.tier, expiresAt, durationDays: codeRow.duration_days });
        } catch (err) {
            next(err);
        }
    },
);

/**
 * POST /api/admin/generate-code
 * Header: x-admin-secret
 * Body: { tier: 'standard'|'premium', durationDays: number, count?: number }
 * Generates activation codes for admin to distribute.
 */
router.post(
    '/generate-code',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const secret = req.headers['x-admin-secret'] as string;
            if (secret !== ADMIN_SECRET) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const tier = (req.body?.tier as string) || 'standard';
            const durationDays = parseInt(req.body?.durationDays ?? '30', 10);
            const count = Math.min(parseInt(req.body?.count ?? '1', 10), 50);

            const codes: string[] = [];
            for (let i = 0; i < count; i++) {
                const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
                const code = `EQUI-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
                await insertActivationCode({ code, tier, durationDays });
                codes.push(code);
            }

            logger.info('Admin generated activation codes', { tier, durationDays, count });
            res.json({ ok: true, codes });
        } catch (err) {
            next(err);
        }
    },
);

export default router;
