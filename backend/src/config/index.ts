export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),

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

  models: {
    planner: process.env.PLANNER_MODEL || 'deepseek/deepseek-r1',
    retriever: process.env.RETRIEVER_MODEL || 'deepseek/deepseek-r1',
    reasoner: process.env.REASONER_MODEL || 'deepseek/deepseek-r1',
    skeptic: process.env.SKEPTIC_MODEL || 'deepseek/deepseek-r1',
    synthesizer: process.env.SYNTHESIZER_MODEL || 'qwen/qwen-2.5-72b-instruct',
    verifier: process.env.VERIFIER_MODEL || 'deepseek/deepseek-r1',
    embedding: process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small',

    fallbacks: {
      planner: process.env.PLANNER_FALLBACK || 'anthropic/claude-3.5-sonnet',
      retriever: process.env.RETRIEVER_FALLBACK || 'anthropic/claude-3.5-sonnet',
      reasoner: process.env.REASONER_FALLBACK || 'anthropic/claude-3.5-sonnet',
      skeptic: process.env.SKEPTIC_FALLBACK || 'anthropic/claude-3.5-sonnet',
      synthesizer: process.env.SYNTHESIZER_FALLBACK || 'qwen/qwen-2.5-72b-instruct',
      verifier: process.env.VERIFIER_FALLBACK || 'anthropic/claude-3.5-sonnet',
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
    provider: process.env.SEARCH_PROVIDER || 'generic',
    providerApiKey: process.env.SEARCH_PROVIDER_API_KEY || '',
    providerBaseUrl: process.env.SEARCH_PROVIDER_BASE_URL || '',
    maxResults: parseInt(process.env.MAX_EXTERNAL_DISCOVERY_RESULTS || '25', 10),
    maxIngestPerRun: parseInt(process.env.MAX_EXTERNAL_INGEST_PER_RUN || '10', 10),
    maxQueriesPerRun: parseInt(process.env.MAX_DISCOVERY_QUERIES_PER_RUN || '5', 10),
    ingestionWaitTimeoutMs: parseInt(process.env.DISCOVERY_INGEST_TIMEOUT_MS || '90000', 10),
  },

  exports: {
    dir: process.env.EXPORTS_DIR || '/opt/researchone/exports',
  },

  admin: {
    token: process.env.ADMIN_RUNTIME_TOKEN || '',
    restartCommand: process.env.RUNTIME_RESTART_COMMAND || 'pm2 restart ecosystem.config.js',
  },

  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production environment');
    }
    return secret || 'dev-secret-change-in-production';
  })(),
};

if (config.nodeEnv === 'production' && !config.openrouter.apiKey.trim()) {
  throw new Error('OPENROUTER_API_KEY must be set in production environment');
}
