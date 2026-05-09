import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/pool', () => ({
  query: vi.fn(),
  queryOne: vi.fn().mockResolvedValue(null),
}));

import {
  computeReportExpiry,
  computeWorkspaceExpiry,
  isSovereignRetentionExempt,
} from '../services/retention/retentionPolicy';
import { buildRetentionConfig, type RetentionConfig } from '../config/retention';

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

describe('computeReportExpiry', () => {
  it('finalized report gets workspace_expires_at +30d and report_expires_at +120d', () => {
    const finalizedAt = new Date('2026-03-01T00:00:00Z');
    const cfg = makeCfg({ finalizedWorkspaceDays: 30, reportRetentionDays: 120 });
    const result = computeReportExpiry(finalizedAt, cfg);

    const expectedWorkspace = new Date('2026-03-31T00:00:00Z');
    const expectedReport = new Date('2026-06-29T00:00:00Z');

    expect(result.workspaceExpiresAt.getTime()).toBe(expectedWorkspace.getTime());
    expect(result.reportExpiresAt.getTime()).toBe(expectedReport.getTime());
  });

  it('respects custom config values', () => {
    const finalizedAt = new Date('2026-01-01T12:00:00Z');
    const cfg = makeCfg({ finalizedWorkspaceDays: 7, reportRetentionDays: 60 });
    const result = computeReportExpiry(finalizedAt, cfg);

    expect(result.workspaceExpiresAt.getTime()).toBe(
      finalizedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    expect(result.reportExpiresAt.getTime()).toBe(
      finalizedAt.getTime() + 60 * 24 * 60 * 60 * 1000,
    );
  });
});

describe('computeWorkspaceExpiry', () => {
  it('failed run gets +14d', () => {
    const terminalAt = new Date('2026-04-01T00:00:00Z');
    const cfg = makeCfg({ failedRunDays: 14 });
    const result = computeWorkspaceExpiry(terminalAt, 'failed', cfg);
    expect(result.getTime()).toBe(terminalAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  });

  it('aborted run gets failedRunDays', () => {
    const terminalAt = new Date('2026-04-01T00:00:00Z');
    const cfg = makeCfg({ failedRunDays: 14 });
    const result = computeWorkspaceExpiry(terminalAt, 'aborted', cfg);
    expect(result.getTime()).toBe(terminalAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  });

  it('completed run gets +30d (finalizedWorkspaceDays)', () => {
    const terminalAt = new Date('2026-04-01T00:00:00Z');
    const cfg = makeCfg({ finalizedWorkspaceDays: 30 });
    const result = computeWorkspaceExpiry(terminalAt, 'completed', cfg);
    expect(result.getTime()).toBe(terminalAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  });
});

describe('isSovereignRetentionExempt', () => {
  it('returns true when sovereignCustomRetention is true', () => {
    expect(isSovereignRetentionExempt(makeCfg({ sovereignCustomRetention: true }))).toBe(true);
  });

  it('returns false when sovereignCustomRetention is false', () => {
    expect(isSovereignRetentionExempt(makeCfg({ sovereignCustomRetention: false }))).toBe(false);
  });
});

describe('buildRetentionConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when RETENTION_REPORT_DAYS < RETENTION_FINALIZED_WORKSPACE_DAYS', () => {
    process.env.RETENTION_REPORT_DAYS = '10';
    process.env.RETENTION_FINALIZED_WORKSPACE_DAYS = '30';
    expect(() => buildRetentionConfig()).toThrow('reportRetentionDays (10) must be >= finalizedWorkspaceDays (30)');
  });

  it('throws when livingReportGraceDays < 7 in non-test env', () => {
    process.env.NODE_ENV = 'production';
    process.env.RETENTION_LIVING_REPORT_GRACE_DAYS = '3';
    expect(() => buildRetentionConfig()).toThrow('livingReportGraceDays (3) must be >= 7');
  });

  it('allows livingReportGraceDays < 7 in test env', () => {
    process.env.NODE_ENV = 'test';
    process.env.RETENTION_LIVING_REPORT_GRACE_DAYS = '1';
    const cfg = buildRetentionConfig();
    expect(cfg.livingReportGraceDays).toBe(1);
  });
});
