/**
 * RJ-022B. The failed run of 9 Oct 2026 as the live API sends it to its owner,
 * measured after RJ-022 shipped:
 *
 *   GET /research/:id            423,098 bytes
 *     discovery_summary          390,314 bytes, of which `sources` is an array
 *                                of 317 items (388,940 bytes, about 1.2 KB each)
 *     progress_events             20,406 bytes
 *     corpus_after                 5,098 bytes
 *     model_ensemble               2,779 bytes
 *     failure_meta                   608 bytes
 *     retrieval_ids                   19 items
 *     model_log                    empty
 *   GET /research/:id/artifacts  902,613 bytes
 *
 * The RJ-022 fixture had a search of about fifty results, which is why it did
 * not hold the page still. This one has the run's real size: 317 search
 * results, each with a title, a web address, a snippet of a few hundred
 * characters and the reason it was or was not read. The longest unbroken run
 * of characters is a web address, about 115 characters, as measured live.
 *
 * It is the run's shape and size, not its content.
 */
import type { ResearchRun, RunArtifacts } from '../../utils/api';
import {
  RJ022_RUN_ID,
  RJ022_STORED_ERROR,
  rj022FailedRun,
  rj022FailedRunForCustomer,
  rj022ProgressEvents,
} from '../rj022/failedRunFixture';

export const RJ022B_SOURCE_COUNT = 317;
/** How many of the 317 the run went on to read. */
export const RJ022B_READ_COUNT = 25;

/**
 * What the retry route answered for this run before RJ-022B. The second
 * sentence reached customers.
 */
export const RJ022B_OLD_REFUSAL = {
  error: 'This failure is not retryable',
  reason:
    'The orchestrator classified this error as non-recoverable (auth / malformed request). Inspect the failure details and start a new run.',
};

/** What the retry route says to a person now. */
export const RJ022B_PLAIN_REFUSAL =
  "This request can't be run again. Press Send it as a new request to start it fresh; you have not been charged.";

const QUERIES = [
  'federal funding for voter registration database security HAVA grants 2022 2023 2024',
  'published penetration tests and independent audits of election management systems since 2022',
  'state risk-limiting audit requirements paper ballots statute comparison',
  'election vendor remote access encryption key custody county election office',
  'unfunded election security needs county officials testimony state auditor report',
];

const PROVIDERS = ['tavily', 'brave', 'parallel', 'openalex', 'crossref'];

const HOSTS = [
  'www.eac.gov',
  'www.cisa.gov',
  'www.gao.gov',
  'www.ncsl.org',
  'www.brennancenter.org',
  'electionlab.mit.edu',
  'www.auditor.state.oh.us',
  'sos.ga.gov',
  'www.sos.state.co.us',
  'verifiedvoting.org',
  'www.nass.org',
  'bipartisanpolicy.org',
  'www.govinfo.gov',
  'www.documentcloud.org',
  'statescoop.com',
  'www.votebeat.org',
];

const TITLE_PARTS = [
  'Election Security Grants: State-by-State Expenditure Report',
  'Voter Registration Database Security — Findings and Recommendations',
  'Risk-Limiting Audits: A Guide for Election Officials (2nd ed.)',
  'Performance Audit: Statewide Voter Registration System, Report No. 24-117',
  'Testimony Before the Committee on House Administration | Election Infrastructure',
  'Post-Election Audit Requirements by State [Updated]',
  'Remote Access to Election Management Systems: What Vendors Disclose',
  "County Clerks' Survey: Staffing, Funding & Cybersecurity Readiness",
  'Critical Infrastructure Security and Resilience Note: Election Systems',
  'Voting System Standards, Testing and Certification (VVSG 2.0)',
];

