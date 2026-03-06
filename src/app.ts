import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mt5Routes from './api/routes/mt5.routes';
import healthRoutes from './api/routes/health.routes';
import { errorHandler } from './api/middleware/error-handler';
import { logger } from './config/logger';
import path from 'path';

export function createApp(): express.Application {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ────────────────────────────────────────────────────────────────────
  // Telegram Mini Apps are served from telegram.org domains
  app.use(
    cors({
      origin: '*', // We rely on cryptographic x-telegram-init-data, not cookies. Allow all WebView origins.
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'x-telegram-init-data'],
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
  
  app.use('/api', healthRoutes); // Move health to /api to prevent conflicts
  app.use('/api/mt5', mt5Routes);

  // ── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'NotFound', message: 'Route not found' });
  });

  // ── Centralised error handler ────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
