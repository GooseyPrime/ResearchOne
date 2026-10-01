/**
 * A new run's attached files and links must be ingested AFTER the run row exists.
 *
 * Every source written by supplemental ingestion carries
 * `discovered_by_run_id = runId`, a foreign key to `research_runs`. The start
 * route used to ingest first and create the run afterwards, so any attachment
 * that finished ingesting before the run row existed failed that foreign key,
 * and the run went ahead without the user's sources.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction
    ) => {
      req.auth = { userId: 'user_attachment_order_test', orgId: null, sessionId: null };
      next();
    },
  };
});

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  checkTierAccessMock: vi.fn(),
  ingestMock: vi.fn(),
  queueAddMock: vi.fn(),
  insertRunMock: vi.fn(),
  creditContextMock: vi.fn(),
  calls: [] as string[],
}));

vi.mock('../db/pool', () => ({
  query: mocks.queryMock,
  withTransaction: vi.fn(),
  rlsStore: {
    run: <T>(_ctx: unknown, fn: () => T): T => fn(),
    getStore: () => undefined,
  },
}));

vi.mock('../services/tier/tierService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/tier/tierService')>();
  return {
    ...actual,
    checkTierAccess: mocks.checkTierAccessMock,
    getUserTier: vi.fn().mockResolvedValue({ tier: 'pro', current_period_reports_used: 0 }),
  };
});

vi.mock('../services/billing/walletService', () => ({
  getWalletSummary: vi.fn().mockResolvedValue({ balanceCents: 10000 }),
}));

vi.mock('../services/billing/subscriptionService', () => ({
  getUserSubscription: vi.fn().mockResolvedValue({ tier: 'pro', status: 'active' }),
}));

vi.mock('../services/billing/entitlementTier', () => ({
  resolveEffectiveEntitlementTier: vi.fn().mockReturnValue('pro'),
}));

vi.mock('../services/research/researchSupplementalIngest', () => ({
  ingestSupplementalForRun: mocks.ingestMock,
}));

vi.mock('../services/research/spinoffService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/research/spinoffService')>();
  return {
    ...actual,
    insertQueuedResearchRunWithLineage: mocks.insertRunMock,
  };
});

vi.mock('../middleware/creditEnforcement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/creditEnforcement')>();
  return {
    ...actual,
    buildCreditChargeContextForRun: mocks.creditContextMock,
  };
});

vi.mock('../queue/queues', () => ({
  researchQueue: { add: mocks.queueAddMock },
  intellmeDeletionQueue: { add: vi.fn() },
}));

import request from 'supertest';
import testApp from '../api/app';

function sqlCalls(): string[] {
  return mocks.queryMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  mocks.queryMock.mockReset();
  mocks.checkTierAccessMock.mockReset();
  mocks.ingestMock.mockReset();
  mocks.queueAddMock.mockReset();
  mocks.insertRunMock.mockReset();
  mocks.creditContextMock.mockReset();
  mocks.calls.length = 0;

  mocks.queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  mocks.checkTierAccessMock.mockResolvedValue({ allowed: true });
  mocks.insertRunMock.mockImplementation(async () => {
    mocks.calls.push('insert_run');
  });
  mocks.ingestMock.mockImplementation(async () => {
    mocks.calls.push('ingest');
    return {
      urlsQueued: 1,
      filesQueued: 0,
      filesAttempted: 0,
      jobIds: ['job-url-1'],
      fileOutcomes: [],
    };
  });
  mocks.queueAddMock.mockImplementation(async () => {
    mocks.calls.push('queue');
  });
  mocks.creditContextMock.mockResolvedValue({ ok: true, context: undefined });
});

const withLink = {
  query: 'What does the attached report say about grid storage?',
  supplementalUrls: ['https://example.org/grid-storage-report'],
};

describe('start route: attachments are ingested after the run exists', () => {
  it('creates the run row before ingestion starts, then queues the run', async () => {
    const res = await request(testApp).post('/api/research').send(withLink);

    expect(res.status).toBe(202);
    expect(mocks.calls).toEqual(['insert_run', 'ingest', 'queue']);
  });

  it('creates the run with an empty attachment list and records the attachments after ingestion', async () => {
    await request(testApp).post('/api/research').send(withLink);

    expect(mocks.insertRunMock).toHaveBeenCalledTimes(1);
    expect(mocks.insertRunMock.mock.calls[0][0].attachmentsJson).toBe('[]');

    const update = mocks.queryMock.mock.calls.find((call) =>
      String(call[0]).includes('SET supplemental_attachments')
    );
    expect(update).toBeDefined();
    const recorded = JSON.parse(String(update?.[1]?.[0]));
    expect(recorded).toEqual([
      { kind: 'url', url: 'https://example.org/grid-storage-report', ingestion_job_id: 'job-url-1' },
    ]);
  });

  it('does not write an attachment list when nothing was attached', async () => {
    mocks.ingestMock.mockImplementation(async () => {
      mocks.calls.push('ingest');
      return { urlsQueued: 0, filesQueued: 0, filesAttempted: 0, jobIds: [], fileOutcomes: [] };
    });

    const res = await request(testApp).post('/api/research').send({ query: 'What is grid-scale storage?' });

    expect(res.status).toBe(202);
    expect(sqlCalls().some((sql) => sql.includes('SET supplemental_attachments'))).toBe(false);
  });

  it('still queues the run when the attachment list cannot be recorded', async () => {
    mocks.queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SET supplemental_attachments')) throw new Error('db hiccup');
      return { rows: [], rowCount: 0 };
    });

    const res = await request(testApp).post('/api/research').send(withLink);

    expect(res.status).toBe(202);
    expect(mocks.calls).toEqual(['insert_run', 'ingest', 'queue']);
  });

  it('marks the run failed and does not queue it when ingestion throws', async () => {
    mocks.ingestMock.mockImplementation(async () => {
      mocks.calls.push('ingest');
      throw new Error('ingestion queue unavailable');
    });

    const res = await request(testApp).post('/api/research').send(withLink);

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(mocks.queueAddMock).not.toHaveBeenCalled();
    const failed = mocks.queryMock.mock.calls.find((call) =>
      String(call[0]).includes("SET status='failed'")
    );
    expect(failed).toBeDefined();
    expect(failed?.[1]?.[0]).toBe('Attached sources could not be processed');
  });
});
