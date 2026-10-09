/**
 * RJ-020 — route, library and retrieval privacy, without a database.
 *
 * The database is replaced by a stand-in that behaves like the real tables in
 * the one way that matters here: a read that does not restrict rows to the
 * caller returns user A's row to whoever asks. Each test asks as user B. A
 * route that forgets the ownership rule therefore hands A's data to B and the
 * test fails. (privacyIsolation.pg.test.ts runs the same checks on Postgres.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const A = 'user_a';
const B = 'user_b';
const ADMIN = 'user_admin';
const A_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'PRIVATE-TO-A',
  content: 'PRIVATE-TO-A',
  claim_text: 'PRIVATE-TO-A',
  url: 'https://example.test/private-to-a',
  export_path: '/nowhere/a.jsonl.gz',
  label: 'a',
  status: 'failed',
  metadata: { ingested_by_user_id: A },
  count: 7,
  source_count: 7,
};

vi.hoisted(() => {
  process.env.ADMIN_USER_IDS = 'user_admin';
});

const db = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  /** SQL fragments that restrict a read to its caller. */
  const OWNER_RULES = [
    /lib_j\.user_id = \$\d+/,
    /lib_cr\.user_id = \$\d+/,
    /lib_r\.user_id = \$\d+/,
    /\buser_id\s*=\s*\$\d+/,
  ];
  const run = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    calls.push({ sql, params });
    const restricted = OWNER_RULES.some((rule) => rule.test(sql));
    // Restricted to an owner who is not A: A's row does not match.
    if (restricted && !params.includes('user_a')) return [];
    return [(globalThis as { __A_ROW__?: unknown }).__A_ROW__];
  };
  return { calls, run };
});

vi.mock('../db/pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/pool')>();
  return {
    ...actual,
    query: vi.fn(db.run),
    adminQuery: vi.fn(db.run),
    queryOne: vi.fn(
      async (sql: string, params?: unknown[]) => (await db.run(sql, params))[0] ?? null,
    ),
  };
});

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      req.auth = { userId: req.header('x-test-user') ?? null, orgId: null, sessionId: null };
      next();
    },
  };
});

const queueAdd = vi.hoisted(() => vi.fn(async () => ({ id: 'job' })));
vi.mock('../queue/queues', () => {
  const queue = { add: queueAdd, getJobCounts: vi.fn(async () => ({})) };
  return {
    QUEUE_NAMES: {},
    ingestionQueue: queue,
    embeddingQueue: queue,
    researchQueue: queue,
    atlasExportQueue: queue,
    reportExportQueue: queue,
    livingReportRevisionQueue: queue,
  };
});

const revisionService = vi.hoisted(() => ({
  createRevisionRequest: vi.fn(),
  createReportRevision: vi.fn(),
}));
vi.mock('../services/reasoning/reportRevisionService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../services/reasoning/reportRevisionService')>();
  return { ...actual, ...revisionService };
});

vi.mock('../services/openrouter/openrouterService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/openrouter/openrouterService')>();
  return {
    ...actual,
    generateEmbeddings: vi.fn(async () => {
      throw new Error('no embeddings in this test');
    }),
  };
});

import request from 'supertest';
import app from '../api/app';
import {
  ownClaimSql,
  ownSourceSql,
  publicSourceSql,
  retrievableSourceSql,
  sharedLibraryOwnerUserIds,
} from '../db/libraryScope';
import { findStoredSourceForContent } from '../services/ingestion/sourceDedupe';
import { retrieveChunksWithAudit } from '../services/retrieval/retrievalService';

const as = (user: string) => ({
  get: (url: string) => request(app).get(url).set('x-test-user', user),
  post: (url: string) => request(app).post(url).set('x-test-user', user),
  delete: (url: string) => request(app).delete(url).set('x-test-user', user),
});

const hasA = (body: unknown): boolean => JSON.stringify(body ?? null).includes('PRIVATE-TO-A');

