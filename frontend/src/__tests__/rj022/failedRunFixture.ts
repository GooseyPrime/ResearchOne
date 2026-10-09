/**
 * RJ-022. The failed run a customer opened on 9 Oct 2026, in the shape the API
 * sends it (`GET /research/:id`, `GET /dossiers`, `GET /dossiers/:id`,
 * `GET /research/:id/artifacts`), as the frontend types in `utils/api.ts`
 * describe it.
 *
 * It is the run's real shape, not its real content: a request of a few
 * paragraphs, a plan, a search of about fifty results, a wait for sources that
 * reported on a timer, reading, analyses, Double-check, and then a stop at
 * report writing after every provider refused. The stored error, the routes
 * tried and the model log are as long as the pipeline writes them.
 */
import type { Dossier, DossierListRow, ResearchProgressEvent, ResearchRun } from '../../utils/api';

export const RJ022_RUN_ID = '6622a18a-03f0-4317-a839-ddf2b73132cd';
export const RJ022_RUN_REF = 'R1-20261009-1316-KTDDV-9';

export const RJ022_REQUEST = [
  'Find out what is being done to secure the election data held by county and state election offices in the United States ahead of the next general election.',
  '',
  '## What I need',
  '',
  '1. Which federal programmes fund or audit the security of voter registration databases and results reporting systems (name the agency and the programme).',
  '2. What independent audits or penetration tests have been published since 2022, and what they found.',
  '3. Where state practice differs: paper trails, risk-limiting audits, vendor access, and who holds the encryption keys.',
  '4. What election officials themselves say is still unfunded or unresolved.',
  '',
  'Prefer primary sources (agency reports, state auditor reports, court filings, published standards) over news coverage. Flag anything that is a claim by a vendor about its own product.',
].join('\n');

/** The sentence the server writes for a customer when the report could not be written. */
export const RJ022_PLAIN_SENTENCE =
  'The report could not be written because our AI service is temporarily unavailable. You have not been charged. Press Run it again to try again; you are only charged once, when a report is delivered.';

export const RJ022_STORED_ERROR =
  'Model provider request failed at synthesis (role=section_drafter, model=deepseek/deepseek-v3.2, status=402, classification=quota_exceeded): This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.';

const START = Date.UTC(2026, 9, 9, 13, 16, 0);
const at = (seconds: number): string => new Date(START + seconds * 1000).toISOString();

const ROUTES_TRIED = [
  { model: 'deepseek/deepseek-v3.2', provider: 'openrouter', position: 'primary', status: 402, classification: 'quota_exceeded', message: 'This request would exceed your available credits given your current in-flight requests.' },
  { model: 'qwen/qwen3-235b-a22b', provider: 'openrouter', position: 'backup', status: 402, classification: 'quota_exceeded', message: 'This request would exceed your available credits given your current in-flight requests.' },
  { model: 'deepseek-ai/DeepSeek-V3.2', provider: 'together', position: 'cross_provider', status: 429, classification: 'rate_limited', message: 'Rate limit reached for requests' },
  { model: 'deepseek-ai/DeepSeek-V3.2', provider: 'huggingface_inference', position: 'cross_provider', status: 503, classification: 'provider_unavailable', message: 'Service Unavailable' },
];

const FAILURE_META: Record<string, unknown> = {
  routesTried: ROUTES_TRIED,
  classification: 'quota_exceeded',
  status: 402,
  providerMessage: 'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.',
  model: 'deepseek/deepseek-v3.2',
  fallbackTried: true,
  role: 'section_drafter',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  upstream: 'openrouter',
  providerFallbackAttempted: true,
  providerFallbackBackend: 'together',
  providerFallbackResult: 'failed',
  retryable: true,
  terminal: false,
  resumeAvailable: true,
  retryAttempts: 0,
  retryBudget: 2,
  attemptsRemaining: 2,
  customerMessage: RJ022_PLAIN_SENTENCE,
};

