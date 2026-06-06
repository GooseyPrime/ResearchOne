import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { TenantIsolationUnavailableError, TENANT_ISOLATION_UNAVAILABLE } from '../db/tenantScope';
import { config } from '../config';
import { logger } from '../utils/logger';

const PII_PATTERNS = [
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },
  { regex: /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, replacement: 'Bearer [TOKEN_REDACTED]' },
  { regex: /sk-or-v1-[A-Za-z0-9._-]{4,}/gi, replacement: 'sk-or-v1-[KEY_REDACTED]' },
  { regex: /sk-[A-Za-z0-9._-]{4,}/gi, replacement: 'sk-[KEY_REDACTED]' },
  { regex: /whsec_[A-Za-z0-9]{4,}/gi, replacement: 'whsec_[SECRET_REDACTED]' },
];

export function redactPii(text: string): string {
  let result = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

export function centralErrorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  const requestId = req.requestId;
  const userId = req.auth?.userId;

  const safeMessage = redactPii(err.message);
  const safeStack = err.stack ? redactPii(err.stack) : undefined;

  logger.error('unhandled_request_error', {
    requestId,
    userId,
    path: req.path,
    method: req.method,
    message: safeMessage,
    stack: safeStack,
  });

  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof TenantIsolationUnavailableError) {
    res.status(err.statusCode).json({
      error: TENANT_ISOLATION_UNAVAILABLE,
      message: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const maxMb = config.ingestion.maxFileSizeMb;
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: 'payload_too_large',
        message: `File exceeds the ${maxMb} MB upload limit.`,
        requestId,
      });
      return;
    }
    res.status(400).json({
      error: 'invalid_upload',
      message: err.message,
      requestId,
    });
    return;
  }

  const statusCode = (err as { statusCode?: number }).statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
    res.status(statusCode).json({
      error: (err as { code?: string }).code ?? 'request_failed',
      message: safeMessage,
      requestId,
    });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
    requestId,
  });
}