const SNIPPET_PARTS = [
  'The report records 14 open recommendations, of which 3 concern vendor remote access; the office accepted 11 and disputed 3 (see Table 2, p. 17).',
  'Since 2018, Congress has appropriated $955 million in HAVA election security grants; as of Sept. 30, 2023, states reported spending about 61% of the funds…',
  '“We can buy the hardware with the grant, but we cannot hire the person who patches it,” one county clerk told the committee on March 12, 2024.',
  'Auditors found multi-factor authentication was not enforced for 4 of 9 administrator accounts, and that 2 former contractors still held active credentials.',
  'Risk-limiting audits are required by statute in CO, GA, NV, RI and VA; pilot programmes exist in MI, NJ, OH and PA. Paper ballots are a precondition.',
  'The vendor states that encryption keys are generated on site and “never leave the county”; the auditor could not verify this because the key ceremony was not logged.',
  'CISA conducted 1,300+ physical security assessments and 700 cybersecurity assessments for election jurisdictions between 2022 and 2024, at no cost to the jurisdiction.',
  'Results reporting systems are separate from tabulation: the public website receives a one-way export, hashed (SHA-256) and compared against the canvass before certification.',
  'Of the 58 counties surveyed, 37 (64%) said they had no dedicated IT security staff; 22 relied on a single contractor shared with other departments.',
  'The court filing (No. 1:17-cv-2989-AT, Doc. 1681) describes how a forensic image of the election management server was copied and shared in January 2021.',
  'Section 4.2 — Access control. Each user SHALL be uniquely identified; shared accounts are not permitted. See also NIST SP 800-53 Rev. 5, AC-2 and IA-5(1).',
  'Abstract: We compare audit regimes across 50 states + DC (n = 51) and find that statutory audit scope predicts discrepancy detection (β = 0.41, p < 0.01).',
];

const READ_TITLES = [
  'Election Security Grants: State-by-State Expenditure Report',
  'Performance Audit: Statewide Voter Registration System, Report No. 24-117',
];

function pick<T>(list: readonly T[], i: number, stride = 1): T {
  return list[(i * stride) % list.length];
}

/** A web address of about `length` characters with no break in it, as a search result's address often is. */
function sourceUrl(i: number): string {
  const host = pick(HOSTS, i, 3);
  const slug = pick(TITLE_PARTS, i, 7)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const tail = i % 5 === 0 ? `?utm_source=search&doc_id=${100000 + i * 37}&page=${(i % 9) + 1}` : i % 5 === 1 ? `/report-${2022 + (i % 4)}-${String(i).padStart(4, '0')}.pdf` : `/${String(1000 + i)}`;
  return `https://${host}/${2022 + (i % 4)}/${String((i % 12) + 1).padStart(2, '0')}/${slug}${tail}`.slice(0, 115);
}

function snippet(i: number): string {
  // A few sentences, a few hundred characters, with the figures, quotation
  // marks, brackets and ellipses a search provider's extract carries.
  const body = [pick(SNIPPET_PARTS, i), pick(SNIPPET_PARTS, i + 5, 5), pick(SNIPPET_PARTS, i + 3, 7), pick(SNIPPET_PARTS, i + 7, 5).slice(0, 96)].join(' ');
  const lead = i % 4 === 0 ? `${String((i % 28) + 1)} ${['Jan', 'Mar', 'Jun', 'Oct'][i % 4]} ${2022 + (i % 4)} · ` : '';
  const more = i % 3 === 0 ? ` ... ${pick(SNIPPET_PARTS, i + 9, 11)} ... Read more` : ` ${pick(SNIPPET_PARTS, i + 9, 11)}`;
  return `${lead}${body}${more}`;
}

type DiscoverySourceEntry = {
  url: string;
  rank: number;
  score: number;
  title: string;
  snippet: string;
  ingested: boolean;
  provider: string;
  sourceQuery: string;
  ingestionJobId?: string;
  selectionRationale: string;
  skipReason?: string;
};

const jobId = (i: number) => `7c1e${String(i).padStart(4, '0')}-5b2a-4f0e-8a51-6b0f0c1f${String(8000 + i)}`;

