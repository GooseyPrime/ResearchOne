/**
 * dossierReadService activity/spinoff/history reads (Gate 4).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../db/pool', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
}));

import {
  getDossierReportHistory,
  getDossierSpinoffs,
  listDossiers,
} from '../services/research/dossierReadService';

const DOSSIER_ID = '00000000-0000-4000-8000-000000000010';
const RUN_ID = '00000000-0000-4000-8000-000000000011';
const REPORT_ID = '00000000-0000-4000-8000-000000000012';
const ROOT_ID = '00000000-0000-4000-8000-000000000013';
const ctx = { userId: 'user_test', orgId: null };

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
});

describe('listDossiers sortBy', () => {
  it('passes last_activity_at sort to extended list query', async () => {
    queryMock
      .mockResolvedValueOnce([{ c: '1' }])
      .mockResolvedValueOnce([
        {
          dossier_id: DOSSIER_ID,
          run_id: RUN_ID,
          run_status: 'completed',
          request_query: 'test query',
          plan_intent: 'legacy',
          dossier_created_at: new Date('2024-01-01'),
          report_id: REPORT_ID,
          report_title: 'Title',
          sources_cited_count: 2,
          total_duration_ms: 1000,
          last_activity_at: new Date('2024-06-01'),
          report_version_number: 2,
          is_spinoff: false,
          is_revised: true,
          spinoff_from_report_id: null,
          engine_version: 'v2',
        },
      ]);

    const result = await listDossiers(
      { page: 1, pageSize: 20, sortBy: 'last_activity_at' },
      ctx,
    );

    expect(result.total).toBe(1);
    expect(result.rows[0]?.lastActivityAt).toContain('2024');
    expect(result.rows[0]?.isRevised).toBe(true);
    expect(result.rows[0]?.versionNumber).toBe(2);
    const listSql = String(queryMock.mock.calls[1]?.[0] ?? '');
    expect(listSql).toContain('user_id = $');
    expect(listSql).toContain('last_activity_at');
    expect(listSql).toContain('ORDER BY COALESCE(last_activity_at, dossier_created_at) DESC');
  });

  it('drops only the columns migration 057 added when the database predates it', async () => {
    // This test used to assert the opposite — that a pre-057 database got the
    // LEGACY projection — and that assertion was the defect written down.
    // Losing `run_display_title` cost the list its gate status, last activity,
    // version number, spinoff and revision flags and engine version, none of
    // which have anything to do with 057. (#228 P2 / 227-d.)
    const skewErr = Object.assign(new Error('column "run_display_title" does not exist'), {
      code: '42703',
    });
    queryMock
      .mockRejectedValueOnce(skewErr)
      .mockResolvedValueOnce([{ c: '0' }])
      .mockResolvedValueOnce([]);

    const result = await listDossiers({ page: 1, pageSize: 20, sortBy: 'last_activity_at' }, ctx);

    expect(result.rows).toEqual([]);
    const secondRungSql = String(queryMock.mock.calls[2]?.[0] ?? '');
    expect(secondRungSql).not.toContain('run_display_title');
    expect(secondRungSql).not.toContain('run_ref');
    // Everything that existed before 057 is still selected.
    expect(secondRungSql).toContain('last_activity_at');
    expect(secondRungSql).toContain('report_version_number');
    expect(secondRungSql).toContain('is_spinoff');
    expect(secondRungSql).toContain('engine_version');
    expect(secondRungSql).toContain('run_gate_status');
    expect(secondRungSql).toContain('ORDER BY COALESCE(last_activity_at, dossier_created_at) DESC');
  });

  it('only reaches the legacy projection when the extended one is gone too', async () => {
    const skewErr = Object.assign(new Error('column does not exist'), { code: '42703' });
    queryMock
      .mockRejectedValueOnce(skewErr) // rung 0 count
      .mockRejectedValueOnce(skewErr) // rung 1 count
      .mockResolvedValueOnce([{ c: '0' }])
      .mockResolvedValueOnce([]);

    const result = await listDossiers({ page: 1, pageSize: 20, sortBy: 'last_activity_at' }, ctx);

    expect(result.rows).toEqual([]);
    const legacySql = String(queryMock.mock.calls[3]?.[0] ?? '');
    expect(legacySql).not.toContain('last_activity_at');
    expect(legacySql).toContain('ORDER BY dossier_created_at DESC');
  });

  it('stops at a missing view instead of walking every rung', async () => {
    const missingView = Object.assign(new Error('relation "v_dossier" does not exist'), {
      code: '42P01',
    });
    queryMock.mockRejectedValueOnce(missingView);

    const result = await listDossiers({ page: 1, pageSize: 20 }, ctx);

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('searches the title a reader can actually see, not only the raw query', async () => {
    // The list heading is the display title. Searching only `request_query`
    // and `report_title` meant typing the words on screen returned nothing.
    queryMock.mockResolvedValueOnce([{ c: '0' }]).mockResolvedValueOnce([]);

    await listDossiers({ page: 1, pageSize: 20, search: '  anomaly  ' }, ctx);

    const countSql = String(queryMock.mock.calls[0]?.[0] ?? '');
    expect(countSql).toContain('request_query ILIKE');
    expect(countSql).toContain('report_title ILIKE');
    expect(countSql).toContain('run_display_title ILIKE');
    expect(queryMock.mock.calls[0]?.[1]).toContain('%anomaly%');
  });

  it('drops the display-title search term on a pre-057 database rather than erroring', async () => {
    // A WHERE clause naming a missing column fails exactly like a SELECT
    // naming it, so the predicate has to come off the same rung the column
    // does. Otherwise the fallback raises the error it was written to avoid.
    const skewErr = Object.assign(new Error('column "run_display_title" does not exist'), {
      code: '42703',
    });
    queryMock
      .mockRejectedValueOnce(skewErr)
      .mockResolvedValueOnce([{ c: '0' }])
      .mockResolvedValueOnce([]);

    await listDossiers({ page: 1, pageSize: 20, search: 'anomaly' }, ctx);

    const secondRungCountSql = String(queryMock.mock.calls[1]?.[0] ?? '');
    expect(secondRungCountSql).not.toContain('run_display_title');
    expect(secondRungCountSql).toContain('request_query ILIKE');
  });
});

describe('getDossierReportHistory', () => {
  it('returns lineage entries for root report', async () => {
    queryOneMock.mockResolvedValueOnce({ report_id: REPORT_ID, root_report_id: ROOT_ID });
    queryMock.mockResolvedValueOnce([
      {
        report_id: ROOT_ID,
        version_number: 1,
        title: 'Root',
        status: 'finalized',
        parent_report_id: null,
        revision_number: null,
        created_at: new Date('2024-01-01'),
        finalized_at: new Date('2024-01-02'),
      },
      {
        report_id: REPORT_ID,
        version_number: 2,
        title: 'Rev 2',
        status: 'finalized',
        parent_report_id: ROOT_ID,
        revision_number: 1,
        created_at: new Date('2024-02-01'),
        finalized_at: null,
      },
    ]);

    const result = await getDossierReportHistory(DOSSIER_ID, ctx);

    expect(result?.entries).toHaveLength(2);
    expect(result?.entries[1]?.versionNumber).toBe(2);
    expect(result?.entries[1]?.revisionNumber).toBe(1);
    const historySql = String(queryMock.mock.calls[0]?.[0] ?? '');
    expect(historySql).toContain('EXISTS');
    expect(historySql).toContain('v_dossier');
  });

  it('returns null when dossier anchor missing', async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const result = await getDossierReportHistory(DOSSIER_ID, ctx);
    expect(result).toBeNull();
  });
});

describe('getDossierSpinoffs', () => {
  it('queries spinoffs by run and report lineage', async () => {
    queryOneMock.mockResolvedValueOnce({ run_id: RUN_ID, report_id: REPORT_ID });
    queryMock.mockResolvedValueOnce([
      {
        dossier_id: '00000000-0000-4000-8000-000000000099',
        run_id: '00000000-0000-4000-8000-000000000098',
        request_query: 'spinoff query',
        run_status: 'queued',
        engine_version: 'v2',
        report_id: null,
        spinoff_from_report_id: REPORT_ID,
        dossier_created_at: new Date('2024-03-01'),
      },
    ]);

    const result = await getDossierSpinoffs(DOSSIER_ID, ctx);

    expect(result?.spinoffs).toHaveLength(1);
    expect(result?.spinoffs[0]?.query).toBe('spinoff query');
    const spinoffSql = String(queryMock.mock.calls[0]?.[0] ?? '');
    expect(spinoffSql).toContain('spinoff_from_run_id');
    expect(spinoffSql).toContain('spinoff_from_report_id');
  });

  it('returns empty spinoffs when spinoff columns missing (deploy skew)', async () => {
    queryOneMock.mockResolvedValueOnce({ run_id: RUN_ID, report_id: REPORT_ID });
    queryMock.mockRejectedValueOnce(Object.assign(new Error('column missing'), { code: '42703' }));

    const result = await getDossierSpinoffs(DOSSIER_ID, ctx);

    expect(result?.spinoffs).toEqual([]);
  });
});