/** The trace as the run stored it, oldest first. */
export function rj022ProgressEvents(): ResearchProgressEvent[] {
  const events: ResearchProgressEvent[] = [];
  const push = (seconds: number, stage: string, percent: number, message: string, extra: Partial<ResearchProgressEvent> = {}) => {
    events.push({ runId: RJ022_RUN_ID, stage, percent, message, timestamp: at(seconds), ...extra });
  };

  push(1, 'starting', 1, 'Starting the run and preparing the research plan...');
  push(3, 'plan_generation', 2, 'Working out what you are asking for and drafting the plan...', { substep: 'plan_started' });
  push(19, 'plan_pending_confirmation', 4, 'Plan ready — awaiting your confirmation', { substep: 'plan_ready' });
  push(64, 'starting', 1, 'Starting the run and preparing the research plan...');
  push(66, 'planning', 5, 'Turning the confirmed plan into searches...', { substep: 'request_started' });
  push(78, 'planning', 8, 'Search plan ready', { substep: 'response_parsed', model: 'deepseek/deepseek-v3.2', tokenUsage: { prompt: 4120, completion: 910 } });
  push(80, 'discovery', 12, 'Search round 1: choosing what to look for...', { substep: 'queries_generating' });
  push(97, 'discovery', 13, 'Search round 1 complete (31 candidate sources after removing duplicates)', { substep: 'discovery_round_1_complete' });
  push(118, 'discovery', 14, 'Search round 2 complete (50 candidate sources after removing duplicates)', { substep: 'discovery_round_2_complete' });
  push(131, 'discovery', 14, 'Checked 50 search results against the question: 38 relevant, 12 set aside', {
    substep: 'relevance_check',
    internalDetail: 'kept=38; set_aside=12; decided_without_model=4; duration_ms=11840',
  });
  // The wait for sources reports on a timer: one event every three seconds.
  for (let i = 0; i < 42; i += 1) {
    const ready = Math.min(25, 6 + Math.floor(i / 2));
    push(134 + i * 3, 'discovery', 16, `Reading the sources found: ${ready}/25 ready`, {
      substep: 'discovery_ingest_waiting',
      detail: `pending=${25 - ready}; failed=1; waited=${(i + 1) * 3000}ms`,
      sourceCount: ready,
      chunkCount: ready * 9,
    });
  }
  push(262, 'discovery', 18, 'Enough sources are ready (24/25); continuing while 1 finish', { substep: 'discovery_ingest_ready', sourceCount: 24, chunkCount: 216 });
  push(264, 'retrieval', 20, 'Gathering the relevant passages...', { substep: 'retrieval_started' });
  const searches = [
    'federal funding for voter registration database security',
    'published penetration tests of election management systems since 2022',
    'state risk-limiting audit requirements paper ballots',
    'election vendor remote access and encryption key custody',
    'unfunded election security needs county officials testimony',
    'results reporting system security independent audit',
  ];
  searches.forEach((search, i) => {
    push(268 + i * 6, 'retrieval', 21 + i, `Search ${i + 1}/${searches.length} of your library complete — ${(i + 1) * 14} passages so far`, {
      substep: 'retrieval_query_complete',
      detail: search,
      chunkCount: (i + 1) * 14,
    });
  });
  push(310, 'retriever_analysis', 35, 'Reading 84 passages from 24 sources...', { substep: 'analysis_started', sourceCount: 24, chunkCount: 84 });
  push(352, 'retriever_analysis', 40, 'Passages read and summarised', { substep: 'analysis_done', model: 'qwen/qwen3-235b-a22b', tokenUsage: { prompt: 38200, completion: 3900 } });
  push(354, 'reasoning', 42, 'Running the specialist analyses...', { substep: 'specialist_started' });
  ['Checking the figures', 'Comparing what the sources say', 'Checking who published each source', 'Building the timeline'].forEach((name, i) => {
    push(360 + i * 14, 'reasoning', 45, `${name} (${i + 1}/4)`, { substep: 'specialist_running' });
  });
  push(418, 'reasoning', 47, 'Specialist analysis completed.', { substep: 'specialist_done' });
  push(420, 'reasoning', 50, 'Reasoning across sources...', { substep: 'reasoner_started' });
  push(498, 'reasoning', 62, 'Restating each finding in its strongest form before checking it...', { substep: 'strongest_form_started' });
  push(541, 'challenge', 65, 'Double-check: testing the findings against other sources and the original records...', { substep: 'double_check_started' });
  push(628, 'synthesis', 80, 'Writing the report section by section...', { substep: 'outline_started' });
  push(661, 'synthesis', 81, 'Report section 1/9: What was asked', { substep: 'section_generated', detail: 'What was asked' });
  push(840, 'failed', 81, `Run failed — recoverable. ${RJ022_STORED_ERROR}`, {
    eventType: 'run_failed',
    failure: { errorMessage: RJ022_STORED_ERROR, retryable: true, failureMeta: FAILURE_META },
  });
  return events;
}