beforeEach(() => {
  (globalThis as { __A_ROW__?: unknown }).__A_ROW__ = { ...A_ROW };
  db.calls.length = 0;
  queueAdd.mockClear();
  revisionService.createRevisionRequest.mockReset();
  revisionService.createReportRevision.mockReset();
});

describe('library lists, search, graph, atlas and statistics show only the caller’s own rows', () => {
  const LISTS = [
    '/api/sources',
    '/api/sources?search=PRIVATE',
    '/api/corpus/chunks',
    `/api/corpus/chunks?sourceId=${A_ROW.id}`,
    '/api/corpus/chunks?search=PRIVATE',
    '/api/corpus/claims',
    '/api/corpus/claims?search=PRIVATE',
    '/api/corpus/contradictions',
    '/api/corpus/tier-distribution',
    '/api/graph',
    '/api/atlas/points',
    '/api/atlas/exports',
  ];

  it.each(LISTS)('GET %s never returns user A’s row to user B', async (url) => {
    const res = await as(B).get(url);
    expect(res.status).toBe(200);
    expect(hasA(res.body)).toBe(false);
    // Every read ran with the caller named in it.
    expect(db.calls.length).toBeGreaterThan(0);
    for (const call of db.calls) {
      // The graph reads contradiction pairs by the claim ids it already selected for the caller.
      if (/claim_a_id = ANY/.test(call.sql)) continue;
      expect(call.params).toContain(B);
    }
  });

  it('GET /api/corpus/stats counts the caller’s rows and never reads the all-users view', async () => {
    const res = await as(B).get('/api/corpus/stats');
    expect(res.status).toBe(200);
    expect(res.body.source_count).toBe(0);
    expect(db.calls.some((c) => /FROM corpus_stats/.test(c.sql))).toBe(false);
    for (const call of db.calls) expect(call.params).toContain(B);
  });

  it('GET /api/atlas/embedded-count counts the caller’s rows', async () => {
    const res = await as(B).get('/api/atlas/embedded-count');
    expect(res.body).toEqual({ count: 0 });
  });

  it('an admin (existing admin configuration) sees the whole library', async () => {
    const res = await as(ADMIN).get('/api/sources');
    expect(hasA(res.body)).toBe(true);
    const stats = await as(ADMIN).get('/api/corpus/stats');
    expect(stats.body.source_count).toBe(7);
  });

  it('signed-out callers are refused', async () => {
    for (const url of LISTS) expect((await request(app).get(url)).status).toBe(401);
  });
});

