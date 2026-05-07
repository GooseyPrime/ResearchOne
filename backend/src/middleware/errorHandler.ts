/**
 * Central error handler with PII redaction per WO O.
 * Structured logging with Winston. Sanitizes emails, tokens, and BYOK key fragments.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const PII_PATTERNS = [
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },
  { regex: /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, replacement: 'Bearer [TOKEN_REDACTED]' },
  { regex: /sk-or-v1-[A-Za-z0-9]{4,}/gi, replacement: 'sk-or-v1-[KEY_REDACTED]' },
  { regex: /sk-[A-Za-z0-9]{4,}/gi, replacement: 'sk-[KEY_REDACTED]' },
  { regex: /whsec_[A-Za-z0-9]{4,}/gi, replacement: 'whsec_[SECRET_REDACTED]' },
];

export function redactPii(text: string): string {
  let result = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

export function centralErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as unknown as Record<string, unknown>).requestId as string | undefined;
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

  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      requestId,
    });
  }
}
