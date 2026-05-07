import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  (req as unknown as Record<string, unknown>).requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const start = Date.now();

  res.on('finish', () => {
    const latencyMs = Date.now() - start;
    logger.info('request_completed', {
      requestId,
      userId: req.auth?.userId ?? null,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      latencyMs,
    });
  });

  next();
}
