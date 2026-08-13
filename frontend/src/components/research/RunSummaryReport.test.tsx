/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import RunSummaryReport, { type RunSummaryData } from './RunSummaryReport';
import type { ResearchRun } from '../../utils/api';

afterEach(() => {
  cleanup();
});

function buildRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: 'run-1',
    title: 'Find new SaaS opportunities',
    query: 'Find new SaaS opportunities',
    status: 'completed',
    created_at: '2026-08-13T00:00:00.000Z',
    research_objective: 'NOVEL_APPLICATION_DISCOVERY',
    ...overrides,
  };
}

const SUMMARY: RunSummaryData = {
  runId: 'run-1',
  status: 'completed',
  totalDurationMs: 12_000,
  phaseDurations: {},
  totalPromptTokens: 120,
  totalCompletionTokens: 80,
  retryCount: 0,
};

describe('RunSummaryReport', () => {
  // ── production path (WO-AC R6) ──────────────────────────────────────────
  // The run row returned by GET /api/research/:id now includes primary_intent
  // and secondary_intent sourced from research_plans via a LEFT JOIN.
  // This test must FAIL if those fields are absent (Rule 16).
  it('renders Intent from run.primary_intent and run.secondary_intent (production path)', () => {
    render(
      <RunSummaryReport
        summary={SUMMARY}
        run={buildRun({
          primary_intent: 'opportunity_discovery',
          secondary_intent: 'feasibility',
        })}
        plan={null}
        traceEvents={[]}
        failure={null}
      />
    );

    // Intent line must appear — and Model profile must remain separate
    expect(screen.getByText(/Intent\s+: opportunity_discovery \(secondary: feasibility\)/)).toBeTruthy();
    expect(screen.getByText(/Model profile: NOVEL_APPLICATION_DISCOVERY/)).toBeTruthy();
  });

  it('renders Intent without secondary when secondary_intent is absent', () => {
    render(
      <RunSummaryReport
        summary={SUMMARY}
        run={buildRun({ primary_intent: 'investigation' })}
        plan={null}
        traceEvents={[]}
        failure={null}
      />
    );

    expect(screen.getByText(/Intent\s+: investigation/)).toBeTruthy();
  });

  // ── plan-payload fallback path ───────────────────────────────────────────
  it('reads the intent from the persisted plan payload when run fields are absent', () => {
    render(
      <RunSummaryReport
        summary={SUMMARY}
        run={buildRun()}
        plan={{
          intent: { id: 'comparative' },
          researchBrief: {
            primaryIntent: 'opportunity_discovery',
            secondaryIntent: 'feasibility',
          },
        }}
        traceEvents={[]}
        failure={null}
      />
    );

    expect(screen.getByText(/Intent\s+: opportunity_discovery \(secondary: feasibility\)/)).toBeTruthy();
    expect(screen.getByText(/Model profile: NOVEL_APPLICATION_DISCOVERY/)).toBeTruthy();
  });

  it('falls back to plan.intent when the brief is absent', () => {
    render(
      <RunSummaryReport
        summary={SUMMARY}
        run={buildRun({ research_objective: 'BALANCED_COMPARISON' })}
        plan={{ intent: { id: 'comparative' } }}
        traceEvents={[]}
        failure={null}
      />
    );

    expect(screen.getByText(/Intent\s+: comparative/)).toBeTruthy();
    expect(screen.getByText(/Model profile: BALANCED_COMPARISON/)).toBeTruthy();
  });
});