const LONG_ANSWER = Array.from(
  { length: 60 },
  (_, i) =>
    `Finding ${i + 1}. The state auditor's 2024 report on the voter registration system records ${i + 3} open recommendations, of which ${i % 4} concern vendor remote access (strong_evidence, Chunks ${i + 1}, ${i + 12}). The county clerks' association says the grant covers hardware but not staff.`
).join('\n\n');

/** One entry per model call, as `research_runs.model_log` holds them. */
function modelLog(): unknown[] {
  const roles = ['planner', 'retriever', 'source_class_classifier', 'reasoner', 'strongest_form', 'double_check', 'outline_architect', 'section_drafter'];
  return Array.from({ length: 46 }, (_, i) => ({
    role: roles[i % roles.length],
    model: i % 3 === 0 ? 'qwen/qwen3-235b-a22b' : 'deepseek/deepseek-v3.2',
    primaryModel: 'deepseek/deepseek-v3.2',
    promptTokens: 6000 + i * 731,
    completionTokens: 900 + i * 53,
    durationMs: 4000 + i * 310,
    usedFallback: i % 3 === 0,
    routeUsed: { model: 'deepseek/deepseek-v3.2', provider: 'openrouter', position: 'primary' },
    ...(i % 3 === 0 ? { routesTried: ROUTES_TRIED.slice(0, 2) } : {}),
    content: LONG_ANSWER,
  }));
}

const PLAN: Record<string, unknown> = {
  intent: 'investigative_synthesis',
  topic_summary: 'Security of election data held by county and state election offices',
  research_questions: [
    'Which federal programmes fund or audit election data security?',
    'What independent audits have been published since 2022?',
    'Where does state practice differ?',
    'What do officials say is unresolved?',
  ],
  discovery_queries: Array.from({ length: 12 }, (_, i) => `election data security audit ${2022 + (i % 4)} state report ${i + 1}`),
  sections: ['What was asked', 'What the sources show', 'Where sources disagree', 'Open questions'],
};

/** The run row as `GET /research/:id` sends it to an administrator: the full stored record. */
export function rj022FailedRun(over: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: RJ022_RUN_ID,
    run_ref: RJ022_RUN_REF,
    display_title: 'Securing election data in county and state election offices',
    title: RJ022_REQUEST.slice(0, 200),
    query: RJ022_REQUEST,
    engine_version: 'v2',
    research_objective: 'INVESTIGATIVE_SYNTHESIS',
    status: 'failed',
    retry_attempts: 0,
    retry_budget: 2,
    error_message: RJ022_STORED_ERROR,
    failed_stage: 'synthesis',
    failure_meta: FAILURE_META,
    progress_stage: 'failed',
    progress_percent: 81,
    progress_message: `Run failed — recoverable. ${RJ022_STORED_ERROR}`,
    progress_updated_at: at(840),
    started_at: at(1),
    completed_at: at(840),
    created_at: at(0),
    plan: PLAN,
    model_log: modelLog(),
    progress_events: rj022ProgressEvents(),
    ...over,
  };
}

