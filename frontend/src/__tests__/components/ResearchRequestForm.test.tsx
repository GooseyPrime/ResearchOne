/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import ResearchRequestForm from '../../components/research/ResearchRequestForm';

const {
  navigateMock,
  invalidateQueriesMock,
  startResearchMock,
  getResearchRunMock,
  ensemblePresetsMock,
  savedProfilesMock,
  subscriptionMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  startResearchMock: vi.fn(),
  getResearchRunMock: vi.fn(),
  ensemblePresetsMock: vi.fn(),
  savedProfilesMock: vi.fn(),
  subscriptionMock: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/useStore', () => ({
  useStore: (selector: (state: { addNotification: (...args: unknown[]) => void }) => unknown) =>
    selector({ addNotification: vi.fn() }),
}));

vi.mock('../../hooks/useBillingSubscription', () => ({
  useBillingSubscriptionQuery: () => subscriptionMock(),
  effectiveEntitlementTier: () => 'pro',
  BILLING_SUBSCRIPTION_QUERY_KEY: ['billing', 'subscription'],
}));

vi.mock('../../components/research/AttachmentDropZone', () => ({
  default: () => <div data-testid="attachment-dropzone" />,
}));

vi.mock('../../components/billing/FreeLifetimeQuotaBanner', () => ({
  default: () => null,
}));

vi.mock('../../components/research/ResearchClarificationChat', () => ({
  default: () => <div data-testid="clarification-chat" />,
}));

vi.mock('../../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../utils/api')>('../../utils/api');
  return {
    ...actual,
    startResearch: startResearchMock,
    getResearchRun: getResearchRunMock,
    getResearchV2EnsemblePresets: ensemblePresetsMock,
    listSavedOrchestrationProfiles: savedProfilesMock,
  };
});

vi.mock('../../utils/supplementalIngestNotifications', () => ({
  applySupplementalIngestNotifications: vi.fn(),
}));

vi.mock('../../utils/clarifyingQuestions', () => ({
  buildClarifyingQuestions: () => [],
}));

const QUESTION = /What do you need to know, compare, or produce/;

function renderForm(initialEntries: string[] = ['/app/research']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.invalidateQueries = invalidateQueriesMock as typeof client.invalidateQueries;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <ResearchRequestForm />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function submitWith(text: string) {
  fireEvent.change(screen.getByPlaceholderText(QUESTION), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));
  await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
  return startResearchMock.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  startResearchMock.mockResolvedValue({ runId: 'run-1', status: 'queued' });
  ensemblePresetsMock.mockResolvedValue({
    presets: {
      GENERAL_EPISTEMIC_RESEARCH: {
        planner: { primary: 'vendor/planner', fallback: 'vendor/planner-backup' },
        reasoner: { primary: 'vendor/reasoner', fallback: 'vendor/reasoner-backup' },
      },
    },
  });
  savedProfilesMock.mockResolvedValue({ profiles: [] });
  subscriptionMock.mockReturnValue({ data: { tier: 'pro' }, isLoading: false, isError: false });
});

afterEach(() => cleanup());

describe('ResearchRequestForm — the request itself', () => {
  it('asks for the question and nothing else up front', () => {
    renderForm();
    expect(screen.getByPlaceholderText(QUESTION)).toBeInTheDocument();
    expect(screen.getByTestId('attachment-dropzone')).toBeInTheDocument();
    // The detail lives behind disclosures, closed.
    expect(screen.queryByText('Report Format')).not.toBeInTheDocument();
    expect(screen.queryByText('Challenge perspective (optional)')).not.toBeInTheDocument();
  });

  it('offers no choice of engine, depth or mode', () => {
    // The whole point of WO-AH. If any of these come back as a control, the
    // report a user gets depends on a toggle again.
    renderForm();
    for (const label of ['Standard', 'Deep', 'EZ Research', 'Research Lab', 'Engine']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('never sends an engine version', () => {
    // Belt and braces: the field is gone from the payload type, so this would
    // only regress by someone adding it back deliberately.
    renderForm();
    expect(screen.queryByText(/V2/)).toBeNull();
  });

  it('sends the question and hands off to the run workspace', async () => {
    renderForm();
    const call = await submitWith('Where is lithium recycling capacity being built?');
    expect(call.query).toBe('Where is lithium recycling capacity being built?');
    expect(call.engineVersion).toBeUndefined();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/app/run/run-1#plan'));
  });

  it('will not submit an empty question', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Plan my research' })).toBeDisabled();
  });
});

describe('ResearchRequestForm — output preferences (from EZ)', () => {
  it('sends no format or length when the user changed neither', async () => {
    renderForm();
    const call = await submitWith('Find me 20 affiliate niches ranked by income potential');
    expect(call.requestedFormats).toBeUndefined();
    expect(call.targetWordCount).toBeUndefined();
  });

  it('sends the format the user picked', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('request-output-prefs-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'Ranked options' }));
    const call = await submitWith('Find me 20 affiliate niches ranked by income potential');
    expect(call.requestedFormats).toEqual(['ranked_options']);
  });

  it('sends the length the user picked', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('request-output-prefs-toggle'));
    fireEvent.change(screen.getByDisplayValue('Standard (~2,200 words)'), {
      target: { value: 'long' },
    });
    const call = await submitWith('Compare two suppliers');
    expect(call.targetWordCount).toBe(4000);
  });

  it('sends a custom word count', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('request-output-prefs-toggle'));
    fireEvent.change(screen.getByDisplayValue('Standard (~2,200 words)'), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5000' } });
    const call = await submitWith('Compare two suppliers');
    expect(call.targetWordCount).toBe(5000);
  });
});

