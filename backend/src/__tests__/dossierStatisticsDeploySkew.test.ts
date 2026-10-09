/**
 * Dossier statistics when the database is behind the code (Rule 13).
 *
 * Migration 061 renamed two statistics columns and migration 036 added two.
 * A process that starts before those migrations have run gets "column does not
 * exist" on the full insert. The retry must then name none of those columns,
 * or it fails the same way and the whole row is lost (Codex, PR #272).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, queryOneMock } = vi.hoisted(() => ({ queryMock: vi.fn(), queryOneMock: vi.fn() }));

vi.mock('../db/pool', () => ({ query: queryMock, queryOne: queryOneMock }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { aggregateAndPersistDossierStatistics } from '../services/telemetry/dossierStatisticsAggregator';

const RUN_ID = '00000000-0000-0000-0000-000000000001';
const COLUMNS_A_LATER_MIGRATION_ADDED_OR_RENAMED = ['double_check_annotations_count', 'strongest_form_pass_count', 'source_class_breakdown'];

describe('dossier statistics on a database that is behind the code', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
    queryOneMock.mockImplementation(async (sql: string) =>
      /FROM research_runs/.test(sql) ? { id: RUN_ID, created_at: new Date(0), completed_at: new Date(60_000), report_id: null } : null
    );
  });

  it('saves the rest of the row when the full insert meets a missing column', async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error('column does not exist'), { code: '42703' })).mockResolvedValueOnce([]);

    await aggregateAndPersistDossierStatistics(RUN_ID, {
      profileDisplayName: 'Fact-check',
      intentId: 'adjudication',
      agentsRan: ['planner', 'double_check'],
      agentsSkipped: [],
      stageDurations: { challenge: 12 },
      doubleCheckAnnotationsCount: 3,
      strongestFormPassCount: 1,
      sourceClassBreakdown: null,
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [fullSql] = queryMock.mock.calls[0] as [string, unknown[]];
    const [retrySql, retryParams] = queryMock.mock.calls[1] as [string, unknown[]];
    for (const column of COLUMNS_A_LATER_MIGRATION_ADDED_OR_RENAMED) {
      expect(fullSql).toContain(column);
      expect(retrySql, `the retry must not name ${column}`).not.toContain(column);
    }
    // What the older table does hold is still written.
    expect(retrySql).toContain('agents_ran');
    expect(retrySql).toContain('stage_durations');
    // One value per placeholder: a spare parameter is rejected by Postgres.
    const placeholders = new Set([...retrySql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    expect(retryParams).toHaveLength(Math.max(...placeholders));
  });
});
