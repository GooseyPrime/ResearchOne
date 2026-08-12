import path from 'path';
import { loadEnv, getRepoRoot } from '../bootstrap/loadEnv';
import {
  validateReasoningModelPolicy,
  type ReasoningModelRole,
} from '../services/reasoning/reasoningModelPolicy';
import {
  validateEnsemblePresetsAgainstAllowlist,
  validateV2ModePresetsAgainstAllowlist,
} from './researchEnsemblePresets';
import { CODE_DEFAULT_REASONING_FALLBACKS, CODE_DEFAULT_REASONING_MODELS } from './defaultModels';
import { resolveCorsOrigins } from './corsOrigins';
import { resolveStripeCheckoutRedirect } from './stripeCheckoutUrls';

loadEnv();

const ALLOWED_NODE_ENVS = new Set(['development', 'test', 'production']);
const ALLOWED_SEARCH_PROVIDERS = new Set(['tavily', 'generic', 'brave', 'cascade']);

const rawNodeEnv = (process.env.NODE_ENV || 'development').trim();
if (!ALLOWED_NODE_ENVS.has(rawNodeEnv)) {
  throw new Error(
    `Invalid NODE_ENV="${rawNodeEnv}". Allowed values: development, test, production`
  );
}

function isLocalhostUrl(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function assertHttpUrl(value: string, envName: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL (e.g. https://example.com/path)`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${envName} must use http or https`);
  }
}

function validateOpenRouterBaseUrl(baseUrl: string): void {
  assertHttpUrl(baseUrl, 'OPENROUTER_BASE_URL');

  const parsed = new URL(baseUrl);

  const normalizedPath = parsed.pathname.replace(/\/+$/, '').toLowerCase();
  const endpointPaths = new Set([
    '/chat/completions',
    '/v1/chat/completions',
    '/responses',
    '/v1/responses',
    '/embeddings',
    '/v1/embeddings',
  ]);
  if (endpointPaths.has(normalizedPath)) {
    throw new Error(
      'OPENROUTER_BASE_URL must be a base URL (for example https://openrouter.ai/api/v1), not a full endpoint path like /chat/completions'
    );
  }
}

const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  /** Bind address for the HTTP server (default IPv4-all so curl 127.0.0.1 works when IPv6-only :: would not). */
  listenHost: (process.env.LISTEN_HOST || '0.0.0.0').trim() || '0.0.0.0',
  nodeEnv: rawNodeEnv,
  corsOrigins: resolveCorsOrigins(process.env.CORS_ORIGINS, 'http://localhost:5173'),

  db: {
    host: process.env.DB_HOST || '10.0.101.2',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'researchone',
    user: process.env.DB_USER || 'researchone',
    password: process.env.DB_PASSWORD || 'changeme',
    url: process.env.DATABASE_URL,
  },


  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY || '',
    webhookSecret: process.env.CLERK_WEBHOOK_SECRET || '',
  },

  sheerid: {
    apiToken: process.env.SHEERID_API_TOKEN || '',
    programId: process.env.SHEERID_PROGRAM_ID || '',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    successUrl: resolveStripeCheckoutRedirect(
      process.env.STRIPE_CHECKOUT_SUCCESS_URL,
      'STRIPE_CHECKOUT_SUCCESS_URL',
      rawNodeEnv,
      'http://localhost:5173/app/billing?checkout=success',
    ),
    cancelUrl: resolveStripeCheckoutRedirect(
      process.env.STRIPE_CHECKOUT_CANCEL_URL,
      'STRIPE_CHECKOUT_CANCEL_URL',
      rawNodeEnv,
      'http://localhost:5173/app/billing?checkout=cancel',
    ),
    priceIds: {
      studentMonthly: process.env.STRIPE_PRICE_ID_STUDENT_MONTHLY || '',
      studentAnnual: process.env.STRIPE_PRICE_ID_STUDENT_ANNUAL || '',
      proMonthly: process.env.STRIPE_PRICE_ID_PRO_MONTHLY || '',
      proAnnual: process.env.STRIPE_PRICE_ID_PRO_ANNUAL || '',
      teamSeatMonthly: process.env.STRIPE_PRICE_ID_TEAM_SEAT_MONTHLY || '',
      teamSeatAnnual: process.env.STRIPE_PRICE_ID_TEAM_SEAT_ANNUAL || '',
      byokMonthly: process.env.STRIPE_PRICE_ID_BYOK_MONTHLY || '',
      byokAnnual: process.env.STRIPE_PRICE_ID_BYOK_ANNUAL || '',
      wallet20: process.env.STRIPE_PRICE_ID_WALLET_20 || '',
      wallet50: process.env.STRIPE_PRICE_ID_WALLET_50 || '',
      wallet100: process.env.STRIPE_PRICE_ID_WALLET_100 || '',
      livingReportMonthly: process.env.STRIPE_PRICE_ID_LIVING_REPORT_MONTHLY || '',
      reverseCitationWatchMonthly: process.env.STRIPE_PRICE_ID_REVERSE_CITATION_WATCH_MONTHLY || '',
      monitorTokenPack1: process.env.STRIPE_PRICE_ID_MONITOR_TOKEN_PACK_1 || '',
      monitorTokenPack5: process.env.STRIPE_PRICE_ID_MONITOR_TOKEN_PACK_5 || '',
      monitorTokenPack10: process.env.STRIPE_PRICE_ID_MONITOR_TOKEN_PACK_10 || '',
    },
  },

  /** Parallel Monitor / Living Reports (Work Order T). Uses same API key as discovery Parallel unless overridden. */
  parallelMonitor: {
    apiKey: process.env.PARALLEL_MONITOR_API_KEY || process.env.PARALLEL_API_KEY || '',
    webhookSecret: process.env.PARALLEL_MONITOR_WEBHOOK_SECRET || '',
    baseUrl: (process.env.PARALLEL_BASE_URL || 'https://api.parallel.ai/v1').replace(/\/+$/, ''),
  },

  /** BugNote feedback widget + inbound webhooks (env-gated; see docs/integrations/bugnote-scope.md). */
  bugnote: {
    webhookSecret: process.env.BUGNOTE_WEBHOOK_SECRET || '',
  },

  redis: {
    host: process.env.REDIS_HOST || '10.0.101.3',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD || undefined,
    username: process.env.REDIS_USERNAME || undefined,
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    /**
     * `provider.data_collection` value sent on every OpenRouter chat
     * completion. Default `'allow'` lets OpenRouter route to the broadest
     * upstream set (which is what stops the "No allowed providers
     * available" 404 we hit on 2026-04-28-PM). Set
     * `OPENROUTER_DATA_COLLECTION=deny` to require upstreams that do not
     * train on prompts; the cost is fewer upstreams per model and more
     * frequent provider-unavailable errors.
     */
    dataCollection: (process.env.OPENROUTER_DATA_COLLECTION || 'allow').toLowerCase(),
  },

  together: {
    apiKey: process.env.TOGETHER_API_KEY || '',
    baseUrl: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
  },

  /** Hugging Face Inference API token (Research One 2 red-team models). Optional unless V2 HF routes run. */
  hfToken: process.env.HF_TOKEN || '',

  // OpenRouter slugs — defaults from `defaultModels.ts`; optional env overrides for emergencies.
  models: {
    planner: process.env.PLANNER_MODEL || CODE_DEFAULT_REASONING_MODELS.planner,
    retriever: process.env.RETRIEVER_MODEL || CODE_DEFAULT_REASONING_MODELS.retriever,
    sourceClassClassifier:
      process.env.SOURCE_CLASS_CLASSIFIER_MODEL || CODE_DEFAULT_REASONING_MODELS.sourceClassClassifier,
    reasoner: process.env.REASONER_MODEL || CODE_DEFAULT_REASONING_MODELS.reasoner,
    steelman: process.env.STEELMAN_MODEL || CODE_DEFAULT_REASONING_MODELS.steelman,
    skeptic: process.env.SKEPTIC_MODEL || CODE_DEFAULT_REASONING_MODELS.skeptic,
    synthesizer: process.env.SYNTHESIZER_MODEL || CODE_DEFAULT_REASONING_MODELS.synthesizer,
    verifier: process.env.VERIFIER_MODEL || CODE_DEFAULT_REASONING_MODELS.verifier,
    plainLanguageSynthesizer:
      process.env.PLAIN_LANGUAGE_SYNTHESIZER_MODEL || CODE_DEFAULT_REASONING_MODELS.plainLanguageSynthesizer,
    outlineArchitect: process.env.OUTLINE_ARCHITECT_MODEL || CODE_DEFAULT_REASONING_MODELS.outlineArchitect,
    sectionDrafter: process.env.SECTION_DRAFTER_MODEL || CODE_DEFAULT_REASONING_MODELS.sectionDrafter,
    internalChallenger: process.env.INTERNAL_CHALLENGER_MODEL || CODE_DEFAULT_REASONING_MODELS.internalChallenger,
    coherenceRefiner: process.env.COHERENCE_REFINER_MODEL || CODE_DEFAULT_REASONING_MODELS.coherenceRefiner,
    revisionIntake: process.env.REVISION_INTAKE_MODEL || CODE_DEFAULT_REASONING_MODELS.revisionIntake,
    reportLocator: process.env.REPORT_LOCATOR_MODEL || CODE_DEFAULT_REASONING_MODELS.reportLocator,
    changePlanner: process.env.CHANGE_PLANNER_MODEL || CODE_DEFAULT_REASONING_MODELS.changePlanner,
    sectionRewriter: process.env.SECTION_REWRITER_MODEL || CODE_DEFAULT_REASONING_MODELS.sectionRewriter,
    citationIntegrityChecker:
      process.env.CITATION_INTEGRITY_CHECKER_MODEL || CODE_DEFAULT_REASONING_MODELS.citationIntegrityChecker,
    citationFormatter: process.env.CITATION_FORMATTER_MODEL || CODE_DEFAULT_REASONING_MODELS.citationFormatter,
    finalRevisionVerifier: process.env.FINAL_REVISION_VERIFIER_MODEL || CODE_DEFAULT_REASONING_MODELS.finalRevisionVerifier,
    /** Phase B — Deliverable Contract Auditor; env override for ops. */
    contractAuditor: process.env.CONTRACT_AUDITOR_MODEL || CODE_DEFAULT_REASONING_MODELS.contractAuditor,
    marketScout: process.env.MARKET_SCOUT_MODEL || CODE_DEFAULT_REASONING_MODELS.marketScout,
    competitorMapper: process.env.COMPETITOR_MAPPER_MODEL || CODE_DEFAULT_REASONING_MODELS.competitorMapper,
    demandSignalAnalyst:
      process.env.DEMAND_SIGNAL_ANALYST_MODEL || CODE_DEFAULT_REASONING_MODELS.demandSignalAnalyst,
    feasibilityArchitect:
      process.env.FEASIBILITY_ARCHITECT_MODEL || CODE_DEFAULT_REASONING_MODELS.feasibilityArchitect,
    storyVerifier: process.env.STORY_VERIFIER_MODEL || CODE_DEFAULT_REASONING_MODELS.storyVerifier,
    timelineReconstructor:
      process.env.TIMELINE_RECONSTRUCTOR_MODEL || CODE_DEFAULT_REASONING_MODELS.timelineReconstructor,
    dataAnalysisSpecialist:
      process.env.DATA_ANALYSIS_SPECIALIST_MODEL || CODE_DEFAULT_REASONING_MODELS.dataAnalysisSpecialist,
    quantitativeQualityAuditor:
      process.env.QUANTITATIVE_QUALITY_AUDITOR_MODEL || CODE_DEFAULT_REASONING_MODELS.quantitativeQualityAuditor,
    embedding: process.env.EMBEDDING_MODEL || CODE_DEFAULT_REASONING_MODELS.embedding,

    /** Wave 5.1 — intent/plan gate LLM; tier-uniform; env override for ops. */
    planning: process.env.PLANNING_MODEL_ID?.trim() || CODE_DEFAULT_REASONING_MODELS.planner,

    fallbacks: {
      planner: process.env.PLANNER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.planner,
      retriever: process.env.RETRIEVER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.retriever,
      sourceClassClassifier:
        process.env.SOURCE_CLASS_CLASSIFIER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.sourceClassClassifier,
      reasoner: process.env.REASONER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.reasoner,
      steelman: process.env.STEELMAN_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.steelman,
      skeptic: process.env.SKEPTIC_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.skeptic,
      synthesizer: process.env.SYNTHESIZER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.synthesizer,
      verifier: process.env.VERIFIER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.verifier,
      plainLanguageSynthesizer:
        process.env.PLAIN_LANGUAGE_SYNTHESIZER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.plainLanguageSynthesizer,
      outlineArchitect: process.env.OUTLINE_ARCHITECT_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.outlineArchitect,
      sectionDrafter: process.env.SECTION_DRAFTER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.sectionDrafter,
      internalChallenger: process.env.INTERNAL_CHALLENGER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.internalChallenger,
      coherenceRefiner: process.env.COHERENCE_REFINER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.coherenceRefiner,
      revisionIntake: process.env.REVISION_INTAKE_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.revisionIntake,
      reportLocator: process.env.REPORT_LOCATOR_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.reportLocator,
      changePlanner: process.env.CHANGE_PLANNER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.changePlanner,
      sectionRewriter: process.env.SECTION_REWRITER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.sectionRewriter,
      citationIntegrityChecker:
        process.env.CITATION_INTEGRITY_CHECKER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.citationIntegrityChecker,
      citationFormatter: process.env.CITATION_FORMATTER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.citationFormatter,
      finalRevisionVerifier: process.env.FINAL_REVISION_VERIFIER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.finalRevisionVerifier,
      contractAuditor: process.env.CONTRACT_AUDITOR_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.contractAuditor,
      marketScout: process.env.MARKET_SCOUT_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.marketScout,
      competitorMapper:
        process.env.COMPETITOR_MAPPER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.competitorMapper,
      demandSignalAnalyst:
        process.env.DEMAND_SIGNAL_ANALYST_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.demandSignalAnalyst,
      feasibilityArchitect:
        process.env.FEASIBILITY_ARCHITECT_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.feasibilityArchitect,
      storyVerifier: process.env.STORY_VERIFIER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.storyVerifier,
      timelineReconstructor:
        process.env.TIMELINE_RECONSTRUCTOR_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.timelineReconstructor,
      dataAnalysisSpecialist:
        process.env.DATA_ANALYSIS_SPECIALIST_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.dataAnalysisSpecialist,
      quantitativeQualityAuditor:
        process.env.QUANTITATIVE_QUALITY_AUDITOR_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.quantitativeQualityAuditor,
    },
  },

  embedding: {
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '20', 10),
  },

  ingestion: {
    maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE || '1000', 10),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200', 10),
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),
    siteCrawlMaxLayers: parseInt(process.env.SITE_CRAWL_MAX_LAYERS || '5', 10),
    siteCrawlMaxPages: parseInt(process.env.SITE_CRAWL_MAX_PAGES || '50', 10),
  },

  discovery: {
    enabled: process.env.DISCOVERY_ENABLED !== 'false',
    provider: process.env.SEARCH_PROVIDER || 'tavily',
    providerApiKey: process.env.SEARCH_PROVIDER_API_KEY || '',
    providerBaseUrl: process.env.SEARCH_PROVIDER_BASE_URL || '',
    tavilyApiKey: process.env.TAVILY_API_KEY || '',
    tavilyBaseUrl: process.env.TAVILY_BASE_URL || 'https://api.tavily.com/search',
    maxResults: parseInt(process.env.MAX_EXTERNAL_DISCOVERY_RESULTS || '25', 10),
    maxIngestPerRun: parseInt(process.env.MAX_EXTERNAL_INGEST_PER_RUN || '10', 10),
    maxQueriesPerRun: parseInt(process.env.MAX_DISCOVERY_QUERIES_PER_RUN || '5', 10),
    ingestionWaitTimeoutMs: parseInt(process.env.DISCOVERY_INGEST_TIMEOUT_MS || '90000', 10),
    queryableWaitTimeoutMs: parseInt(process.env.DISCOVERY_QUERYABLE_TIMEOUT_MS || '120000', 10),
    parallelApiKey: process.env.PARALLEL_API_KEY || '',
    parallelBaseUrl: (process.env.PARALLEL_BASE_URL || 'https://api.parallel.ai/v1').replace(/\/+$/, ''),
    sciteApiKey: process.env.SCITE_API_KEY || '',
    sciteBaseUrl: (process.env.SCITE_BASE_URL || 'https://api.scite.ai/v1').replace(/\/+$/, ''),
    openAlexUserAgent: process.env.OPENALEX_USER_AGENT || 'ResearchOne/1.0 (mailto:hello@researchone.io)',
    crossrefUserAgent: process.env.CROSSREF_USER_AGENT || 'ResearchOne/1.0 (mailto:hello@researchone.io)',
  },

  retrieval: {
    minSimilarityDefault: (() => {
      const parsed = parseFloat(process.env.RETRIEVAL_MIN_SIMILARITY || '0.55');
      return Number.isFinite(parsed) ? Math.max(0.55, parsed) : 0.55;
    })(),
    corpusGate: {
      minDistinctDomains: parseInt(process.env.CORPUS_GATE_MIN_DISTINCT_DOMAINS || '8', 10),
      minDistinctSources: parseInt(process.env.CORPUS_GATE_MIN_DISTINCT_SOURCES || '25', 10),
      minTotalChunks: parseInt(process.env.CORPUS_GATE_MIN_TOTAL_CHUNKS || '400', 10),
      maxSingleDomainShare: parseFloat(process.env.CORPUS_GATE_MAX_SINGLE_DOMAIN_SHARE || '0.35'),
      maxSelfSourceShare: parseFloat(process.env.CORPUS_GATE_MAX_SELF_SOURCE_SHARE || '0.20'),
      maxMedianSourceAgeMonths: parseInt(process.env.CORPUS_GATE_MAX_MEDIAN_SOURCE_AGE_MONTHS || '24', 10),
      globalBootstrapMinTotalChunks: parseInt(process.env.CORPUS_GATE_GLOBAL_BOOTSTRAP_MIN_TOTAL_CHUNKS || '800', 10),
    },
  },

  exports: {
    dir: process.env.EXPORTS_DIR || '/opt/researchone/exports',
    atlasBackupDir: process.env.ATLAS_BACKUP_DIR || '',
    autoExportOnEmbedding: process.env.ATLAS_AUTO_EXPORT_ON_EMBEDDING === 'true',
  },

  atlas: {
    maxChunksPerExport: (() => {
      const raw = parseInt(process.env.ATLAS_EXPORT_MAX_CHUNKS || '50000', 10);
      return Number.isFinite(raw) && raw > 0 ? raw : 50000;
    })(),
  },

  nomic: {
    apiKey: process.env.NOMIC_API_KEY || '',
    atlasDatasetSlug: process.env.NOMIC_ATLAS_DATASET_SLUG || 'intellme',
    atlasBaseUrl: process.env.NOMIC_ATLAS_BASE_URL || 'https://api-atlas.nomic.ai',
    autoUploadOnExport: process.env.NOMIC_AUTO_UPLOAD_ON_EXPORT === 'true',
  },

  /** Optional: publish full reports to GitHub for thenewontology.life Featured Reports workflow */
  featuredReportGithub: {
    token: process.env.FEATURED_REPORT_GITHUB_TOKEN || '',
    owner:
      (process.env.FEATURED_REPORT_GITHUB_OWNER || '').trim() ||
      (rawNodeEnv === 'production' ? '' : 'GooseyPrime'),
    repo:
      (process.env.FEATURED_REPORT_GITHUB_REPO || '').trim() ||
      (rawNodeEnv === 'production' ? '' : 'newontology'),
    path: process.env.FEATURED_REPORT_GITHUB_PATH || 'content/featured-reports/latest.md',
    branch: process.env.FEATURED_REPORT_GITHUB_BRANCH || 'main',
  },

  /** Optional: open GitHub Issues for terminal run errors so agents can triage and respond */
  errorReportGithub: {
    token: process.env.ERROR_REPORT_GITHUB_TOKEN || '',
    owner:
      (process.env.ERROR_REPORT_GITHUB_OWNER || '').trim() ||
      (rawNodeEnv === 'production' ? '' : 'GooseyPrime'),
    repo:
      (process.env.ERROR_REPORT_GITHUB_REPO || '').trim() ||
      (rawNodeEnv === 'production' ? '' : 'ResearchOne'),
  },

  admin: {
    token: process.env.ADMIN_RUNTIME_TOKEN || '',
    userIds: (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    restartCommand: process.env.RUNTIME_RESTART_COMMAND || 'pm2 restart researchone-api',
    /** PM2 stdout log (default matches ecosystem.config.js cwd + paths) */
    runtimeLogOut:
      process.env.RUNTIME_LOG_OUT ||
      path.join(getRepoRoot(), 'backend/logs/pm2-out.log'),
    /** PM2 stderr log */
    runtimeLogErr:
      process.env.RUNTIME_LOG_ERR ||
      path.join(getRepoRoot(), 'backend/logs/pm2-error.log'),
  },

  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret && rawNodeEnv === 'production') {
      throw new Error('JWT_SECRET must be set in production environment');
    }
    return secret || 'dev-secret-change-in-production';
  })(),
};

