import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  query: mocks.query,
  queryOne: vi.fn().mockResolvedValue(null),
  withTransaction: mocks.withTransaction,
}));

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  markReportFinalizedRetention,
  markRunTerminalRetention,
  recordRetentionEvent,
} from '../services/retention/retentionService';
import type { RetentionConfig } from '../config/retention';

function makeCfg(overrides: Partial<RetentionConfig> = {}): RetentionConfig {
  return {
    tempUploadHours: 72,
    failedRunDays: 14,
    finalizedWorkspaceDays: 30,
    reportRetentionDays: 120,
    livingReportGraceDays: 30,
    retentionBatchLimit: 100,
    retentionDryRun: false,
    disableRetentionJobs: false,
    sovereignCustomRetention: false,
    uploadStagingDir: '/tmp/test',
    textQueueInlineMaxBytes: 262144,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
});

describe('markReportFinalizedRetention', () => {
  it('calls query with correct expiry dates', async () => {
    const finalizedAt = new Date('2026-03-01T00:00:00Z');
    const cfg = makeCfg({ finalizedWorkspaceDays: 30, reportRetentionDays: 120 });
    mocks.query.mockResolvedValue([]);

    await markReportFinalizedRetention('report-1', finalizedAt, cfg);

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('UPDATE reports');
    expect(sql).toContain('report_expires_at');
    expect(sql).toContain('workspace_expires_at');
    expect(sql).toContain('retention_status');

    const reportExpiresAt = new Date(params[0] as string);
    const workspaceExpiresAt = new Date(params[1] as string);
    expect(reportExpiresAt.getTime()).toBe(finalizedAt.getTime() + 120 * 24 * 60 * 60 * 1000);
    expect(workspaceExpiresAt.getTime()).toBe(finalizedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(params[3]).toBe('report-1');
  });

  it('handles 42703 gracefully (deploy skew)', async () => {
    const pgError = new Error('column does not exist') as Error & { code: string };
    pgError.code = '42703';
    mocks.query.mockRejectedValueOnce(pgError);

    await expect(
      markReportFinalizedRetention('report-1', new Date(), makeCfg()),
    ).resolves.toBeUndefined();
  });

  it('rethrows non-42703 errors', async () => {
    const otherError = new Error('connection lost') as Error & { code: string };
    otherError.code = '08006';
    mocks.query.mockRejectedValueOnce(otherError);

    await expect(
      markReportFinalizedRetention('report-1', new Date(), makeCfg()),
    ).rejects.toThrow('connection lost');
  });
});

describe('markRunTerminalRetention', () => {
  it('calls query with correct expiry dates for failed run', async () => {
    const terminalAt = new Date('2026-04-01T00:00:00Z');
    const cfg = makeCfg({ failedRunDays: 14 });
    mocks.query.mockResolvedValue([]);

    await markRunTerminalRetention('run-1', 'failed', terminalAt, cfg);

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('UPDATE research_runs');
    expect(sql).toContain('workspace_expires_at');

    const workspaceExpiresAt = new Date(params[0] as string);
    expect(workspaceExpiresAt.getTime()).toBe(terminalAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    expect(params[2]).toBe('run-1');
  });

  it('handles 42703 gracefully (deploy skew)', async () => {
    const pgError = new Error('column does not exist') as Error & { code: string };
    pgError.code = '42703';
    mocks.query.mockRejectedValueOnce(pgError);

    await expect(
      markRunTerminalRetention('run-1', 'failed', new Date(), makeCfg()),
    ).resolves.toBeUndefined();
  });
});

describe('recordRetentionEvent', () => {
  it('writes to retention_events table', async () => {
    mocks.query.mockResolvedValue([]);

    await recordRetentionEvent(
      'report',
      'report-1',
      'workspace_purge',
      'expired',
      { retention_status: 'active' },
      { retention_status: 'workspace_purged' },
      false,
    );

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO retention_events');
    expect(params[0]).toBe('report');
    expect(params[1]).toBe('report-1');
    expect(params[2]).toBe('workspace_purge');
    expect(params[3]).toBe('expired');
    expect(params[6]).toBe(false);
  });
});