describe('another user’s object by id answers 403 or 404', () => {
  it('GET /api/sources/:id', async () => {
    const res = await as(B).get(`/api/sources/${A_ROW.id}`);
    expect(res.status).toBe(404);
    expect(hasA(res.body)).toBe(false);
    expect((await as(A).get(`/api/sources/${A_ROW.id}`)).status).toBe(200);
  });

  it('DELETE /api/sources/:id', async () => {
    const res = await as(B).delete(`/api/sources/${A_ROW.id}`);
    expect(res.status).toBe(403);
    expect(db.calls.some((c) => /DELETE FROM sources/.test(c.sql))).toBe(false);
  });

  it('GET /api/graph?runId=<A’s run>', async () => {
    const res = await as(B).get(`/api/graph?runId=${A_ROW.id}`);
    expect(res.status).toBe(404);
    expect(hasA(res.body)).toBe(false);
  });

  it.each(['/api', ''])(
    'POST %s/reports/:id/revisions is refused before anything is written',
    async (prefix) => {
      const res = await as(B)
        .post(`${prefix}/reports/${A_ROW.id}/revisions`)
        .send({ requestText: 'x' });
      expect(res.status).toBe(404);
      expect(revisionService.createRevisionRequest).not.toHaveBeenCalled();
      expect(revisionService.createReportRevision).not.toHaveBeenCalled();
    },
  );

  it.each(['/api', ''])('POST %s/research/:id/retry-from-failure is refused', async (prefix) => {
    const res = await as(B).post(`${prefix}/research/${A_ROW.id}/retry-from-failure`);
    expect(res.status).toBe(404);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(db.calls.some((c) => /UPDATE research_runs/.test(c.sql))).toBe(false);
  });

  it('POST /api/reports/:reportId/monitors is refused', async () => {
    const res = await as(B).post(`/api/reports/${A_ROW.id}/monitors`).send({});
    expect(res.status).toBe(404);
  });

  it.each([
    `/api/research/${A_ROW.id}`,
    `/api/research/${A_ROW.id}/artifacts`,
    `/api/reports/${A_ROW.id}`,
    `/api/reports/${A_ROW.id}/reader`,
    `/api/reports/${A_ROW.id}/revisions`,
    `/api/reports/${A_ROW.id}/revisions/${A_ROW.id}`,
    `/api/reports/exports/${A_ROW.id}`,
    `/api/reports/exports/${A_ROW.id}/download`,
    `/api/atlas/exports/${A_ROW.id}/download`,
    `/api/ingestion/jobs/${A_ROW.id}`,
  ])('GET %s', async (url) => {
    const res = await as(B).get(url);
    expect([403, 404]).toContain(res.status);
    expect(hasA(res.body)).toBe(false);
  });

  it.each([
    '/api/research',
    '/api/reports',
    '/api/ingestion/jobs',
    '/api/reports/' + A_ROW.id + '/citations',
  ])('GET %s lists only the caller’s own', async (url) => {
    const res = await as(B).get(url);
    expect(hasA(res.body)).toBe(false);
  });
});

describe('exports', () => {
  it('there is no public file mount', async () => {
    expect((await request(app).get('/exports/anything.pdf')).status).toBe(404);
    expect((await as(B).get(`/exports/atlas_${A_ROW.id}.jsonl.gz`)).status).toBe(404);
  });

  it('an atlas export is built for the user who asked for it', async () => {
    const res = await as(B).post('/api/atlas/export').send({ label: 'mine' });
    expect(res.status).toBe(202);
    expect(queueAdd).toHaveBeenCalledWith(
      'atlas-export',
      expect.objectContaining({ requestedByUserId: B }),
    );
  });

  it('sending library text to an outside service is admin-only', async () => {
    expect((await as(B).post(`/api/atlas/exports/${A_ROW.id}/nomic-upload`)).status).toBe(403);
    expect((await as(A).post(`/api/atlas/exports/${A_ROW.id}/nomic-upload`)).status).toBe(403);
  });
});