validateOpenRouterBaseUrl(config.openrouter.baseUrl);

if (config.nodeEnv === 'production' && !config.openrouter.apiKey.trim()) {
  throw new Error('OPENROUTER_API_KEY must be set in production environment');
}

if (config.nodeEnv === 'production') {
  if (config.corsOrigins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must include at least one frontend origin in production (e.g. https://your-app.vercel.app)'
    );
  }

  const hasNonLocalOrigin = config.corsOrigins.some((origin) => !isLocalhostUrl(origin));
  if (!hasNonLocalOrigin) {
    throw new Error(
      'CORS_ORIGINS cannot be localhost-only in production. Include your Vercel/custom frontend domain.'
    );
  }
}

if (config.discovery.enabled) {
  if (!ALLOWED_SEARCH_PROVIDERS.has(config.discovery.provider)) {
    throw new Error(
      `Invalid SEARCH_PROVIDER="${config.discovery.provider}". Allowed providers: tavily, generic, brave, cascade`
    );
  }

  if (config.discovery.provider === 'tavily' && !config.discovery.tavilyApiKey.trim()) {
    throw new Error('TAVILY_API_KEY must be set when SEARCH_PROVIDER=tavily and DISCOVERY_ENABLED=true');
  }

  if (config.discovery.provider === 'brave' && !config.discovery.providerApiKey.trim()) {
    throw new Error(
      'SEARCH_PROVIDER_API_KEY must be set when SEARCH_PROVIDER=brave and DISCOVERY_ENABLED=true'
    );
  }

  if (config.discovery.provider === 'generic') {
    if (!config.discovery.providerBaseUrl.trim()) {
      throw new Error(
        'SEARCH_PROVIDER_BASE_URL must be set when SEARCH_PROVIDER=generic and DISCOVERY_ENABLED=true'
      );
    }
    assertHttpUrl(config.discovery.providerBaseUrl, 'SEARCH_PROVIDER_BASE_URL');
  }

  if (config.discovery.provider === 'cascade') {
    if (!config.discovery.tavilyApiKey.trim()) {
      throw new Error(
        'TAVILY_API_KEY must be set when SEARCH_PROVIDER=cascade and DISCOVERY_ENABLED=true'
      );
    }
    if (!config.discovery.providerApiKey.trim()) {
      throw new Error(
        'SEARCH_PROVIDER_API_KEY must be set when SEARCH_PROVIDER=cascade to enable Brave in the cascade'
      );
    }
    if (!config.discovery.providerBaseUrl.trim()) {
      throw new Error(
        'SEARCH_PROVIDER_BASE_URL must be set when SEARCH_PROVIDER=cascade to enable Generic provider in the cascade'
      );
    }
    assertHttpUrl(config.discovery.providerBaseUrl, 'SEARCH_PROVIDER_BASE_URL');
  }
}

