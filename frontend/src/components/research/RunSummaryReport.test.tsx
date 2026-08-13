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
  it('reads the intent from the persisted plan payload', () => {
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
