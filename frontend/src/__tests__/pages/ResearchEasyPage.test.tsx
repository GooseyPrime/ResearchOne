/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import ResearchEasyPage from '../../pages/ResearchEasyPage';

const { navigateMock, invalidateQueriesMock, startResearchMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  startResearchMock: vi.fn(),
}));

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

vi.mock('../../components/research/RunAddonToggles', () => ({
  default: ({ selected, onToggle }: { selected: string[]; onToggle: (k: string) => void }) => (
    <div data-testid="run-addon-toggles">
      <button type="button" data-testid="addon-toggle-adversarial" onClick={() => onToggle('adversarial_twin')}>
        Toggle adversarial
      </button>
      <span data-testid="addon-selected-count">{selected.length}</span>
    </div>
  ),
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

vi.mock('../../utils/clarifyingQuestions', () => ({
  buildClarifyingQuestions: () => [],
}));

function renderPage(initialEntries: string[] = ['/app/research']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.invalidateQueries = invalidateQueriesMock as typeof client.invalidateQueries;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
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

  afterEach(() => cleanup());

  // ── Defaults ──────────────────────────────────────────────────────────────

  it('renders the EZ Research heading', () => {
    renderPage();
    expect(screen.getByText('EZ Research')).toBeInTheDocument();
  });

  it('output preferences panel is collapsed by default', () => {
    renderPage();
    // The toggle button is visible
    expect(screen.getByTestId('ez-output-prefs-toggle')).toBeInTheDocument();
    // But the Report Format control inside is hidden
    expect(screen.queryByText('Report Format')).not.toBeInTheDocument();
  });

  it('output preferences toggle opens the panel', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ez-output-prefs-toggle'));
    expect(screen.getByText('Report Format')).toBeInTheDocument();
    expect(screen.getByText('Report Length')).toBeInTheDocument();
    expect(screen.queryByText('Research Objective')).not.toBeInTheDocument();
  });

  it('output preferences toggle collapses the panel again', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ez-output-prefs-toggle'));
    expect(screen.getByText('Report Format')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ez-output-prefs-toggle'));
    expect(screen.queryByText('Report Format')).not.toBeInTheDocument();
  });

  // ── Submit with defaults (no format/length selection) ────────────────────

  it('submits with no requestedFormats and no targetWordCount when preferences not changed', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Describe what you need to know/), {
      target: { value: 'Find me 20 affiliate niches ranked by income potential' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));

    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    const call = startResearchMock.mock.calls[0][0] as Record<string, unknown>;
    // Defaults: no explicit format/length sent
    expect(call.requestedFormats).toBeUndefined();
    expect(call.targetWordCount).toBeUndefined();
  });

  // ── User chooses a format ─────────────────────────────────────────────────

  it('sends requestedFormats when user selects a specific format', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Describe what you need to know/), {
      target: { value: 'Find me 20 affiliate niches ranked by income potential' },
    });

    // Open output preferences
    fireEvent.click(screen.getByTestId('ez-output-prefs-toggle'));

    // Select Ranked options format
    fireEvent.click(screen.getByRole('button', { name: 'Ranked options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));

    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    const call = startResearchMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.requestedFormats).toEqual(['ranked_options']);
  });

  // ── User chooses a length ─────────────────────────────────────────────────

  it('sends targetWordCount when user selects Long length', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Describe what you need to know/), {
      target: { value: 'Find me 20 affiliate niches ranked by income potential' },
    });

    fireEvent.click(screen.getByTestId('ez-output-prefs-toggle'));
    // Change to Long
    fireEvent.change(screen.getByDisplayValue('Standard (~2,200 words)'), {
      target: { value: 'long' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));

    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    const call = startResearchMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.targetWordCount).toBe(4000);
  });

  // ── User enters a custom word count ──────────────────────────────────────

  it('sends custom targetWordCount when user selects Custom', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Describe what you need to know/), {
      target: { value: 'Find me 20 affiliate niches ranked by income potential' },
    });

    fireEvent.click(screen.getByTestId('ez-output-prefs-toggle'));
    fireEvent.change(screen.getByDisplayValue('Standard (~2,200 words)'), {
      target: { value: 'custom' },
    });
    const customInput = screen.getByRole('spinbutton');
    fireEvent.change(customInput, { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));

    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    const call = startResearchMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.targetWordCount).toBe(5000);
  });

  // ── Attachment dropzone is present ───────────────────────────────────────

  it('renders attachment dropzone', () => {
    renderPage();
    expect(screen.getByTestId('attachment-dropzone')).toBeInTheDocument();
  });

  // ── Run enhancements (add-ons) ───────────────────────────────────────────

  it('renders run addon toggles', () => {
    renderPage();
    expect(screen.getByTestId('run-addon-toggles')).toBeInTheDocument();
  });

  it('passes selected addons to startResearch on submit', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Describe what you need to know/), {
      target: { value: 'Research something with adversarial review' },
    });

    // Toggle on the adversarial addon
    fireEvent.click(screen.getByTestId('addon-toggle-adversarial'));
    expect(screen.getByTestId('addon-selected-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));

    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    const call = startResearchMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.addons).toEqual(['adversarial_twin']);
  });

  it('omits addons from startResearch when none selected', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Describe what you need to know/), {
      target: { value: 'Research without any addons' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));

    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    const call = startResearchMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.addons).toBeUndefined();
  });
});