if (config.nodeEnv === 'production') {
  const dbPw = process.env.DB_PASSWORD;
  const hasDbUrl = !!process.env.DATABASE_URL?.trim();
  if (!hasDbUrl && (!dbPw || dbPw === 'changeme')) {
    throw new Error('DB_PASSWORD must be set (and not "changeme") in production, or provide DATABASE_URL');
  }
  if (!config.clerk.secretKey.trim()) {
    throw new Error('CLERK_SECRET_KEY must be set in production');
  }
  if (!config.clerk.webhookSecret.trim()) {
    throw new Error('CLERK_WEBHOOK_SECRET must be set in production');
  }
  if (!config.stripe.secretKey.trim()) {
    throw new Error('STRIPE_SECRET_KEY must be set in production');
  }
  if (!config.stripe.webhookSecret.trim()) {
    throw new Error('STRIPE_WEBHOOK_SECRET must be set in production');
  }
  const byokKey = process.env.BYOK_ENCRYPTION_KEY;
  if (!byokKey || !byokKey.trim()) {
    throw new Error('BYOK_ENCRYPTION_KEY must be set in production');
  }

  const explicitRedis =
    Boolean(process.env.REDIS_HOST?.trim()) || Boolean(process.env.REDIS_URL?.trim());
  if (!explicitRedis && config.redis.host === '10.0.101.3') {
    throw new Error(
      'REDIS_HOST or REDIS_URL must be set in production — the fallback 10.0.101.3 is an internal Emma VM placeholder, not portable',
    );
  }

  if (config.featuredReportGithub.token.trim()) {
    if (!config.featuredReportGithub.owner.trim() || !config.featuredReportGithub.repo.trim()) {
      throw new Error(
        'FEATURED_REPORT_GITHUB_OWNER and FEATURED_REPORT_GITHUB_REPO must be set when FEATURED_REPORT_GITHUB_TOKEN is configured',
      );
    }
  }
}

