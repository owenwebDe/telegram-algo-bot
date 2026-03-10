import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mt5Routes from './api/routes/mt5.routes';
import eaRoutes from './api/routes/ea.routes';
import subscriptionRoutes from './api/routes/subscription.routes';
import healthRoutes from './api/routes/health.routes';
import { errorHandler } from './api/middleware/error-handler';
import { logger } from './config/logger';
import path from 'path';

export function createApp(): express.Application {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────────
  // Helmet CSP must allow the Telegram WebApp SDK and our inline scripts.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://telegram.org"],
          connectSrc: ["'self'", "https://*.trycloudflare.com"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }),
  );

  // ── CORS ────────────────────────────────────────────────────────────────────
  // Telegram Mini Apps are served from telegram.org domains
  app.use(
    cors({
      origin: '*', // We rely on cryptographic x-telegram-init-data, not cookies. Allow all WebView origins.
      methods: ['GET', 'POST', 'DELETE', 'PUT'],
      allowedHeaders: ['Content-Type', 'x-telegram-init-data', 'x-admin-secret'],
    }),
  );

  // ── Body parsing ────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '16kb' }));

  // ── Request logging ─────────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    logger.info('Incoming request', { method: req.method, path: req.path, ip: req.ip });
    next();
  });

  // ── Routes ───────────────────────────────────────────────────────────────────
  // Serve Telegram Mini App static frontend
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.use('/api', healthRoutes);
  app.use('/api/mt5', mt5Routes);
  app.use('/api/ea', eaRoutes);
  app.use('/api/subscription', subscriptionRoutes);
  app.use('/api/admin', subscriptionRoutes); // generate-code lives on /api/admin/generate-code

  // ── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'NotFound', message: 'Route not found' });
  });

  // ── Centralised error handler ────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