describe('ResearchRequestForm — the Lab controls survived the merge', () => {
  it('keeps the research objective, and defaults it to automatic', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('request-output-prefs-toggle'));
    expect(screen.getByText('Research Objective')).toBeInTheDocument();
    const call = await submitWith('Patent whitespace in solid-state electrolytes');
    // Automatic means: do not tell the server an objective, tell it the user
    // did not choose one, and let intent classification decide.
    expect(call.researchObjective).toBeUndefined();
    expect(call.requestedResearchObjective).toBe('AUTO');
  });

  it('sends an objective the user did choose', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('request-output-prefs-toggle'));
    fireEvent.change(screen.getByDisplayValue(/Automatic/), {
      target: { value: 'PATENT_GAP_ANALYSIS' },
    });
    const call = await submitWith('Patent whitespace in solid-state electrolytes');
    expect(call.researchObjective).toBe('PATENT_GAP_ANALYSIS');
  });

  it('keeps the citation style', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('request-output-prefs-toggle'));
    expect(screen.getByText('Citation Style')).toBeInTheDocument();
    const call = await submitWith('Compare two suppliers');
    expect(call.citationStyle).toBe('apa');
  });

  it('keeps the library tag filter', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('request-sources-toggle'));
    fireEvent.change(screen.getByPlaceholderText('biology, oncology, metabolism'), {
      target: { value: 'biology, oncology' },
    });
    const call = await submitWith('Compare two suppliers');
    expect(call.filterTags).toEqual(['biology', 'oncology']);
  });

  it('keeps the challenge perspective and sends it as context', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('request-sources-toggle'));
    fireEvent.click(screen.getByRole('button', { name: /No particular perspective/ }));
    fireEvent.click(screen.getByRole('option', { name: /Hostile Peer Reviewer/ }));
    const call = await submitWith('Compare two suppliers');
    expect(String(call.supplemental)).toContain('Hostile Peer Reviewer');
  });

  it('keeps the per-role model editor and sends only edited roles', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByTestId('request-models-toggle')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('request-models-toggle'));
    const [firstRoleInput] = screen.getAllByPlaceholderText('vendor/planner');
    fireEvent.change(firstRoleInput, { target: { value: 'vendor/my-planner' } });
    const call = await submitWith('Compare two suppliers');
    expect(call.modelOverrides).toEqual({ planner: { primary: 'vendor/my-planner' } });
  });

  it('does not send a backup model unless the user allowed it', async () => {
    // The checkbox is the whole meaning of the field: a backup id typed into a
    // row with the box unticked is a draft, not an instruction.
    renderForm();
    await waitFor(() => expect(screen.getByTestId('request-models-toggle')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('request-models-toggle'));
    fireEvent.change(screen.getAllByPlaceholderText('vendor/planner-backup')[0], {
      target: { value: 'vendor/other' },
    });
    const call = await submitWith('Compare two suppliers');
    expect(call.modelOverrides).toBeUndefined();

    startResearchMock.mockClear();
    fireEvent.click(screen.getAllByLabelText('Use the backup if the first one fails')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));
    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    const second = startResearchMock.mock.calls[0][0] as Record<string, unknown>;
    expect(second.modelOverrides).toEqual({ planner: { fallback: 'vendor/other' } });
  });
});

describe('ResearchRequestForm — a cancelled plan restores the request', () => {
  it('consumes ?prefill= and restores every field the run carries', async () => {
    getResearchRunMock.mockResolvedValue({
      id: 'run-1',
      query: 'Compare EU and US device pathways',
      supplemental: 'Only post-2022 filings\n\nHostile Peer Reviewer',
      supplemental_attachments: [{ kind: 'url', url: 'https://example.test/a' }],
      requested_research_objective: 'AUTO',
      research_objective: 'PATENT_GAP_ANALYSIS',
      citation_style: 'mla',
      requested_formats: ['comparison_table'],
    });

    renderForm(['/app/research?prefill=run-1']);

    await waitFor(() =>
      expect(screen.getByDisplayValue('Compare EU and US device pathways')).toBeInTheDocument()
    );
    expect(getResearchRunMock).toHaveBeenCalledWith('run-1');
    // The perspective is stored inside supplemental and has to come back out
    // of it, not stay glued to the notes.
    expect(screen.getByDisplayValue('Only post-2022 filings')).toBeInTheDocument();
    expect(screen.getByText(/Hostile Peer Reviewer/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Automatic — ResearchOne selects from the request')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Plan my research' }));
    await waitFor(() => expect(startResearchMock).toHaveBeenCalled());
    const call = startResearchMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.researchObjective).toBeUndefined();
    expect(call.requestedResearchObjective).toBe('AUTO');
  });

  it('leaves the form alone when there is no prefill parameter', async () => {
    renderForm(['/app/research']);
    await waitFor(() => expect(screen.getByTestId('attachment-dropzone')).toBeInTheDocument());
    expect(getResearchRunMock).not.toHaveBeenCalled();
  });
});
