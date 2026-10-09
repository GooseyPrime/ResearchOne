/**
 * RJ-020 — privacy checks against a real Postgres.
 *
 * Runs only when PRIVACY_TEST_DATABASE_URL points at a disposable database
 * that has the migrations applied (never production). Two users each own a
 * run, a report, uploads, claims and exports; every check then asks, as the
 * other user, for the first user's things.
 *
 *   PRIVACY_TEST_DATABASE_URL=postgres://… npx vitest run src/__tests__/privacyIsolation.pg.test.ts
 *
 * The same rules are covered without a database in privacyRoutes.test.ts,
 * which runs in CI.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const DB_URL = process.env.PRIVACY_TEST_DATABASE_URL;

vi.hoisted(() => {
  if (process.env.PRIVACY_TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.PRIVACY_TEST_DATABASE_URL;
    process.env.ADMIN_USER_IDS = 'user_admin';
  }
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
      const userId = req.header('x-test-user') ?? null;
      req.auth = { userId, orgId: null, sessionId: null };
      next();
    },
  };
});

vi.mock('../queue/queues', () => {
  const queue = { add: vi.fn(async () => ({ id: 'job' })), getJobCounts: vi.fn(async () => ({})) };
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

vi.mock('../services/openrouter/openrouterService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/openrouter/openrouterService')>();
  return {
    ...actual,
    // No model calls: retrieval falls back to its full-text search.
    generateEmbeddings: vi.fn(async () => {
      throw new Error('embeddings are not available in this test');
    }),
  };
});

import request from 'supertest';
import app from '../api/app';
import { adminQuery, getPool, initDb } from '../db/pool';
import { ownSourceSql, retrievableSourceSql } from '../db/libraryScope';
import { findStoredSourceForContent } from '../services/ingestion/sourceDedupe';
import { defaultSocketAccessDeps } from '../realtime/socketAccess';
import { defaultOwnerLookups } from '../realtime/privateEmit';
import { runAtlasExport } from '../services/embedding/atlasExport';
import * as fs from 'fs';
import * as zlib from 'zlib';

const A = 'user_a';
const B = 'user_b';
const ADMIN = 'user_admin';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RUN_A = id(1);
const RUN_B = id(2);
const REPORT_A = id(3);
const REPORT_B = id(4);
const SRC_A_UPLOAD = id(10);
const SRC_B_UPLOAD = id(11);
const SRC_PUBLIC = id(12);
const SRC_A_ATTACHED = id(13);
const JOB_A = id(20);
const JOB_B = id(21);
const CLAIM_A1 = id(30);
const CLAIM_A2 = id(31);
const CLAIM_B1 = id(32);
const CONTRA_A = id(40);
const EXPORT_A = id(50);

const A_PRIVATE_TEXT = 'zebrafish memo PRIVATE-TO-A internal figures';
const B_PRIVATE_TEXT = 'zebrafish notes PRIVATE-TO-B draft';
const PUBLIC_TEXT = 'zebrafish public paper from the open web';
const A_ATTACHED_TEXT = 'zebrafish attachment ATTACHED-BY-A';

/** True when the database has the real pgvector column (a plain array stands in for it otherwise). */
let hasVectorType = false;

