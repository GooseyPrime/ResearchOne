import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      req.auth = {
        userId: 'user_test',
        orgId: null,
        sessionId: null,
        payload: { email: 'test@example.com' },
      };
      next();
    },
  };
});

const feedbackMocks = vi.hoisted(() => ({
  createFeedbackSubmission: vi.fn(),
  getFeedbackSubmissionForUser: vi.fn(),
}));

vi.mock('../services/feedback/feedbackSubmissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/feedback/feedbackSubmissions')>();
  return {
    ...actual,
    createFeedbackSubmission: feedbackMocks.createFeedbackSubmission,
    getFeedbackSubmissionForUser: feedbackMocks.getFeedbackSubmissionForUser,
  };
});

import request from 'supertest';
import testApp from '../api/app';

beforeEach(() => {
  feedbackMocks.createFeedbackSubmission.mockReset();
  feedbackMocks.getFeedbackSubmissionForUser.mockReset();
});

describe('POST /api/feedback', () => {
  it('creates a feedback submission', async () => {
    feedbackMocks.createFeedbackSubmission.mockResolvedValue({
      id: 'fb-uuid-1',
      status: 'received',
    });

    const res = await request(testApp)
      .post('/api/feedback')
      .send({
        category: 'feature_suggestion',
        subject: 'Export to BibTeX',
        message: 'Please add BibTeX export for dossiers.',
        metadata: { currentPage: '/app/research' },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.ticketId).toBe('fb-uuid-1');
    expect(feedbackMocks.createFeedbackSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_test',
        category: 'feature_suggestion',
      }),
    );
  });

  it('rejects invalid category', async () => {
    const res = await request(testApp)
      .post('/api/feedback')
      .send({ category: 'invalid', subject: 'Hi', message: 'Body' });

    expect(res.status).toBe(400);
    expect(feedbackMocks.createFeedbackSubmission).not.toHaveBeenCalled();
  });
});

describe('GET /api/feedback/:ticketId', () => {
  it('returns submission status for the authenticated user', async () => {
    feedbackMocks.getFeedbackSubmissionForUser.mockResolvedValue({
      id: 'fb-uuid-1',
      status: 'received',
      updated_at: '2026-05-28T00:00:00.000Z',
    });

    const res = await request(testApp).get('/api/feedback/fb-uuid-1');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');
    expect(res.body.updatedAt).toBe('2026-05-28T00:00:00.000Z');
  });
});
