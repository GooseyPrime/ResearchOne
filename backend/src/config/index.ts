import path from 'path';
import { loadEnv, getRepoRoot } from '../bootstrap/loadEnv';
import {
  validateReasoningModelPolicy,
  type ReasoningModelRole,
} from '../services/reasoning/reasoningModelPolicy';
import { validateEnsemblePresetsAgainstAllowlist } from './researchEnsemblePresets';
import { CODE_DEFAULT_REASONING_FALLBACKS, CODE_DEFAULT_REASONING_MODELS } from './defaultModels';
import { parseCorsOrigins } from './corsOrigins';

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
  nodeEnv: rawNodeEnv,
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS, 'http://localhost:5173'),

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

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    successUrl: process.env.STRIPE_CHECKOUT_SUCCESS_URL || 'http://localhost:5173/app/billing?checkout=success',
    cancelUrl: process.env.STRIPE_CHECKOUT_CANCEL_URL || 'http://localhost:5173/app/billing?checkout=cancel',
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
    },
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
    reasoner: process.env.REASONER_MODEL || CODE_DEFAULT_REASONING_MODELS.reasoner,
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
    finalRevisionVerifier: process.env.FINAL_REVISION_VERIFIER_MODEL || CODE_DEFAULT_REASONING_MODELS.finalRevisionVerifier,
    embedding: process.env.EMBEDDING_MODEL || CODE_DEFAULT_REASONING_MODELS.embedding,

    fallbacks: {
      planner: process.env.PLANNER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.planner,
      retriever: process.env.RETRIEVER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.retriever,
      reasoner: process.env.REASONER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.reasoner,
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
      finalRevisionVerifier: process.env.FINAL_REVISION_VERIFIER_FALLBACK || CODE_DEFAULT_REASONING_FALLBACKS.finalRevisionVerifier,
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
  },

  exports: {
    dir: process.env.EXPORTS_DIR || '/opt/researchone/exports',
    atlasBackupDir: process.env.ATLAS_BACKUP_DIR || '',
    autoExportOnEmbedding: process.env.ATLAS_AUTO_EXPORT_ON_EMBEDDING === 'true',
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
    owner: process.env.FEATURED_REPORT_GITHUB_OWNER || 'GooseyPrime',
    repo: process.env.FEATURED_REPORT_GITHUB_REPO || 'newontology',
    path: process.env.FEATURED_REPORT_GITHUB_PATH || 'content/featured-reports/latest.md',
    branch: process.env.FEATURED_REPORT_GITHUB_BRANCH || 'main',
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

const reasoningModelsForPolicy = {
  planner: config.models.planner,
  retriever: config.models.retriever,
  reasoner: config.models.reasoner,
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
  final_revision_verifier: config.models.finalRevisionVerifier,
} satisfies Record<ReasoningModelRole, string | undefined>;

const reasoningFallbacksForPolicy = {
  planner: config.models.fallbacks.planner,
  retriever: config.models.fallbacks.retriever,
  reasoner: config.models.fallbacks.reasoner,
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
  final_revision_verifier: config.models.fallbacks.finalRevisionVerifier,
} satisfies Record<ReasoningModelRole, string | undefined>;

validateReasoningModelPolicy({
  models: reasoningModelsForPolicy,
  fallbacks: reasoningFallbacksForPolicy,
});

validateEnsemblePresetsAgainstAllowlist();

export { config };