async function seed(): Promise<void> {
  const column = await adminQuery<{ udt_name: string }>(
    `SELECT udt_name FROM information_schema.columns WHERE table_name='embeddings' AND column_name='vector'`,
  );
  hasVectorType = column[0]?.udt_name === 'vector';
  const vectorLiteral = hasVectorType
    ? `[${Array.from({ length: 1536 }, () => '0.1').join(',')}]`
    : '{0.1,0.2}';
  await adminQuery(
    `TRUNCATE contradictions, claims, embeddings, chunks, documents, ingestion_jobs, atlas_exports,
              report_revision_requests, sources, reports, research_runs CASCADE`,
  );
  await adminQuery(
    `INSERT INTO users (id, email) VALUES ($1, 'a@example.test'), ($2, 'b@example.test'), ($3, 'admin@example.test')
     ON CONFLICT (id) DO NOTHING`,
    [A, B, ADMIN],
  );
  await adminQuery(
    `INSERT INTO research_runs (id, title, query, status, user_id) VALUES
       ($1, 'A run', 'A SECRET QUESTION', 'failed', $3),
       ($2, 'B run', 'B question', 'failed', $4)`,
    [RUN_A, RUN_B, A, B],
  );
  await adminQuery(
    `INSERT INTO reports (id, run_id, title, query, status, user_id) VALUES
       ($1, $3, 'A report', 'A SECRET QUESTION', 'finalized', $5),
       ($2, $4, 'B report', 'B question', 'finalized', $6)`,
    [REPORT_A, REPORT_B, RUN_A, RUN_B, A, B],
  );
  const sources: Array<[string, string, string, string, string | null, string | null, string]> = [
    [SRC_A_UPLOAD, 'A upload', 'manual_upload', A_PRIVATE_TEXT, null, A, 'hash-a'],
    [SRC_B_UPLOAD, 'B upload', 'manual_upload', B_PRIVATE_TEXT, null, B, 'hash-b'],
    [SRC_PUBLIC, 'Public paper', 'autonomous_discovery', PUBLIC_TEXT, RUN_A, null, 'hash-p'],
    [SRC_A_ATTACHED, 'A attachment', 'manual_url', A_ATTACHED_TEXT, RUN_A, null, 'hash-t'],
  ];
  let n = 100;
  for (const [sid, title, via, text, run, ingestedBy, hash] of sources) {
    await adminQuery(
      `INSERT INTO sources (id, title, url, source_type, raw_content, content_hash, imported_via,
                            discovered_by_run_id, discovery_query, tags, metadata)
       VALUES ($1, $2, $3, 'web_url', $4, $5, $6, $7, $8, '{}', $9)`,
      [
        sid,
        title,
        `https://example.test/${sid}`,
        text,
        hash,
        via,
        run,
        run ? 'A SECRET QUESTION' : null,
        JSON.stringify(ingestedBy ? { ingested_by_user_id: ingestedBy } : {}),
      ],
    );
    const doc = id(n++);
    const chunk = id(n++);
    await adminQuery(`INSERT INTO documents (id, source_id, content) VALUES ($1, $2, $3)`, [
      doc,
      sid,
      text,
    ]);
    await adminQuery(
      `INSERT INTO chunks (id, document_id, source_id, chunk_index, content) VALUES ($1, $2, $3, 0, $4)`,
      [chunk, doc, sid, text],
    );
    await adminQuery(
      `INSERT INTO embeddings (id, chunk_id, model, dimensions, vector) VALUES ($1, $2, 'test', 1536, $3)`,
      [id(n++), chunk, vectorLiteral],
    );
  }
  await adminQuery(
    `INSERT INTO ingestion_jobs (id, source_type, status, source_id, user_id) VALUES
       ($1, 'web_url', 'completed', $3, $5),
       ($2, 'web_url', 'completed', $4, $6)`,
    [JOB_A, JOB_B, SRC_A_UPLOAD, SRC_B_UPLOAD, A, B],
  );
  await adminQuery(
    `INSERT INTO claims (id, source_id, claim_text, run_id, evidence_tier) VALUES
       ($1, $4, 'A FINDING ONE', $6, 'inference'),
       ($2, $4, 'A FINDING TWO', $6, 'inference'),
       ($3, $5, 'B finding', $7, 'inference')`,
    [CLAIM_A1, CLAIM_A2, CLAIM_B1, SRC_PUBLIC, SRC_B_UPLOAD, RUN_A, RUN_B],
  );
  await adminQuery(
    `INSERT INTO contradictions (id, claim_a_id, claim_b_id, description, run_id)
     VALUES ($1, $2, $3, 'A CONTRADICTION', $4)`,
    [CONTRA_A, CLAIM_A1, CLAIM_A2, RUN_A],
  );
  await adminQuery(`INSERT INTO atlas_exports (id, label, user_id) VALUES ($1, 'A export', $2)`, [
    EXPORT_A,
    A,
  ]);
}

const as = (user: string) => ({
  get: (url: string) => request(app).get(url).set('x-test-user', user),
  post: (url: string) => request(app).post(url).set('x-test-user', user),
  delete: (url: string) => request(app).delete(url).set('x-test-user', user),
});

