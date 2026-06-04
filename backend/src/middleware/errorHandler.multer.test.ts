import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { centralErrorHandler } from './errorHandler';

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: unknown };
}

describe('centralErrorHandler multer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 413 only for LIMIT_FILE_SIZE', () => {
    const err = new multer.MulterError('LIMIT_FILE_SIZE', 'file');
    const res = mockRes();
    centralErrorHandler(err, { path: '/api/ingestion/file', method: 'POST' } as Request, res, vi.fn() as NextFunction);
    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({ error: 'payload_too_large' });
  });

  it('returns 400 for other MulterError codes', () => {
    const err = new multer.MulterError('LIMIT_FILE_COUNT', 'files');
    const res = mockRes();
    centralErrorHandler(err, { path: '/api/ingestion/file', method: 'POST' } as Request, res, vi.fn() as NextFunction);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_upload' });
  });
});