const reasoningModelsForPolicy = {
  planner: config.models.planner,
  retriever: config.models.retriever,
  source_class_classifier: config.models.sourceClassClassifier,
  reasoner: config.models.reasoner,
  steelman: config.models.steelman,
  skeptic: config.models.skeptic,
  synthesizer: config.models.synthesizer,
  verifier: config.models.verifier,
  plain_language_synthesizer: config.models.plainLanguageSynthesizer,
  outline_architect: config.models.outlineArchitect,
  section_drafter: config.models.sectionDrafter,
  internal_challenger: config.models.internalChallenger,
  coherence_refiner: config.models.coherenceRefiner,
  revision_intake: config.models.revisionIntake,
  report_locator: config.models.reportLocator,
  change_planner: config.models.changePlanner,
  section_rewriter: config.models.sectionRewriter,
  citation_integrity_checker: config.models.citationIntegrityChecker,
  citation_formatter: config.models.citationFormatter,
  final_revision_verifier: config.models.finalRevisionVerifier,
  contract_auditor: config.models.contractAuditor,
  market_scout: config.models.marketScout,
  competitor_mapper: config.models.competitorMapper,
  demand_signal_analyst: config.models.demandSignalAnalyst,
  feasibility_architect: config.models.feasibilityArchitect,
  story_verifier: config.models.storyVerifier,
  timeline_reconstructor: config.models.timelineReconstructor,
  data_analysis_specialist: config.models.dataAnalysisSpecialist,
  quantitative_quality_auditor: config.models.quantitativeQualityAuditor,
} satisfies Record<ReasoningModelRole, string | undefined>;

