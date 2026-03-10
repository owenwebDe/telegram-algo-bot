import { Telegraf, Markup } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Telegram Bot Service
 * handles /start command and provides the entry point to the Mini App
 */
export const bot = new Telegraf(env.telegramBotToken);

export function startBot(): void {
    bot.start((ctx) => {
        const firstName = ctx.from?.first_name || 'Trader';

        const welcomeMessage = `
<b>🚀 Welcome to Equivault AI, ${firstName}!</b>

Experience the next generation of automated trading right inside Telegram. Leverage AI-driven insights and lightning-fast MT5 integration.

<b>Main Features:</b>
• 📊 <b>Live Market Monitor:</b> Real-time spreads and price action.
• 🤖 <b>MT5 Integration:</b> Secure, seamless account management.
• 🔔 <b>Smart Alerts:</b> Stay ahead with instant level-hit notifications.
• 💎 <b>Premium UI:</b> A trading experience designed for performance.

Click the button below to launch your dashboard and start trading!
    `;

        ctx.replyWithHTML(welcomeMessage,
            Markup.inlineKeyboard([
                [Markup.button.webApp('🚀 Open Equivault AI', env.webappUrl)]
            ])
        ).catch(err => {
            logger.error('Failed to send welcome message', { error: err.message });
        });
    });

    bot.launch().then(() => {
        logger.info('Telegram bot service started', { webappUrl: env.webappUrl });
    }).catch((err) => {
        logger.error('Failed to start Telegram bot', { error: err.message });
    });
}

export function stopBot(): void {
    bot.stop();
    logger.info('Telegram bot service stopped');
}
