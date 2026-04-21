import path from 'path';
import { loadEnv, getRepoRoot } from '../bootstrap/loadEnv';
import {
  validateReasoningModelPolicy,
  type ReasoningModelRole,
} from '../services/reasoning/reasoningModelPolicy';
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
  },

  /** Hugging Face Inference API token (Research One 2 red-team models). Optional unless V2 HF routes run. */
  hfToken: process.env.HF_TOKEN || '',

  // OpenRouter slugs — tiered defaults (override any role via PLANNER_MODEL, etc.).
  models: {
    planner: process.env.PLANNER_MODEL || 'moonshotai/kimi-k2-thinking',
    retriever: process.env.RETRIEVER_MODEL || 'deepseek/deepseek-v3.2',
    reasoner: process.env.REASONER_MODEL || 'deepseek/deepseek-r1',
    skeptic: process.env.SKEPTIC_MODEL || 'moonshotai/kimi-k2-thinking',
    synthesizer: process.env.SYNTHESIZER_MODEL || 'anthropic/claude-sonnet-4.5',
    verifier: process.env.VERIFIER_MODEL || 'anthropic/claude-sonnet-4',
    plainLanguageSynthesizer:
      process.env.PLAIN_LANGUAGE_SYNTHESIZER_MODEL || 'anthropic/claude-3.5-haiku',
    outlineArchitect: process.env.OUTLINE_ARCHITECT_MODEL || 'moonshotai/kimi-k2-thinking',
    sectionDrafter: process.env.SECTION_DRAFTER_MODEL || 'google/gemini-2.5-pro',
    internalChallenger: process.env.INTERNAL_CHALLENGER_MODEL || 'moonshotai/kimi-k2-thinking',
    coherenceRefiner: process.env.COHERENCE_REFINER_MODEL || 'anthropic/claude-sonnet-4.5',
    revisionIntake: process.env.REVISION_INTAKE_MODEL || 'openai/gpt-5-mini',
    reportLocator: process.env.REPORT_LOCATOR_MODEL || 'openai/gpt-5-mini',
    changePlanner: process.env.CHANGE_PLANNER_MODEL || 'moonshotai/kimi-k2-thinking',
    sectionRewriter: process.env.SECTION_REWRITER_MODEL || 'google/gemini-2.5-pro',
    citationIntegrityChecker:
      process.env.CITATION_INTEGRITY_CHECKER_MODEL || 'mistralai/mistral-small-3.2-24b-instruct',
    finalRevisionVerifier: process.env.FINAL_REVISION_VERIFIER_MODEL || 'anthropic/claude-sonnet-4',
    embedding: process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small',

    fallbacks: {
      planner: process.env.PLANNER_FALLBACK || 'deepseek/deepseek-r1',
      retriever: process.env.RETRIEVER_FALLBACK || 'google/gemini-2.5-flash',
      reasoner: process.env.REASONER_FALLBACK || 'moonshotai/kimi-k2-thinking',
      skeptic: process.env.SKEPTIC_FALLBACK || 'anthropic/claude-sonnet-4',
      synthesizer: process.env.SYNTHESIZER_FALLBACK || 'google/gemini-2.5-pro',
      verifier: process.env.VERIFIER_FALLBACK || 'openai/o3-mini',
      plainLanguageSynthesizer:
        process.env.PLAIN_LANGUAGE_SYNTHESIZER_FALLBACK || 'google/gemini-2.5-flash',
      outlineArchitect: process.env.OUTLINE_ARCHITECT_FALLBACK || 'deepseek/deepseek-r1',
      sectionDrafter: process.env.SECTION_DRAFTER_FALLBACK || 'anthropic/claude-sonnet-4',
      internalChallenger: process.env.INTERNAL_CHALLENGER_FALLBACK || 'anthropic/claude-sonnet-4',
      coherenceRefiner: process.env.COHERENCE_REFINER_FALLBACK || 'google/gemini-2.5-pro',
      revisionIntake: process.env.REVISION_INTAKE_FALLBACK || 'qwen/qwen3-235b-a22b',
      reportLocator: process.env.REPORT_LOCATOR_FALLBACK || 'qwen/qwen3-235b-a22b',
      changePlanner: process.env.CHANGE_PLANNER_FALLBACK || 'deepseek/deepseek-r1',
      sectionRewriter: process.env.SECTION_REWRITER_FALLBACK || 'anthropic/claude-sonnet-4',
      citationIntegrityChecker:
        process.env.CITATION_INTEGRITY_CHECKER_FALLBACK || 'meta-llama/llama-3.3-70b-instruct',
      finalRevisionVerifier: process.env.FINAL_REVISION_VERIFIER_FALLBACK || 'openai/o3-mini',
    },
  },

  embedding: {
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '100', 10),
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

export { config };
