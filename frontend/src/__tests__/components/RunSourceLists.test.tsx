/** @vitest-environment jsdom */
/**
 * The lists of a run's sources as a person sees them: the dossier's Sources
 * tab says it lists what the run used, and the not-used list is rendered only
 * when the API sent one (it sends it to administrators only).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sourcesState = vi.hoisted(() => ({
  value: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
}));
vi.mock('@/hooks/useDossiers', () => ({ useDossierSources: () => sourcesState.value }));

import DossierSourcesPanel from '@/components/dossiers/DossierSourcesPanel';
import NotUsedSources from '@/components/research/NotUsedSources';

afterEach(() => cleanup());

const used = (sourceId: string, title: string, citedInReport: boolean) => ({
  sourceId,
  title,
  url: `https://example.org/${sourceId}`,
  sourceType: 'web_url',
  ingestionStatus: 'completed',
  fetchStatus: 'success',
  citedInReport,
  discoveredByRunId: 'run-1',
  chunkCount: 4,
});

describe('the dossier Sources tab', () => {
  it('lists the sources it is given and says they are the ones the run used', () => {
    sourcesState.value = {
      data: { sources: [used('eac', 'EAC update on election security', true), used('cisa', 'Election Security | CISA', false)] },
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<DossierSourcesPanel dossierId="d-1" />);
    expect(screen.getByText(/The sources this research run used/)).toBeInTheDocument();
    expect(screen.getByText(/found\s+and not used is not listed/)).toBeInTheDocument();
    expect(screen.getByText('EAC update on election security')).toBeInTheDocument();
    expect(screen.getAllByText('yes')).toHaveLength(1);
    expect(screen.getAllByText('no')).toHaveLength(1);
  });
});

describe('the not-used list', () => {
  it('renders nothing when the API sent no list', () => {
    const { container } = render(<NotUsedSources sources={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('not-used-sources')).toBeNull();
  });

  it('shows each source with the reason in plain words', () => {
    render(
      <NotUsedSources
        sources={[
          { title: 'Vulnerability Assessment and Penetration Testing on IP cameras', url: 'https://arxiv.org/pdf/2202.06597', stage: 'search_result', label: 'Not used — not relevant to this question', why: 'about cameras, not elections' },
        ]}
      />
    );
    expect(screen.getByText('Not used — not relevant to this question')).toBeInTheDocument();
    expect(screen.getByText('about cameras, not elections')).toBeInTheDocument();
  });
});
