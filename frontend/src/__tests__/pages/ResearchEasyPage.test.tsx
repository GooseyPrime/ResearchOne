/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ResearchEasyPage from '../../pages/ResearchEasyPage';

const navigateMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const startResearchMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../hooks/useCanAccessDeepResearch', () => ({
  useCanAccessDeepResearch: () => ({ canAccessDeep: true, tierGateUnknown: false }),
}));

vi.mock('../../store/useStore', () => ({
  useStore: (selector: (state: { addNotification: (...args: unknown[]) => void }) => unknown) =>
    selector({ addNotification: vi.fn() }),
}));

vi.mock('../../components/research/AttachmentDropZone', () => ({
  default: () => <div data-testid="attachment-dropzone" />,
}));

vi.mock('../../components/research/ResearchClarificationChat', () => ({
  default: () => <div data-testid="clarification-chat" />,
}));

vi.mock('../../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../utils/api')>('../../utils/api');
  return {
    ...actual,
    startResearch: startResearchMock,
  };
});

vi.mock('../../utils/supplementalIngestNotifications', () => ({
  applySupplementalIngestNotifications: vi.fn(),
}));

vi.mock('../../utils/researchRunRoutes', () => ({
  liveResearchUrl: () => '/app/research?runId=run-1#plan',
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.invalidateQueries = invalidateQueriesMock as typeof client.invalidateQueries;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ResearchEasyPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResearchEasyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startResearchMock.mockResolvedValue({ runId: 'run-1', status: 'queued' });
  });

  it('renders EZ controls for objective, format, length, and citation style', () => {
    renderPage();
    expect(screen.getByText('Research Objective')).toBeInTheDocument();
    expect(screen.getByText('Report Format')).toBeInTheDocument();
    expect(screen.getByText('Report Length')).toBeInTheDocument();
    expect(screen.getByText('Citation Style')).toBeInTheDocument();
  });

  it('sends selected formats and custom length to the API payload', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Your research question or task'), {
      target: { value: 'Help me evaluate B2B workflow automation opportunities for small clinics in the US market this year' },
    });
    fireEvent.change(screen.getByDisplayValue('Automatic — ResearchOne selects from the request'), {
      target: { value: 'NOVEL_APPLICATION_DISCOVERY' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ranked options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Narrative briefing' }));
    fireEvent.change(screen.getByDisplayValue('Standard (~2,200 words)'), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));

    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    expect(startResearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        researchObjective: 'NOVEL_APPLICATION_DISCOVERY',
        requestedResearchObjective: 'NOVEL_APPLICATION_DISCOVERY',
        requestedFormats: ['ranked_options', 'narrative_briefing'],
        targetWordCount: 3500,
        citationStyle: 'apa',
      })
    );
  });
});
