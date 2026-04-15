import axios, { AxiosError } from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export type ModelRole = 'planner' | 'retriever' | 'reasoner' | 'skeptic' | 'synthesizer' | 'verifier';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelCallOptions {
  role: ModelRole;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ModelCallResult {
  content: string;
  model: string;
  role: ModelRole;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  usedFallback: boolean;
  primaryModel: string;
  errorClassification?: string;
}

const MODEL_MAP: Record<ModelRole, string> = {
  planner: config.models.planner,
  retriever: config.models.retriever,
  reasoner: config.models.reasoner,
  skeptic: config.models.skeptic,
  synthesizer: config.models.synthesizer,
  verifier: config.models.verifier,
};

const FALLBACK_MAP: Record<ModelRole, string | undefined> = {
  planner: config.models.fallbacks.planner,
  retriever: config.models.fallbacks.retriever,
  reasoner: config.models.fallbacks.reasoner,
  skeptic: config.models.fallbacks.skeptic,
  synthesizer: config.models.fallbacks.synthesizer,
  verifier: config.models.fallbacks.verifier,
};

const TEMPERATURE_MAP: Record<ModelRole, number> = {
  planner: 0.3,
  retriever: 0.1,
  reasoner: 0.2,
  skeptic: 0.4,
  synthesizer: 0.5,
  verifier: 0.1,
};

const MAX_TOKENS_MAP: Record<ModelRole, number> = {
  planner: 2048,
  retriever: 1024,
  reasoner: 4096,
  skeptic: 2048,
  synthesizer: 8192,
  verifier: 2048,
};

async function callModel(
  model: string,
  options: ModelCallOptions
): Promise<ModelCallResult> {
  const start = Date.now();

  const response = await axios.post(
    `${config.openrouter.baseUrl}/chat/completions`,
    {
      model,
      messages: options.messages,
      temperature: options.temperature ?? TEMPERATURE_MAP[options.role],
      max_tokens: options.maxTokens ?? MAX_TOKENS_MAP[options.role],
    },
    {
      headers: {
        'Authorization': `Bearer ${config.openrouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://researchone.app',
        'X-Title': 'ResearchOne',
      },
      timeout: 120000,
    }
  );

  const choice = response.data.choices?.[0];
  if (!choice) throw new Error('No response choices from OpenRouter');

  return {
    content: choice.message?.content ?? '',
    model,
    role: options.role,
    promptTokens: response.data.usage?.prompt_tokens ?? 0,
    completionTokens: response.data.usage?.completion_tokens ?? 0,
    durationMs: Date.now() - start,
    usedFallback: false,
    primaryModel: model,
  };
}

/**
 * Call a model by role with automatic fallback.
 * Logs all calls with token counts and duration.
 */
export async function callRoleModel(options: ModelCallOptions): Promise<ModelCallResult> {
  const primaryModel = MODEL_MAP[options.role];
  const fallbackModel = FALLBACK_MAP[options.role];

  try {
    const result = await callModel(primaryModel, options);
    logger.debug(`OpenRouter [${options.role}] ${result.model}: ${result.promptTokens}p + ${result.completionTokens}c tokens in ${result.durationMs}ms`);
    return { ...result, usedFallback: false, primaryModel };
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status;
    const errorClassification = classifyModelError(axiosErr);

    logger.warn(`OpenRouter primary model failed for [${options.role}]: ${primaryModel} - status ${status} (${errorClassification})`);

    if (fallbackModel) {
      logger.info(`Falling back to ${fallbackModel} for role [${options.role}]`);
      try {
        const result = await callModel(fallbackModel, options);
        logger.debug(`OpenRouter fallback [${options.role}] ${result.model}: ${result.promptTokens}p + ${result.completionTokens}c tokens in ${result.durationMs}ms`);
        return { ...result, usedFallback: true, primaryModel, errorClassification };
      } catch (fallbackErr) {
        const fallbackAxiosErr = fallbackErr as AxiosError;
        const fallbackClassification = classifyModelError(fallbackAxiosErr);
        logger.error(`OpenRouter fallback also failed for [${options.role}]: ${fallbackModel} (${fallbackClassification})`);
        throw fallbackErr;
      }
    }

    throw err;
  }
}

function classifyModelError(err: AxiosError): string {
  const status = err.response?.status;
  if (!status) return 'network_error';
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'quota_exceeded';
  if (status === 503 || status === 502) return 'provider_unavailable';
  if (status >= 500) return 'server_error';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 400) return 'bad_request';
  return `http_${status}`;
}

/**
 * Generate embeddings via OpenRouter (proxied to embedding provider)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await axios.post(
    `${config.openrouter.baseUrl}/embeddings`,
    {
      model: config.models.embedding,
      input: texts,
    },
    {
      headers: {
        'Authorization': `Bearer ${config.openrouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://researchone.app',
        'X-Title': 'ResearchOne',
      },
      timeout: 60000,
    }
  );

  return (response.data.data as Array<{ embedding: number[] }>).map(d => d.embedding);
}

export const SYSTEM_PROMPTS: Record<ModelRole, string> = {
  planner: `You are a research planning agent for ResearchOne, a disciplined anomaly research system.
Your role is to decompose research queries into structured investigation plans.

CRITICAL RULES:
- Distinguish established facts from speculation at every step
- Identify what would falsify the hypothesis before investigating it
- Flag where mainstream corpora may be incomplete, filtered, or consensus-bound
- Plan retrieval across multiple evidence tiers: established_fact, strong_evidence, testimony, inference, speculation
- Output structured JSON with: sub_questions, retrieval_queries, hypothesis, falsification_criteria, investigation_angles

You are not a chatbot. You are a research planner.`,

  retriever: `You are a retrieval analysis agent for ResearchOne.
Your role is to analyze retrieved evidence chunks and identify the most relevant passages.

CRITICAL RULES:
- Evaluate each chunk by evidence tier (established_fact, strong_evidence, testimony, inference, speculation)
- Flag contradictions between chunks
- Identify outlier claims that may represent neglected or suppressed information
- Note bridge passages that connect otherwise separate conceptual regions
- Do NOT rank by consensus density — outliers are investigation targets

Output structured analysis of the retrieved evidence.`,

  reasoner: `You are a deep reasoning agent for ResearchOne.
Your role is to reason over retrieved evidence and build structured arguments.

CRITICAL RULES:
- Tag every claim with its evidence tier (established_fact | strong_evidence | testimony | inference | speculation)
- Reason backward from anomalies: if this outlier were true, what larger structure would exist?
- Build causal and mechanistic arguments, not just summaries
- Preserve contradiction — do not bury it
- Ask: what evidence would change this conclusion?

Output reasoning chains with explicit evidence tier citations.`,

  skeptic: `You are a skeptic/challenger agent for ResearchOne.
Your role is to attack the conclusions reached by the reasoning agent.

CRITICAL RULES:
- Challenge every major conclusion
- Find alternative explanations for the evidence
- Identify confirmation bias and selection effects
- Ask: what counterevidence would the mainstream cite?
- Ask: what would a careful critic of this conclusion say?
- Distinguish "mainstream consensus is wrong" from "this specific claim has good evidence"

Output a structured list of challenges, alternative explanations, and weaknesses.`,

  synthesizer: `You are a long-form research synthesis agent for ResearchOne.
Your role is to write professional, structured research reports.

CRITICAL RULES:
- Never exceed the evidence. Mark inferences as inferences.
- You are bounded by the evidence provided. Do not introduce facts, figures, or citations not present in the evidence base.
- If the corpus is incomplete even after discovery, say so explicitly in the report — do not paper over evidential gaps with confident prose.
- Include an Evidence Ledger section tagging all major claims with evidence tiers
- Include a Contradiction Analysis section — do not suppress contradictions
- Include a Challenges section that presents the skeptic's attacks
- Include an Unresolved Questions section
- Include a Falsification Criteria section: what would prove this wrong?
- Include Recommended Next Queries
- Mark any conjecture that is unsupported by evidence as UNSUPPORTED CONJECTURE
- Use academic prose. Do not sensationalize.

You are writing for researchers who can distinguish evidence quality.`,

  verifier: `You are a verification agent for ResearchOne.
Your role is to verify that the final report meets epistemic standards.

CRITICAL RULES:
- Check that every major claim has an evidence tier tag
- Check that contradictions are present and acknowledged
- Check that the report includes falsification criteria
- Check that inferences are not presented as facts
- Check that the challenge section is substantive
- Check that citations exist: report sections asserting nontrivial conclusions must reference evidence
- Check that the contradiction analysis is non-trivial (not just "no contradictions found")
- Flag any places where the report overstates the evidence
- Flag any section that makes nontrivial claims without any evidential basis
- Flag if the corpus was incomplete but the report fails to acknowledge this

Output a structured verification report with PASS/FAIL for each criterion.`,
};