/** `discovery_summary.sources`: every search result of the run, the ones read first, as the pipeline stores them. */
export function rj022bDiscoverySources(): DiscoverySourceEntry[] {
  const read: DiscoverySourceEntry[] = [];
  const setAside: DiscoverySourceEntry[] = [];
  for (let i = 0; i < RJ022B_SOURCE_COUNT; i += 1) {
    const score = Math.round((0.98 - (i % 60) * 0.011) * 1000) / 1000;
    const rank = (i % 20) + 1;
    const base = {
      url: sourceUrl(i),
      rank,
      score,
      title: `${i < READ_TITLES.length ? READ_TITLES[i] : pick(TITLE_PARTS, i, 3)}${i % 6 === 0 ? ` | ${pick(HOSTS, i, 3).replace(/^www\./, '')}` : ''} (${i + 1})`,
      snippet: snippet(i),
      provider: pick(PROVIDERS, i),
      sourceQuery: pick(QUERIES, i),
    };
    if (read.length < RJ022B_READ_COUNT && i % 12 < 1) {
      read.push({ ...base, ingested: true, ingestionJobId: jobId(i), selectionRationale: `score=${score.toFixed(2)}, rank=${rank}` });
      continue;
    }
    const why =
      i % 7 === 0
        ? { selectionRationale: 'already in corpus', skipReason: 'already_in_corpus' }
        : i % 7 === 1
          ? { selectionRationale: 'Set aside: a vendor page selling its own product, not evidence about the question', skipReason: 'vendor_sales' }
          : i % 7 === 2
            ? { selectionRationale: 'max_sources_to_ingest reached', skipReason: 'max_reached' }
            : i % 7 === 3
              ? { selectionRationale: 'not checked for relevance; not used', skipReason: 'not_judged' }
              : { selectionRationale: 'Set aside: not about what the request asks (it concerns campaign finance disclosure, not the security of election data)', skipReason: 'not_relevant' };
    setAside.push({ ...base, ingested: false, ...why });
  }
  // The first results fill the read list; the rest of the 25 come from the head of the set-aside list.
  while (read.length < RJ022B_READ_COUNT) {
    const next = setAside.shift()!;
    read.push({
      url: next.url,
      rank: next.rank,
      score: next.score,
      title: next.title,
      snippet: next.snippet,
      provider: next.provider,
      sourceQuery: next.sourceQuery,
      ingested: true,
      ingestionJobId: jobId(400 + read.length),
      selectionRationale: `score=${next.score.toFixed(2)}, rank=${next.rank}`,
    });
  }
  return [...read, ...setAside];
}

/** `research_runs.discovery_summary` as stored. */
export function rj022bDiscoverySummary(): Record<string, unknown> {
  const sources = rj022bDiscoverySources();
  return {
    runId: RJ022_RUN_ID,
    durationMs: 184213,
    planDecision: true,
    planRationale:
      'The request asks what is being done now to secure election data and names primary sources (agency reports, state auditor reports, court filings, published standards). The library holds little on this that is dated after 2022, so the web is searched: once for the federal programmes and their funding, once for published audits and penetration tests, once for where state practice differs, once for vendor access and key custody, and once for what officials say is unfunded. News coverage is searched last and only to find the primary documents it cites. Vendor pages are kept only where they are the sole record of a product claim, and are marked as such.',
    sourcesSkipped: sources.length - RJ022B_READ_COUNT,
    candidatesFound: sources.length,
    queriesExecuted: QUERIES,
    sourcesIngested: RJ022B_READ_COUNT,
    discoveryEnabled: true,
    candidatesSelected: RJ022B_READ_COUNT,
    sources,
  };
}

const ROLES = [
  'planner', 'retriever', 'source_class_classifier', 'quantitative', 'reasoner', 'strongest_form', 'double_check',
  'outline_architect', 'section_drafter', 'internal_challenger', 'coherence_refiner', 'verifier', 'plain_language_synthesizer',
];

function modelEnsemble(): Record<string, unknown> {
  return Object.fromEntries(
    ROLES.map((role, i) => [
      role,
      {
        primary: i % 2 === 0 ? 'deepseek/deepseek-v3.2' : 'qwen/qwen3-235b-a22b',
        fallback: i % 2 === 0 ? 'qwen/qwen3-235b-a22b' : 'deepseek/deepseek-v3.2',
        providerOrder: ['openrouter', 'together', 'huggingface_inference'],
        temperature: 0.2,
        maxTokens: 8000 + i * 500,
      },
    ])
  );
}

