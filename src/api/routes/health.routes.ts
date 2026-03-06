import { Router, Request, Response } from 'express';
import { registry } from '../../config/metrics';
import { processRegistry } from '../../utils/process-monitor';

const router = Router();

/**
 * GET /health
 * Basic liveness probe — used by load balancers and Docker health checks.
 */
router.get('/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeInstances: processRegistry.size(),
  });
});

/**
 * GET /metrics
 * Prometheus text format — scrape this endpoint from your metrics server.
 */
router.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

export default router;