describe('admin-only views require admin', () => {
  it.each([
    '/api/admin/users',
    `/api/admin/users/${A}`,
    '/api/admin/runs/lookup',
    '/api/admin/telemetry/runs',
    '/api/admin/audit-log',
    '/api/admin/cost/summary',
    '/api/admin/cost/timeseries',
    '/api/admin/cost/breakdown',
    '/api/admin/cost/reports',
    '/api/admin/metrics/overview',
    '/api/admin/reports',
    '/api/admin/corpus/list',
    '/api/admin/vendors/balances',
    '/api/admin/runtime/logs',
    '/api/admin/models',
  ])('GET %s', async (url) => {
    expect((await as(B).get(url)).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
  });
});

describe('the library visibility rule', () => {
  it('a user’s own sources: their ingestion jobs, their recorded ingests, their runs', () => {
    const sql = ownSourceSql('s', 4);
    expect(sql).toContain('lib_j.source_id = s.id AND lib_j.user_id = $4::text');
    expect(sql).toContain("NULLIF(s.metadata->>'ingested_by_user_id', '') = $4::text");
    expect(sql).toContain('lib_r.id = s.discovered_by_run_id AND lib_r.user_id = $4::text');
  });

  it('only discovery-fetched web sources are public', () => {
    expect(publicSourceSql('s')).toBe("s.imported_via = 'autonomous_discovery'");
  });

  it('a run reads public sources, its own, and its owner’s — nothing else', () => {
    const sql = retrievableSourceSql('s', { userParam: 1, runParam: 2 });
    expect(sql.startsWith("(s.imported_via = 'autonomous_discovery' OR ")).toBe(true);
    expect(sql).toContain('s.discovered_by_run_id::text = $2::text');
    expect(sql).toContain('lib_j.user_id = $1::text');
    expect(retrievableSourceSql('s', {})).toBe("(s.imported_via = 'autonomous_discovery')");
  });

  it('claims belong to the user whose run produced them', () => {
    expect(ownClaimSql('c', 1)).toContain('lib_cr.id = c.run_id AND lib_cr.user_id = $1::text');
  });

  it('no account’s documents are shared with other users unless the operator opts in', () => {
    delete process.env.SHARED_LIBRARY_OWNER_USER_IDS;
    expect(sharedLibraryOwnerUserIds()).toEqual([]);
    process.env.SHARED_LIBRARY_OWNER_USER_IDS = ' user_x , user_y ';
    expect(sharedLibraryOwnerUserIds()).toEqual(['user_x', 'user_y']);
    delete process.env.SHARED_LIBRARY_OWNER_USER_IDS;
  });
});

describe('retrieval for user B never returns user A’s private documents', () => {
  it('every library read in retrieval is limited to public sources and B’s own', async () => {
    const result = await retrieveChunksWithAudit({
      query: 'PRIVATE',
      userId: B,
      runId: '22222222-2222-4222-8222-222222222222',
      intentId: 'factual_report',
    });
    expect(hasA([...result.citableChunks, ...result.backgroundChunks])).toBe(false);
    const libraryReads = db.calls.filter((c) => /\bsources s\b/.test(c.sql));
    expect(libraryReads.length).toBeGreaterThan(0);
    for (const call of libraryReads) {
      expect(call.sql).toContain("s.imported_via = 'autonomous_discovery' OR ");
      expect(call.sql).toMatch(/lib_j\.user_id = \$\d+::text/);
      expect(call.params).toContain(B);
      expect(call.params).not.toContain(A);
    }
  });

  it('with no owner known, retrieval reads public sources only', async () => {
    await retrieveChunksWithAudit({ query: 'PRIVATE' });
    const libraryReads = db.calls.filter((c) => /\bsources s\b/.test(c.sql));
    expect(libraryReads.length).toBeGreaterThan(0);
    for (const call of libraryReads) {
      expect(call.sql).toContain("(s.imported_via = 'autonomous_discovery')");
      expect(call.sql).not.toContain('lib_j.user_id');
    }
  });
});

describe('identical content is stored per owner', () => {
  it('another user’s private copy is never reused', async () => {
    const { queryOne } = await import('../db/pool');
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: A_ROW.id, url: null })
      .mockResolvedValueOnce({ is_public: false, is_own: false })
      .mockResolvedValueOnce(null);
    const match = await findStoredSourceForContent({
      rawContent: 'same bytes',
      importedVia: 'manual_upload',
      ownerUserId: B,
    });
    expect(match.existing).toBeNull();
    const plain = (await import('crypto')).createHash('sha256').update('same bytes').digest('hex');
    expect(match.contentHash).not.toBe(plain);
  });

  it('a public or own copy is reused', async () => {
    const { queryOne } = await import('../db/pool');
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 's1', url: 'u' })
      .mockResolvedValueOnce({ is_public: true, is_own: false });
    const reusedPublic = await findStoredSourceForContent({ rawContent: 'x', ownerUserId: B });
    expect(reusedPublic.existing?.id).toBe('s1');
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 's2', url: 'u' })
      .mockResolvedValueOnce({ is_public: false, is_own: true });
    const reusedOwn = await findStoredSourceForContent({ rawContent: 'x', ownerUserId: B });
    expect(reusedOwn.existing?.id).toBe('s2');
  });
});