function corpusAfter(): Record<string, unknown> {
  return {
    sourceCount: 25,
    chunkCount: 228,
    retrievedChunkCount: 84,
    citationLock: false,
    authorityTiers: true,
    searchScope: { web: true, library: true, looselyMatched: 2 },
    topicPartition: 'election-data-security',
    bySource: Array.from({ length: RJ022B_READ_COUNT }, (_, i) => ({
      sourceId: `5d0a${String(i).padStart(4, '0')}-2a0c-4d0e-9a51-6b0f0c1f8a11`,
      title: `${pick(TITLE_PARTS, i, 3)} (${i + 1})`,
      chunks: 6 + (i % 9),
      authorityTier: ['primary', 'institutional', 'secondary'][i % 3],
    })),
  };
}

/**
 * What the run stored when it stopped, before RJ-019 (#274) shipped. The
 * provider's answer was already named for what it was (out of credit, HTTP
 * 402), but only a rate limit or an outage was then written down as something
 * a run could be run again after. So the row says `retryable: false`, and the
 * saved job a second attempt needs was not kept. The row still says so.
 */
const OLD_FAILURE_META: Record<string, unknown> = {
  classification: 'quota_exceeded',
  status: 402,
  providerMessage:
    'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.',
  model: 'deepseek/deepseek-v3.2',
  fallbackTried: true,
  role: 'section_drafter',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  upstream: 'openrouter',
  providerFallbackAttempted: false,
  retryable: false,
  terminal: true,
  abortReason: 'non_recoverable_classification',
  resumeAvailable: false,
  retryAttempts: 0,
  retryBudget: 2,
  attemptsRemaining: 2,
};

/** The sentence the server sends a customer for this run: it cannot be run again, so it names the link the page offers. */
export const RJ022B_CUSTOMER_SENTENCE =
  'The report could not be written because our AI service is temporarily unavailable. You have not been charged. Press Send it as a new request to start it fresh; you are only charged once, when a report is delivered.';

/** The sentence the page prints for an administrator, who is sent the stored error instead of a sentence. */
export const RJ022B_ADMIN_SENTENCE =
  'This run could not be finished. You have not been charged. Press Send it as a new request to start it fresh; you are only charged once, when a report is delivered.';

/**
 * `GET /research/:id` as the run's owner, who is an administrator, is sent it:
 * the whole stored row, with all 317 search results.
 */
export function rj022bFailedRun(over: Partial<ResearchRun> = {}): ResearchRun {
  const events = rj022ProgressEvents();
  const last = events[events.length - 1];
  events[events.length - 1] = {
    ...last,
    message: `Run failed. ${RJ022_STORED_ERROR}`,
    failure: { errorMessage: RJ022_STORED_ERROR, retryable: false, failureMeta: OLD_FAILURE_META },
  };
  const row = {
    ...rj022FailedRun(),
    failure_meta: OLD_FAILURE_META,
    model_log: [],
    model_ensemble: modelEnsemble(),
    progress_events: events,
    progress_message: `Run failed. ${RJ022_STORED_ERROR}`,
    discovery_summary: rj022bDiscoverySummary(),
    corpus_after: corpusAfter(),
    retrieval_ids: Array.from({ length: 19 }, (_, i) => `9a51${String(i).padStart(4, '0')}-6b0f-4c1f-8a11-0d0a5a9e2a0c`),
    ...over,
  };
  return row as ResearchRun;
}

/** The same row as a person who is not an administrator is sent it: the sources read, not the 292 set aside. */
export function rj022bFailedRunForCustomer(over: Partial<ResearchRun> = {}): ResearchRun {
  const summary = rj022bDiscoverySummary();
  const row = {
    ...rj022FailedRunForCustomer(),
    error_message: RJ022B_CUSTOMER_SENTENCE,
    progress_message: RJ022B_CUSTOMER_SENTENCE,
    failure_meta: { retryable: false, terminal: true, resumeAvailable: false, retryAttempts: 0, retryBudget: 2, attemptsRemaining: 2 },
    progress_events: rj022FailedRunForCustomer().progress_events?.map((event) =>
      event.failure ? { ...event, message: RJ022B_CUSTOMER_SENTENCE, failure: { errorMessage: RJ022B_CUSTOMER_SENTENCE, retryable: false } } : event
    ),
    discovery_summary: {
      ...summary,
      sources: (summary.sources as DiscoverySourceEntry[]).filter((s) => s.ingested),
    },
    corpus_after: corpusAfter(),
    ...over,
  };
  return row as ResearchRun;
}