/** The same row as a customer is sent it: one plain sentence, no stored error, no model log. */
export function rj022FailedRunForCustomer(over: Partial<ResearchRun> = {}): ResearchRun {
  const { model_log: _modelLog, ...row } = rj022FailedRun();
  void _modelLog;
  return {
    ...row,
    error_message: RJ022_PLAIN_SENTENCE,
    failure_meta: { classification: 'quota_exceeded', retryable: true, customerMessage: RJ022_PLAIN_SENTENCE },
    progress_message: RJ022_PLAIN_SENTENCE,
    progress_events: rj022ProgressEvents().map((event) => {
      const { model: _m, tokenUsage: _t, internalDetail: _i, failure, ...rest } = event;
      void _m;
      void _t;
      void _i;
      return failure ? { ...rest, message: RJ022_PLAIN_SENTENCE, failure: { retryable: true } } : rest;
    }),
    ...over,
  };
}

/** The run's row in `GET /research` (the list the page frame polls). */
export function rj022RunListRow(): ResearchRun {
  const { plan: _plan, model_log: _log, progress_events: _events, ...row } = rj022FailedRun();
  void _plan;
  void _log;
  void _events;
  return { ...row, query: RJ022_REQUEST.slice(0, 512) };
}

/** The run's card in `GET /dossiers`. */
export function rj022DossierListRow(): DossierListRow {
  return {
    dossierId: RJ022_RUN_ID,
    runId: RJ022_RUN_ID,
    runStatus: 'failed',
    gateStatus: null,
    requestQuery: RJ022_REQUEST,
    displayTitle: 'Securing election data in county and state election offices',
    runRef: RJ022_RUN_REF,
    planIntent: 'investigative_synthesis',
    dossierCreatedAt: at(0),
    reportId: null,
    reportTitle: null,
    sourcesCitedCount: null,
    totalDurationMs: 839000,
    lastActivityAt: at(840),
    versionNumber: 1,
    isSpinoff: false,
    isRevised: false,
    spinoffFromReportId: null,
    engineVersion: 'v2',
  };
}

/** `GET /dossiers/:id` for the run: it has a request and a plan and no report. */
export function rj022Dossier(): Dossier {
  return {
    dossierId: RJ022_RUN_ID,
    runId: RJ022_RUN_ID,
    runStatus: 'failed',
    gateStatus: null,
    request: { query: RJ022_REQUEST, supplemental: null, supplementalAttachments: [], createdAt: at(0) },
    plan: {
      planId: '0d0a5a9e-2a0c-4d0e-9a51-6b0f0c1f8a11',
      intent: 'investigative_synthesis',
      orchestrationProfile: 'Investigative synthesis',
      planSummary: 'Find the programmes, audits and state practices that bear on election data security, and what officials say is unresolved.',
      planPayload: PLAN,
      planStatus: 'confirmed',
      refinementRounds: 0,
    },
    report: { reportId: null, title: null, status: null, finalizedAt: null },
    stats: {
      totalDurationMs: 839000,
      tokensInput: 412000,
      tokensOutput: 38100,
      sourcesRetrievedCount: 24,
      sourcesCitedCount: null,
      citationDensity: null,
      doubleCheckAnnotationsCount: 7,
      contradictionsCount: 3,
      refinementRounds: 0,
      agentsRan: ['planner', 'sleuth', 'retriever', 'quantitative', 'reasoner', 'double_check'],
      agentsSkipped: [],
      stageDurations: { planning: 14000, discovery: 184000, retrieval: 46000, reasoning: 187000, challenge: 87000, synthesis: 212000 },
      modelsUsed: ['deepseek/deepseek-v3.2', 'qwen/qwen3-235b-a22b'],
      estimatedCostCents: 96,
      actualCostCents: 71,
      reportEvidenceTierSummary: null,
      sourceClassBreakdown: { government: 11, academic: 4, news: 6, vendor: 3 },
      strongestFormPassCount: 1,
    },
  };
}
