/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ResearchBriefPreview from '../../components/research/ResearchBriefPreview';

afterEach(() => {
  cleanup();
});

describe('ResearchBriefPreview', () => {
  it('renders intent, deliverables, and emits assumption refinement text', () => {
    const onAssumptionEditsReady = vi.fn();
    render(
      <MemoryRouter>
        <ResearchBriefPreview
          planPayload={{
            intent: { id: 'comparative', confidence: 0.78 },
            topicAnalysis: { summary: 'Comparing EU and US pathways' },
            sourceStrategy: { summary: 'Prioritize regulatory filings' },
            researchBrief: {
              primaryIntent: 'comparative',
              requestedArtifacts: [{ description: 'Top 5 differences', exactCount: 5 }],
              userConstraints: [{ description: 'Only post-2022 sources' }],
            },
          }}
          onAssumptionEditsReady={onAssumptionEditsReady}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Comparative')).toBeTruthy();
    expect(screen.getByText('Top 5 differences')).toBeTruthy();
    expect(screen.getByDisplayValue('Only post-2022 sources')).toBeTruthy();

    const assumptionInputs = screen.getAllByPlaceholderText('Assumption');
    fireEvent.change(assumptionInputs[0]!, { target: { value: 'Narrow to EU first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use edits in refinement' }));
    expect(onAssumptionEditsReady).toHaveBeenCalled();
  });
});