const reasoningFallbacksForPolicy = {
  planner: config.models.fallbacks.planner,
  retriever: config.models.fallbacks.retriever,
  source_class_classifier: config.models.fallbacks.sourceClassClassifier,
  reasoner: config.models.fallbacks.reasoner,
  steelman: config.models.fallbacks.steelman,
  skeptic: config.models.fallbacks.skeptic,
  synthesizer: config.models.fallbacks.synthesizer,
  verifier: config.models.fallbacks.verifier,
  plain_language_synthesizer: config.models.fallbacks.plainLanguageSynthesizer,
  outline_architect: config.models.fallbacks.outlineArchitect,
  section_drafter: config.models.fallbacks.sectionDrafter,
  internal_challenger: config.models.fallbacks.internalChallenger,
  coherence_refiner: config.models.fallbacks.coherenceRefiner,
  revision_intake: config.models.fallbacks.revisionIntake,
  report_locator: config.models.fallbacks.reportLocator,
  change_planner: config.models.fallbacks.changePlanner,
  section_rewriter: config.models.fallbacks.sectionRewriter,
  citation_integrity_checker: config.models.fallbacks.citationIntegrityChecker,
  citation_formatter: config.models.fallbacks.citationFormatter,
  final_revision_verifier: config.models.fallbacks.finalRevisionVerifier,
  contract_auditor: config.models.fallbacks.contractAuditor,
  market_scout: config.models.fallbacks.marketScout,
  competitor_mapper: config.models.fallbacks.competitorMapper,
  demand_signal_analyst: config.models.fallbacks.demandSignalAnalyst,
  feasibility_architect: config.models.fallbacks.feasibilityArchitect,
  story_verifier: config.models.fallbacks.storyVerifier,
  timeline_reconstructor: config.models.fallbacks.timelineReconstructor,
  data_analysis_specialist: config.models.fallbacks.dataAnalysisSpecialist,
  quantitative_quality_auditor: config.models.fallbacks.quantitativeQualityAuditor,
} satisfies Record<ReasoningModelRole, string | undefined>;

validateReasoningModelPolicy({
  models: reasoningModelsForPolicy,
  fallbacks: reasoningFallbacksForPolicy,
});

validateEnsemblePresetsAgainstAllowlist();
validateV2ModePresetsAgainstAllowlist();

export { config };
export { retentionConfig } from './retention';
export type { RetentionConfig } from './retention';
