import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({
  config: {
    nodeEnv: 'production',
    bugnote: { webhookSecret: '' },
  },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import request from 'supertest';
import express from 'express';
import bugnoteRouter from '../api/webhooks/bugnote';

describe('POST /api/webhooks/bugnote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 in production when webhook secret is unset', async () => {
    const app = express();
    app.use(express.raw({ type: '*/*' }));
    app.use('/api/webhooks/bugnote', bugnoteRouter);

    const res = await request(app)
      .post('/api/webhooks/bugnote/')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'test' }));

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Webhook not configured' });
  });
});
