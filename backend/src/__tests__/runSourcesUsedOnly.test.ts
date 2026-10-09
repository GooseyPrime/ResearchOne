/**
 * The lists of a run's sources that a person sees show only the sources the
 * run used. What it found and did not use is given to an administrator only,
 * labelled in plain words.
 *
 * Asserted through the two routes a person's browser calls: the dossier's
 * Sources tab and a run's collected sources. Only the database and sign-in are
 * replaced. Each test fails on the code before this rule existed, which listed
 * every source fetched for the run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  userId: 'user_owner',
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  retrievalRecorded: true,
  events: [] as Array<Record<string, unknown>>,
  summary: null as Record<string, unknown> | null,
}));

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
      req.auth = { userId: h.userId, orgId: null, sessionId: null };
      next();
    },
  };
});
vi.mock('../services/auth/adminAllowlist', () => ({
  isAllowlistedAdminUserId: (userId: string | null | undefined) => userId === 'user_admin',
}));
vi.mock('../db/pool', () => ({
  query: h.queryMock,
  queryOne: h.queryOneMock,
  withTransaction: vi.fn(),
  adminQuery: vi.fn(async () => []),
  rlsStore: { run: <T>(_ctx: unknown, fn: () => T): T => fn(), getStore: () => undefined },
}));
vi.mock('../queue/queues', () => ({
  researchQueue: { add: vi.fn(), getJob: vi.fn() },
  ingestionQueue: { add: vi.fn() },
  embeddingQueue: { add: vi.fn() },
  intellmeDeletionQueue: { add: vi.fn() },
}));

import request from 'supertest';
import testApp from '../api/app';
import { NOT_USED_LABEL, NOT_USED_VENDOR_LABEL } from '../services/discovery/relevanceGate';
import { NOT_DRAWN_ON_LABEL } from '../services/research/runSources';

const RUN = '55555555-5555-4555-8555-555555555555';
const REPORT = '66666666-6666-4666-8666-666666666666';
const DOSSIER = '77777777-7777-4777-8777-777777777777';
const EARLIER_RUN = '88888888-8888-4888-8888-888888888888';

const source = (id: string, title: string, url: string, flags: { used?: boolean; cited?: boolean; attached?: boolean; by?: string } = {}) => ({
  source_id: id,
  title,
  url,
  source_type: 'web_url',
  tags: [],
  ingested_at: `2026-10-08T22:4${id.length % 10}:00.000Z`,
  discovered_by_run_id: flags.by ?? RUN,
  fetch_method: 'http_get',
  ingestion_status: 'completed',
  chunk_count: 12,
  used_passage: flags.used === true,
  cited_in_report: flags.cited === true,
  attached_by_user: flags.attached === true,
});

const EAC = source('eac', 'EAC update on election security for 2026', 'https://www.eac.gov/election-security-2026', { used: true, cited: true });
const CISA = source('cisa-x', 'Election Security | CISA', 'https://www.cisa.gov/topics/election-security', { used: true });
// Stored by an earlier run; this run worked from one of its passages.
const EARLIER = source('earlier-yz', 'Pennsylvania 2026 voting-system security standard', 'https://www.pa.gov/voting-standard', { used: true, by: EARLIER_RUN });
// Fetched for this run and never drawn on: the sources that should not be listed.
const IOT = source('iot-abcd', "Internet Service Providers' and Individuals' Attitudes, Barriers, and Incentives to Secure IoT", 'https://arxiv.org/pdf/2210.02137');
const CAMERAS = source('cameras-1', 'Vulnerability Assessment and Penetration Testing on IP cameras', 'https://arxiv.org/pdf/2202.06597');
// What the person attached is theirs to see whether or not a passage was taken from it.
const ATTACHED = source('attached-12', 'My briefing notes.pdf', '', { attached: true });

const USED_TITLES = [EAC, CISA, EARLIER, ATTACHED].map((row) => row.title).sort();

function answerDatabase() {
  h.queryOneMock.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM v_dossier')) return { run_id: RUN, report_id: REPORT };
    if (sql.includes('cardinality(retrieval_ids)')) return { recorded: h.retrievalRecorded };
    return null;
  });
  h.queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM sources s')) return h.rows;
    if (sql.includes('FROM research_runs WHERE id=$1')) {
      return [{ id: RUN, progress_events: [], plan: null, discovery_summary: h.summary, model_log: [], model_overrides: null, model_ensemble: null, report_id: REPORT }];
    }
    if (sql.includes('FROM discovery_events')) return h.events;
    if (sql.includes('claims_total')) return [{ claims_total: '0' }];
    return [];
  });
}

describe('a run\'s sources, as a person sees them', () => {
  beforeEach(() => {
    h.userId = 'user_owner';
    h.queryMock.mockReset();
    h.queryOneMock.mockReset();
    h.rows = [EAC, CISA, EARLIER, IOT, CAMERAS, ATTACHED];
    h.retrievalRecorded = true;
    h.events = [
      {
        phase: 'relevance_gate',
        provider: 'judge',
        query_text: 'q',
        result_count: 3,
        selected_count: 1,
        created_at: '2026-10-08T22:42:00.000Z',
        payload: {
          round: 1,
          judged: 3,
          relevant: 1,
          not_used: [
            { url: 'https://arxiv.org/pdf/2512.10169', title: 'The 2025 Foundation Model Transparency Index', provider: 'arxiv', reason: 'off_topic', decided_by: 'model', why: 'about AI developers, not elections' },
            { url: 'https://www.simplyvoting.com/security/', title: 'Secure Online Voting Software | Simply Voting', provider: 'tavily', reason: 'vendor_sales', decided_by: 'model', why: 'a sales page' },
          ],
        },
      },
      { phase: 'search_round_1', provider: 'tavily', query_text: 'q', result_count: 25, selected_count: 20, created_at: '2026-10-08T22:41:00.000Z', payload: { round: 1, query: 'q', raw_count: 25, new_count: 20 } },
    ];
    h.summary = {
      runId: RUN,
      candidatesFound: 4,
      sourcesIngested: 1,
      sources: [
        { url: EAC.url, title: EAC.title, ingested: true, selectionRationale: 'score=0.80, rank=1' },
        { url: 'https://arxiv.org/pdf/2512.10169', title: 'The 2025 Foundation Model Transparency Index', ingested: false, skipReason: 'not_relevant', selectionRationale: NOT_USED_LABEL },
        { url: 'https://example.org/over-the-cap', title: 'Over the cap', ingested: false, skipReason: 'max_reached', selectionRationale: 'max_sources_to_ingest reached' },
      ],
    };
    answerDatabase();
  });

  it('the dossier Sources tab lists only the sources the run used, and says which the report cites', async () => {
    const res = await request(testApp).get(`/api/dossiers/${DOSSIER}/sources`);
    expect(res.status).toBe(200);
    const listed = res.body.sources as Array<{ title: string; citedInReport: boolean; discoveredByRunId: string }>;
    expect(listed.map((entry) => entry.title).sort()).toEqual(USED_TITLES);
    expect(listed.find((entry) => entry.title === EAC.title)?.citedInReport).toBe(true);
    expect(listed.find((entry) => entry.title === CISA.title)?.citedInReport).toBe(false);
    // A source an earlier run stored is listed when this run worked from it.
    expect(listed.find((entry) => entry.title === EARLIER.title)?.discoveredByRunId).toBe(EARLIER_RUN);
    expect(JSON.stringify(res.body)).not.toContain('IP cameras');
  });

  it('a run\'s collected sources list only the used ones, and the count matches the list', async () => {
    const res = await request(testApp).get(`/api/research/${RUN}/artifacts`);
    expect(res.status).toBe(200);
    expect((res.body.sources as Array<{ title: string }>).map((entry) => entry.title).sort()).toEqual(USED_TITLES);
    expect(res.body.sourcesTotal).toBe(4);
  });

  it('a person is not sent what the run set aside, in the list, the summary or the discovery record', async () => {
    const res = await request(testApp).get(`/api/research/${RUN}/artifacts`);
    const body = JSON.stringify(res.body);
    for (const leftOut of ['Secure IoT', 'IP cameras', 'Transparency Index', 'simplyvoting', 'over-the-cap']) expect(body).not.toContain(leftOut);
    expect(res.body.notUsedSources).toBeUndefined();
    // The summary keeps its counts and the source the run read.
    expect(res.body.discoverySummary.candidatesFound).toBe(4);
    expect(res.body.discoverySummary.sources).toHaveLength(1);
    // The record still says a check ran and what it came to.
    const gate = (res.body.discoveryEvents as Array<{ phase: string; payload: Record<string, unknown> }>).find((event) => event.phase === 'relevance_gate');
    expect(gate?.payload).toMatchObject({ judged: 3, relevant: 1 });
    expect(gate?.payload.not_used).toBeUndefined();
  });

  it('the run itself is sent with only the sources it read in its summary', async () => {
    h.queryMock.mockImplementation(async (sql: string) => (sql.includes('FROM research_runs') ? [{ id: RUN, query: 'q', discovery_summary: h.summary }] : []));
    const res = await request(testApp).get(`/api/research/${RUN}`);
    expect(res.status).toBe(200);
    expect(res.body.discovery_summary.sources).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('Transparency Index');
  });

  it('an administrator is also given what was not used, each with the reason in plain words', async () => {
    h.userId = 'user_admin';
    const res = await request(testApp).get(`/api/research/${RUN}/artifacts`);
    expect(res.status).toBe(200);
    // The list of used sources is the same list.
    expect((res.body.sources as Array<{ title: string }>).map((entry) => entry.title).sort()).toEqual(USED_TITLES);
    const notUsed = res.body.notUsedSources as Array<{ title: string; label: string; stage: string; why: string }>;
    const byTitle = (needle: string) => notUsed.find((entry) => entry.title.includes(needle));
    expect(byTitle('Transparency Index')).toMatchObject({ label: NOT_USED_LABEL, stage: 'search_result', why: 'about AI developers, not elections' });
    expect(byTitle('Simply Voting')).toMatchObject({ label: NOT_USED_VENDOR_LABEL, stage: 'search_result' });
    expect(byTitle('Secure IoT')).toMatchObject({ label: NOT_DRAWN_ON_LABEL, stage: 'fetched' });
    expect(byTitle('IP cameras')).toMatchObject({ label: NOT_DRAWN_ON_LABEL, stage: 'fetched' });
    expect(NOT_USED_LABEL).toBe('Not used — not relevant to this question');
    // Nothing the run used is in the not-used list.
    for (const title of USED_TITLES) expect(notUsed.some((entry) => entry.title === title)).toBe(false);
    // And the full summary and record are there for diagnosis.
    expect(res.body.discoverySummary.sources).toHaveLength(3);
  });

  it('while a run has recorded no passages yet, shows what was fetched for it', async () => {
    // Still searching, or nothing was retrieved: nothing can be called unused yet.
    h.retrievalRecorded = false;
    h.rows = [IOT, EAC].map((row) => ({ ...row, used_passage: false, cited_in_report: false }));
    const res = await request(testApp).get(`/api/dossiers/${DOSSIER}/sources`);
    expect(res.body.sources).toHaveLength(2);
  });
});
