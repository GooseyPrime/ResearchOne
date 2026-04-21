/**
 * Default reasoning model slugs (OpenRouter / HF repo ids).
 * Single source of truth for `config.models` when env vars are unset.
 * Secrets stay in env; model IDs live in code.
 */
export const CODE_DEFAULT_REASONING_MODELS = {
  planner: 'moonshotai/kimi-k2-thinking',
  retriever: 'deepseek/deepseek-v3.2',
  reasoner: 'deepseek/deepseek-r1',
  skeptic: 'moonshotai/kimi-k2-thinking',
  synthesizer: 'anthropic/claude-sonnet-4.5',
  verifier: 'anthropic/claude-sonnet-4',
  plainLanguageSynthesizer: 'anthropic/claude-3.5-haiku',
  outlineArchitect: 'moonshotai/kimi-k2-thinking',
  sectionDrafter: 'google/gemini-2.5-pro',
  internalChallenger: 'moonshotai/kimi-k2-thinking',
  coherenceRefiner: 'anthropic/claude-sonnet-4.5',
  revisionIntake: 'openai/gpt-5-mini',
  reportLocator: 'openai/gpt-5-mini',
  changePlanner: 'moonshotai/kimi-k2-thinking',
  sectionRewriter: 'google/gemini-2.5-pro',
  citationIntegrityChecker: 'mistralai/mistral-small-3.2-24b-instruct',
  finalRevisionVerifier: 'anthropic/claude-sonnet-4',
  embedding: 'openai/text-embedding-3-small',
} as const;

export const CODE_DEFAULT_REASONING_FALLBACKS = {
  planner: 'deepseek/deepseek-r1',
  retriever: 'google/gemini-2.5-flash',
  reasoner: 'moonshotai/kimi-k2-thinking',
  skeptic: 'anthropic/claude-sonnet-4',
  synthesizer: 'google/gemini-2.5-pro',
  verifier: 'openai/o3-mini',
  plainLanguageSynthesizer: 'google/gemini-2.5-flash',
  outlineArchitect: 'deepseek/deepseek-r1',
  sectionDrafter: 'anthropic/claude-sonnet-4',
  internalChallenger: 'anthropic/claude-sonnet-4',
  coherenceRefiner: 'google/gemini-2.5-pro',
  revisionIntake: 'qwen/qwen3-235b-a22b',
  reportLocator: 'qwen/qwen3-235b-a22b',
  changePlanner: 'deepseek/deepseek-r1',
  sectionRewriter: 'anthropic/claude-sonnet-4',
  citationIntegrityChecker: 'meta-llama/llama-3.3-70b-instruct',
  finalRevisionVerifier: 'openai/o3-mini',
} as const;
