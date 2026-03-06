import { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger';
import { mt5ConnectErrorsTotal } from '../../config/metrics';

export interface ApiError extends Error {
  statusCode?: number;
}

export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;

  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    status: statusCode,
    error: err.message,
    stack: err.stack,
  });

  mt5ConnectErrorsTotal.inc({ reason: err.message.slice(0, 64) });

  res.status(statusCode).json({
    error: statusCode === 500 ? 'InternalServerError' : 'Error',
    message: statusCode === 500 ? 'An unexpected error occurred' : err.message,
  });
}
