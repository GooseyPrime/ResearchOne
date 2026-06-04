import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { config } from '../config';

export function formatMulterUploadError(err: unknown): { status: number; body: Record<string, string> } | null {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return {
        status: 413,
        body: {
          error: `File exceeds the ${config.ingestion.maxFileSizeMb} MB limit`,
          code: 'FILE_TOO_LARGE',
        },
      };
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return {
        status: 400,
        body: {
          error: 'Too many files attached',
          code: 'TOO_MANY_FILES',
        },
      };
    }
    return {
      status: 400,
      body: {
        error: err.message,
        code: 'UPLOAD_REJECTED',
      },
    };
  }

  if (err instanceof Error && err.message.startsWith('Unsupported supplemental file type')) {
    return {
      status: 400,
      body: {
        error: err.message,
        code: 'UNSUPPORTED_TYPE',
      },
    };
  }

  return null;
}

/** Express middleware wrapper for multer handlers with JSON error bodies. */
export function handleMulterUpload(
  upload: (req: Request, res: Response, next: NextFunction) => void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      const formatted = formatMulterUploadError(err);
      if (formatted) {
        res.status(formatted.status).json(formatted.body);
        return;
      }
      next(err as Error);
    });
  };
}