const A_MARKERS = [
  'PRIVATE-TO-A',
  'ATTACHED-BY-A',
  'A SECRET QUESTION',
  'A FINDING',
  'A CONTRADICTION',
];
function expectNothingOfA(body: unknown): void {
  const text = JSON.stringify(body);
  for (const marker of A_MARKERS) expect(text).not.toContain(marker);
  for (const foreign of [SRC_A_UPLOAD, SRC_A_ATTACHED, RUN_A, REPORT_A, CLAIM_A1, CLAIM_A2, A]) {
    expect(text).not.toContain(foreign);
  }
}

describe.skipIf(!DB_URL)('privacy isolation against a real database', () => {
  beforeAll(async () => {
    await initDb();
    await seed();
  });

  afterAll(async () => {
    await getPool().end();
  });

  describe('lists and search show only the caller’s own library', () => {
    it('sources list', async () => {
      const res = await as(B).get('/api/sources');
      expect(res.status).toBe(200);
      expect((res.body as Array<{ id: string }>).map((s) => s.id)).toEqual([SRC_B_UPLOAD]);
      expectNothingOfA(res.body);
    });

    it('sources search cannot find another user’s source by name', async () => {
      const res = await as(B).get('/api/sources').query({ search: 'A upload' });
      expect(res.body).toEqual([]);
    });

    it('chunks list, chunks by source id, and full-text search', async () => {
      const all = await as(B).get('/api/corpus/chunks');
      expect(all.body).toHaveLength(1);
      expectNothingOfA(all.body);
      const byId = await as(B).get('/api/corpus/chunks').query({ sourceId: SRC_A_UPLOAD });
      expect(byId.body).toEqual([]);
      const search = await as(B).get('/api/corpus/chunks').query({ search: 'zebrafish' });
      expect(search.body).toHaveLength(1);
      expectNothingOfA(search.body);
    });

    it('claims, contradictions and tier counts', async () => {
      const claims = await as(B).get('/api/corpus/claims');
      expect((claims.body as Array<{ id: string }>).map((c) => c.id)).toEqual([CLAIM_B1]);
      const contradictions = await as(B).get('/api/corpus/contradictions');
      expect(contradictions.body).toEqual([]);
      const tiers = await as(B).get('/api/corpus/tier-distribution');
      expect(tiers.body).toEqual([{ evidence_tier: 'inference', count: 1 }]);
    });

    it('statistics count the caller’s own rows and hide the database size', async () => {
      const res = await as(B).get('/api/corpus/stats');
      expect(res.body).toMatchObject({
        source_count: 1,
        document_count: 1,
        chunk_count: 1,
        embedding_count: 1,
        claim_count: 1,
        contradiction_count: 0,
        open_contradiction_count: 0,
        finalized_report_count: 1,
        active_run_count: 0,
        db_size: null,
      });
    });

    it('knowledge graph', async () => {
      const res = await as(B).get('/api/graph');
      expect(res.status).toBe(200);
      const ids = (res.body as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id).sort();
      expect(ids).toEqual([SRC_B_UPLOAD, CLAIM_B1].sort());
      expectNothingOfA(res.body);
    });

    it('atlas points and embedded count', async () => {
      const points = await as(B).get('/api/atlas/points');
      expect(points.body).toHaveLength(1);
      expectNothingOfA(points.body);
      const count = await as(B).get('/api/atlas/embedded-count');
      expect(count.body).toEqual({ count: 1 });
    });

    it('atlas export list', async () => {
      const res = await as(B).get('/api/atlas/exports');
      expect(res.body).toEqual([]);
    });

    it('an admin still sees the whole library', async () => {
      const res = await as(ADMIN).get('/api/sources');
      expect(res.body).toHaveLength(4);
      const stats = await as(ADMIN).get('/api/corpus/stats');
      expect(stats.body.source_count).toBe(4);
    });
  });

  describe('another user’s object by id answers 403 or 404', () => {
    it('GET /sources/:id', async () => {
      expect((await as(B).get(`/api/sources/${SRC_A_UPLOAD}`)).status).toBe(404);
      expect((await as(B).get(`/api/sources/${SRC_A_ATTACHED}`)).status).toBe(404);
      expect((await as(A).get(`/api/sources/${SRC_A_UPLOAD}`)).status).toBe(200);
    });

    it('DELETE /sources/:id', async () => {
      expect((await as(B).delete(`/api/sources/${SRC_A_UPLOAD}`)).status).toBe(403);
      const still = await adminQuery(`SELECT 1 FROM sources WHERE id=$1`, [SRC_A_UPLOAD]);
      expect(still).toHaveLength(1);
    });

    it('deleting a source another user also added removes only the caller’s link', async () => {
      const shared = id(80);
      const jobOfA = id(81);
      const jobOfB = id(82);
      await adminQuery(
        `INSERT INTO sources (id, title, source_type, raw_content, content_hash, imported_via)
         VALUES ($1, 'both added', 'web_url', 'both', 'hash-both', 'manual_upload')`,
        [shared],
      );
      await adminQuery(
        `INSERT INTO ingestion_jobs (id, source_type, status, source_id, user_id) VALUES
           ($1, 'web_url', 'completed', $3, $4), ($2, 'web_url', 'completed', $3, $5)`,
        [jobOfA, jobOfB, shared, A, B],
      );
      expect((await as(B).delete(`/api/sources/${shared}`)).status).toBe(200);
      expect(await adminQuery(`SELECT 1 FROM sources WHERE id=$1`, [shared])).toHaveLength(1);
      expect((await as(B).get(`/api/sources/${shared}`)).status).toBe(404);
      expect((await as(A).get(`/api/sources/${shared}`)).status).toBe(200);
      expect((await as(A).delete(`/api/sources/${shared}`)).status).toBe(200);
      expect(await adminQuery(`SELECT 1 FROM sources WHERE id=$1`, [shared])).toHaveLength(0);
      await adminQuery(`DELETE FROM ingestion_jobs WHERE id = ANY($1::uuid[])`, [[jobOfA, jobOfB]]);
    });

    it('GET /graph?runId=<another user’s run>', async () => {
      expect((await as(B).get('/api/graph').query({ runId: RUN_A })).status).toBe(404);
      expect((await as(A).get('/api/graph').query({ runId: RUN_A })).status).toBe(200);
    });

    it('POST /reports/:id/revisions writes nothing for another user’s report', async () => {
      const res = await as(B).post(`/api/reports/${REPORT_A}/revisions`).send({ requestText: 'x' });
      expect(res.status).toBe(404);
      const bare = await as(B).post(`/reports/${REPORT_A}/revisions`).send({ requestText: 'x' });
      expect(bare.status).toBe(404);
      const rows = await adminQuery(`SELECT 1 FROM report_revision_requests WHERE report_id=$1`, [
        REPORT_A,
      ]);
      expect(rows).toEqual([]);
    });

    it('POST /research/:id/retry-from-failure', async () => {
      expect((await as(B).post(`/api/research/${RUN_A}/retry-from-failure`)).status).toBe(404);
      expect((await as(B).post(`/research/${RUN_A}/retry-from-failure`)).status).toBe(404);
      const run = await adminQuery<{ status: string }>(
        `SELECT status::text AS status FROM research_runs WHERE id=$1`,
        [RUN_A],
      );
      expect(run[0]?.status).toBe('failed');
    });

    it('POST /reports/:reportId/monitors', async () => {
      const res = await as(B).post(`/api/reports/${REPORT_A}/monitors`).send({});
      expect(res.status).toBe(404);
    });

    it('run, report and export reads', async () => {
      expect((await as(B).get(`/api/research/${RUN_A}`)).status).toBe(404);
      expect((await as(B).get(`/api/research/${RUN_A}/artifacts`)).status).toBe(404);
      expect((await as(B).get(`/api/reports/${REPORT_A}`)).status).toBe(404);
      expect((await as(B).get(`/api/reports/${REPORT_A}/reader`)).status).toBe(404);
      expect((await as(B).get(`/api/reports/${REPORT_A}/revisions`)).status).toBe(404);
      expect((await as(B).get(`/api/runs/${RUN_A}/plan`)).status).toBe(404);
      expect((await as(B).get(`/api/dossiers/${RUN_A}`)).status).toBe(404);
      expect((await as(B).get(`/api/atlas/exports/${EXPORT_A}/download`)).status).toBe(404);
    });

    it('run and report lists hold only the caller’s own', async () => {
      const runs = await as(B).get('/api/research');
      expectNothingOfA(runs.body);
      const reports = await as(B).get('/api/reports');
      expectNothingOfA(reports.body);
    });

    it('sending library text to an outside service is admin-only', async () => {
      expect((await as(A).post(`/api/atlas/exports/${EXPORT_A}/nomic-upload`)).status).toBe(403);
    });

    it('export files are not served without the signed-in download routes', async () => {
      expect((await request(app).get(`/exports/atlas_${EXPORT_A}.jsonl.gz`)).status).toBe(404);
    });

    it('signed-out callers get 401', async () => {
      for (const url of ['/api/sources', '/api/corpus/stats', '/api/graph', '/api/atlas/points']) {
        expect((await request(app).get(url)).status).toBe(401);
      }
    });
  });

  describe('admin-only views', () => {
    it.each([
      '/api/admin/users',
      '/api/admin/runs/lookup',
      '/api/admin/cost/summary',
      '/api/admin/corpus/list',
      '/api/admin/telemetry/runs',
      '/api/admin/runtime/logs',
    ])('%s refuses a signed-in non-admin', async (url) => {
      expect((await as(B).get(url)).status).toBe(403);
      expect((await request(app).get(url)).status).toBe(401);
    });
  });

  describe('what a research run may read', () => {
    const visibleTo = async (userId: string | null, runId: string | null): Promise<string[]> => {
      const params: unknown[] = [];
      const indexes: { userParam?: number; runParam?: number } = {};
      if (userId) indexes.userParam = params.push(userId);
      if (runId) indexes.runParam = params.push(runId);
      const rows = await adminQuery<{ id: string }>(
        `SELECT s.id FROM sources s WHERE ${retrievableSourceSql('s', indexes)} ORDER BY s.id`,
        params,
      );
      return rows.map((r) => r.id);
    };

    it('user B’s run reads B’s own documents and public sources only', async () => {
      expect(await visibleTo(B, RUN_B)).toEqual([SRC_B_UPLOAD, SRC_PUBLIC]);
    });

    it('user A’s run reads A’s uploads, attachments and public sources', async () => {
      expect(await visibleTo(A, RUN_A)).toEqual([SRC_A_UPLOAD, SRC_PUBLIC, SRC_A_ATTACHED]);
    });

    it('with no owner known, only public sources', async () => {
      expect(await visibleTo(null, null)).toEqual([SRC_PUBLIC]);
    });

    it('retrieval for user B never returns A’s private passages', async () => {
      const { retrieveChunksWithAudit } = await import('../services/retrieval/retrievalService');
      const result = await retrieveChunksWithAudit({
        query: 'zebrafish',
        userId: B,
        runId: RUN_B,
        topK: 20,
        intentId: 'factual_report',
      });
      const all = [...result.citableChunks, ...result.backgroundChunks];
      expectNothingOfA(all.map((c) => ({ content: c.content, title: c.source_title })));
      // The gate figures are built from the same scoped read.
      expect(JSON.stringify(result.corpusGate)).not.toContain(SRC_A_UPLOAD);
    });

    it('an atlas export for B holds no private text of A and none of A’s search activity', async () => {
      const exportId = id(60);
      await adminQuery(
        `INSERT INTO atlas_exports (id, label, user_id) VALUES ($1, 'B export', $2)`,
        [exportId, B],
      );
      const out = await runAtlasExport({ exportId, label: 'B export', requestedByUserId: B });
      const lines = zlib.gunzipSync(fs.readFileSync(out.path)).toString('utf8');
      fs.unlinkSync(out.path);
      if (hasVectorType) {
        expect(out.count).toBe(2);
        expect(lines).toContain('PRIVATE-TO-B');
        expect(lines).toContain('public paper');
      }
      for (const marker of ['PRIVATE-TO-A', 'ATTACHED-BY-A', 'A SECRET QUESTION', RUN_A]) {
        expect(lines).not.toContain(marker);
      }
    });
  });

  describe('identical content is stored per owner', () => {
    it('B ingesting the same bytes as A’s private document does not get A’s row', async () => {
      const plain = await findStoredSourceForContent({
        rawContent: 'shared bytes',
        importedVia: 'manual_upload',
        ownerUserId: A,
      });
      await adminQuery(
        `INSERT INTO sources (id, title, source_type, raw_content, content_hash, imported_via, metadata)
         VALUES ($1, 'A copy', 'web_url', 'shared bytes', $2, 'manual_upload', $3)`,
        [id(70), plain.contentHash, JSON.stringify({ ingested_by_user_id: A })],
      );
      const forB = await findStoredSourceForContent({
        rawContent: 'shared bytes',
        importedVia: 'manual_upload',
        ownerUserId: B,
      });
      expect(forB.existing).toBeNull();
      expect(forB.contentHash).not.toBe(plain.contentHash);
      const forA = await findStoredSourceForContent({
        rawContent: 'shared bytes',
        importedVia: 'manual_upload',
        ownerUserId: A,
      });
      expect(forA.existing?.id).toBe(id(70));
      const forDiscovery = await findStoredSourceForContent({
        rawContent: 'shared bytes',
        importedVia: 'autonomous_discovery',
        runId: RUN_B,
      });
      expect(forDiscovery.existing).toBeNull();
      await adminQuery(`DELETE FROM sources WHERE id=$1`, [id(70)]);
    });

    it('a public source is reused by anyone', async () => {
      const row = await adminQuery<{ content_hash: string }>(
        `SELECT content_hash FROM sources WHERE id=$1`,
        [SRC_PUBLIC],
      );
      const crypto = await import('crypto');
      const text = 'public bytes';
      const hash = crypto.createHash('sha256').update(text).digest('hex');
      await adminQuery(`UPDATE sources SET content_hash=$2 WHERE id=$1`, [SRC_PUBLIC, hash]);
      const forB = await findStoredSourceForContent({
        rawContent: text,
        importedVia: 'manual_upload',
        ownerUserId: B,
      });
      expect(forB.existing?.id).toBe(SRC_PUBLIC);
      await adminQuery(`UPDATE sources SET content_hash=$2 WHERE id=$1`, [
        SRC_PUBLIC,
        row[0]?.content_hash,
      ]);
    });
  });

  describe('socket room checks and owner lookups', () => {
    it('only the owner passes the room check', async () => {
      const a = { userId: A, orgId: null };
      const b = { userId: B, orgId: null };
      expect(await defaultSocketAccessDeps.canAccessJob(RUN_A, a)).toBe(true);
      expect(await defaultSocketAccessDeps.canAccessJob(RUN_A, b)).toBe(false);
      expect(await defaultSocketAccessDeps.canAccessJob(REPORT_A, b)).toBe(false);
      expect(await defaultSocketAccessDeps.canAccessJob(JOB_A, b)).toBe(false);
      expect(await defaultSocketAccessDeps.canAccessJob(JOB_A, a)).toBe(true);
      expect(await defaultSocketAccessDeps.canAccessReport(REPORT_A, a)).toBe(true);
      expect(await defaultSocketAccessDeps.canAccessReport(REPORT_A, b)).toBe(false);
    });

    it('events are addressed to the real owner', async () => {
      expect(await defaultOwnerLookups.runOwner(RUN_A)).toBe(A);
      expect(await defaultOwnerLookups.reportOwner(REPORT_A)).toBe(A);
      expect(await defaultOwnerLookups.ingestionJobOwner(JOB_A)).toBe(A);
      expect(await defaultOwnerLookups.atlasExportOwner(EXPORT_A)).toBe(A);
      expect(await defaultOwnerLookups.sourceOwners(SRC_A_UPLOAD)).toEqual([A]);
    });
  });

  it('the own-source rule itself', async () => {
    const rows = await adminQuery<{ id: string }>(
      `SELECT s.id FROM sources s WHERE ${ownSourceSql('s', 1)} ORDER BY s.id`,
      [A],
    );
    expect(rows.map((r) => r.id)).toEqual([SRC_A_UPLOAD, SRC_PUBLIC, SRC_A_ATTACHED]);
  });
});