/** `GET /research/:id/artifacts` for an administrator: about 900 KB. */
export function rj022bArtifacts(): RunArtifacts {
  const summary = rj022bDiscoverySummary();
  const sources = summary.sources as DiscoverySourceEntry[];
  const start = Date.UTC(2026, 9, 9, 13, 17, 20);
  const stamp = (seconds: number) => new Date(start + seconds * 1000).toISOString();
  const byQuery = QUERIES.map((q) => sources.filter((s) => s.sourceQuery === q));
  const discoveryEvents: NonNullable<RunArtifacts['discoveryEvents']> = [
    { phase: 'plan', provider: 'planner', query_text: '', result_count: 0, selected_count: 0, payload: { decision: true, rationale: summary.planRationale, queries: QUERIES }, created_at: stamp(0) },
    ...QUERIES.map((q, i) => ({
      phase: 'search',
      provider: pick(PROVIDERS, i),
      query_text: q,
      result_count: byQuery[i].length,
      selected_count: byQuery[i].filter((s) => s.ingested).length,
      // The provider's answer for the search, as stored: every result with its extract.
      payload: {
        round: i < 3 ? 1 : 2,
        results: byQuery[i].map((s) => ({ url: s.url, title: s.title, snippet: s.snippet, score: s.score, rank: s.rank, provider: s.provider })),
      },
      created_at: stamp(4 + i * 6),
    })),
    {
      phase: 'relevance_gate',
      provider: 'judge',
      query_text: '',
      result_count: sources.length,
      selected_count: RJ022B_READ_COUNT,
      payload: {
        kept: RJ022B_READ_COUNT,
        set_aside: sources.length - RJ022B_READ_COUNT,
        not_used: sources
          .filter((s) => s.skipReason === 'not_relevant' || s.skipReason === 'vendor_sales')
          .map((s) => ({ url: s.url, title: s.title, reason: s.skipReason === 'vendor_sales' ? 'vendor_sales' : 'off_topic', why: s.selectionRationale })),
      },
      created_at: stamp(51),
    },
    { phase: 'ingest', provider: 'queue', query_text: '', result_count: RJ022B_READ_COUNT, selected_count: RJ022B_READ_COUNT, payload: { jobIds: sources.filter((s) => s.ingested).map((s) => s.ingestionJobId) }, created_at: stamp(54) },
  ];
  return {
    sources: sources
      .filter((s) => s.ingested)
      .slice(0, 19)
      .map((s, i) => ({
        id: `5d0a${String(i).padStart(4, '0')}-2a0c-4d0e-9a51-6b0f0c1f8a11`,
        title: s.title,
        url: s.url,
        source_type: 'web_url',
        tags: i % 3 === 0 ? ['government'] : [],
        ingested_at: stamp(60 + i * 4),
      })),
    claims: [],
    checkpoints: [
      { stage: 'planning', checkpoint_key: 'plan', snapshot: { queries: QUERIES }, created_at: stamp(-70) },
      { stage: 'discovery', checkpoint_key: 'discovery_summary', snapshot: { candidatesFound: sources.length, sourcesIngested: RJ022B_READ_COUNT }, created_at: stamp(56) },
      { stage: 'retrieval', checkpoint_key: 'retrieval_ids', snapshot: { count: 19 }, created_at: stamp(190) },
    ],
    sourcesTotal: 19,
    claimsTotal: 0,
    progressEvents: rj022bFailedRun().progress_events,
    plan: rj022bFailedRun().plan ?? null,
    discoverySummary: summary,
    discoveryEvents,
    notUsedSources: sources
      .filter((s) => !s.ingested)
      .map((s) => ({
        title: s.title,
        url: s.url,
        stage: 'search_result' as const,
        label: s.skipReason === 'vendor_sales' ? 'Set aside: a vendor selling its own product' : 'Set aside: not about the request',
        why: s.selectionRationale,
      })),
    modelLog: [],
    modelOverrides: null,
    modelEnsemble: modelEnsemble(),
    reportId: null,
  };
}
