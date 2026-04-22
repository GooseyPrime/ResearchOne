import axios, { AxiosError } from 'axios';
import { InferenceClient } from '@huggingface/inference';
import { config } from '../../config';
import { REASONING_FIRST_PREAMBLE, withPreamble } from '../../constants/prompts';
import { logger } from '../../utils/logger';
import type { ReasoningModelRole } from '../reasoning/reasoningModelPolicy';
import { mergePresetWithRuntimeOverride, resolveReasoningModels } from '../../config/researchEnsemblePresets';
import {
  RED_TEAM_V2_SYSTEM_PREFIX,
  isHfRepoModel,
  type ModelCallPurpose,
  type ResearchObjective,
} from '../reasoning/reasoningModelPolicy';
import { effectiveEmbedding, effectiveFallback, effectivePrimary } from '../runtimeModelStore';

export { REASONING_FIRST_PREAMBLE, withPreamble };

/** Same 16 agent roles as `ReasoningModelRole` / spec — alias only, do not diverge. */
export type ModelRole = ReasoningModelRole;

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
  /** Research One 2 — when `'v2'`, `resolveReasoningModels` may override models. */
  engineVersion?: string | null;
  researchObjective?: ResearchObjective | null;
  callPurpose?: ModelCallPurpose;
  /** Optional tools for HF / OpenAI-compatible chat (forwarded when set). */
  tools?: unknown;
  runtimeOverrides?: {
    primary?: string;
    fallback?: string;
  };
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

export type ModelErrorClassification =
  | 'auth_error'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'bad_request'
  | 'network_error'
  | 'unknown';

export interface NormalizedModelErrorShape {
  classification: ModelErrorClassification;
  status?: number;
  providerMessage?: string;
  model: string;
  fallbackTried: boolean;
  role: ModelRole;
}

export class NormalizedModelError extends Error implements NormalizedModelErrorShape {
  classification: ModelErrorClassification;
  status?: number;
  providerMessage?: string;
  model: string;
  fallbackTried: boolean;
  role: ModelRole;

  constructor(payload: NormalizedModelErrorShape) {
    super(payload.providerMessage || `Model call failed (${payload.classification})`);
    this.name = 'NormalizedModelError';
    this.classification = payload.classification;
    this.status = payload.status;
    this.providerMessage = payload.providerMessage;
    this.model = payload.model;
    this.fallbackTried = payload.fallbackTried;
    this.role = payload.role;
  }
}

const ENV_PRIMARY: Record<ModelRole, string> = {
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
};

const ENV_FALLBACK: Record<ModelRole, string | undefined> = {
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
};

function primaryForRole(role: ModelRole, runtimePrimary?: string): string {
  if (runtimePrimary && runtimePrimary.trim()) return runtimePrimary.trim();
  return effectivePrimary(role, ENV_PRIMARY[role]);
}

function fallbackForRole(role: ModelRole, runtimeFallback?: string): string | undefined {
  if (runtimeFallback && runtimeFallback.trim()) return runtimeFallback.trim();
  const env = ENV_FALLBACK[role];
  if (!env) return undefined;
  return effectiveFallback(role, env);
}

const TEMPERATURE_MAP: Record<ModelRole, number> = {
  planner: 0.3,
  retriever: 0.1,
  reasoner: 0.2,
  skeptic: 0.4,
  synthesizer: 0.5,
  verifier: 0.1,
  plain_language_synthesizer: 0.35,
  outline_architect: 0.25,
  section_drafter: 0.35,
  internal_challenger: 0.3,
  coherence_refiner: 0.2,
  revision_intake: 0.2,
  report_locator: 0.2,
  change_planner: 0.2,
  section_rewriter: 0.3,
  citation_integrity_checker: 0.15,
  final_revision_verifier: 0.1,
};

const MAX_TOKENS_MAP: Record<ModelRole, number> = {
  planner: 2048,
  retriever: 1024,
  reasoner: 4096,
  skeptic: 2048,
  synthesizer: 8192,
  verifier: 2048,
  plain_language_synthesizer: 8192,
  outline_architect: 2048,
  section_drafter: 4096,
  internal_challenger: 2048,
  coherence_refiner: 6144,
  revision_intake: 1536,
  report_locator: 2048,
  change_planner: 3072,
  section_rewriter: 4096,
  citation_integrity_checker: 2048,
  final_revision_verifier: 3072,
};

let hfClient: InferenceClient | null = null;
function getHfClient(): InferenceClient | null {
  const token = config.hfToken?.trim();
  if (!token) return null;
  if (!hfClient) hfClient = new InferenceClient(token);
  return hfClient;
}

function applyV2SystemAugmentations(options: ModelCallOptions): ChatMessage[] {
  let msgs = options.messages;
  if (options.engineVersion?.trim() !== 'v2') return msgs;

  if (
    (options.role === 'skeptic' || options.role === 'internal_challenger') &&
    options.callPurpose !== 'contradiction_extraction'
  ) {
    const idx = msgs.findIndex((m) => m.role === 'system');
    if (idx >= 0) {
      msgs = msgs.map((msg, i) =>
        i === idx ? { ...msg, content: `${RED_TEAM_V2_SYSTEM_PREFIX}${msg.content}` } : msg
      );
    }
  }
  return msgs;
}

function resolveModelsForCall(options: ModelCallOptions): { primary: string; fallback: string | undefined } {
  const v2 = resolveReasoningModels({
    engineVersion: options.engineVersion,
    researchObjective: options.researchObjective ?? undefined,
    role: options.role,
    callPurpose: options.callPurpose,
  });
  if (v2) {
    return mergePresetWithRuntimeOverride(v2, options.runtimeOverrides);
  }
  return {
    primary: primaryForRole(options.role, options.runtimeOverrides?.primary),
    fallback: fallbackForRole(options.role, options.runtimeOverrides?.fallback),
  };
}

async function callHfChat(model: string, options: ModelCallOptions): Promise<ModelCallResult> {
  const client = getHfClient();
  if (!client) {
    logger.error('HF model selected but HF_TOKEN is not set', { role: options.role, model });
    throw new Error('Hugging Face token (HF_TOKEN) is required for this model');
  }

  const start = Date.now();
  const messages = applyV2SystemAugmentations(options).map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  }));

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? TEMPERATURE_MAP[options.role],
    max_tokens: options.maxTokens ?? MAX_TOKENS_MAP[options.role],
  };
  if (options.tools) payload.tools = options.tools;

  const hf = client as unknown as {
    chatCompletion: (args: Record<string, unknown>) => Promise<{
      choices?: Array<{ message?: { content?: string | unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>;
  };
  const out = await hf.chatCompletion(payload);
  const choice = out.choices?.[0];
  const rawContent = choice?.message?.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent
            .map((c: unknown) =>
              c && typeof c === 'object' && 'text' in c && typeof (c as { text?: string }).text === 'string'
                ? (c as { text: string }).text
                : ''
            )
            .join('')
        : '';

  const usage = out.usage;

  return {
    content,
    model,
    role: options.role,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    durationMs: Date.now() - start,
    usedFallback: false,
    primaryModel: model,
  };
}

async function callOpenRouter(model: string, options: ModelCallOptions): Promise<ModelCallResult> {
  const start = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages: applyV2SystemAugmentations(options),
    temperature: options.temperature ?? TEMPERATURE_MAP[options.role],
    max_tokens: options.maxTokens ?? MAX_TOKENS_MAP[options.role],
  };
  if (options.tools) body.tools = options.tools;

  const response = await axios.post(`${config.openrouter.baseUrl}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${config.openrouter.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://researchone.app',
      'X-Title': 'ResearchOne',
    },
    timeout: 120000,
  });

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
 * Hugging Face hub repos: prefer Inference API when HF_TOKEN is set (avoids OpenRouter HF-proxy failures).
 * Otherwise use OpenRouter with `huggingface/<repo>` slug, then raw repo id.
 */
async function callHfRepoOrOpenRouter(model: string, options: ModelCallOptions): Promise<ModelCallResult> {
  const hfClient = getHfClient();
  if (hfClient) {
    try {
      return await callHfChat(model, options);
    } catch (err) {
      logger.warn(`Hugging Face Inference failed for ${model}, trying OpenRouter`, {
        role: options.role,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.warn(`HF repo model ${model} but HF_TOKEN is unset — using OpenRouter only`, {
      role: options.role,
    });
  }

  const huggingfaceSlug = model.startsWith('huggingface/') ? model : `huggingface/${model}`;
  try {
    return await callOpenRouter(huggingfaceSlug, options);
  } catch (err) {
    if (huggingfaceSlug !== model) {
      logger.warn(`OpenRouter huggingface slug failed for ${model}, retrying raw id`, {
        role: options.role,
      });
      return await callOpenRouter(model, options);
    }
    throw err;
  }
}

async function callModel(model: string, options: ModelCallOptions): Promise<ModelCallResult> {
  if (isHfRepoModel(model)) {
    return callHfRepoOrOpenRouter(model, options);
  }
  return callOpenRouter(model, options);
}

/**
 * Call a model by role with automatic fallback.
 * Logs all calls with token counts and duration.
 */
export async function callRoleModel(options: ModelCallOptions): Promise<ModelCallResult> {
  const { primary: primaryModel, fallback: resolvedFallback } = resolveModelsForCall(options);
  const fallbackModel = resolvedFallback;

  try {
    const result = await callModel(primaryModel, options);
    const backend = isHfRepoModel(result.model) ? 'HF' : 'OpenRouter';
    logger.debug(`${backend} [${options.role}] ${result.model}: ${result.promptTokens}p + ${result.completionTokens}c tokens in ${result.durationMs}ms`);
    return { ...result, usedFallback: false, primaryModel };
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status;
    const errorClassification = axios.isAxiosError(err)
      ? classifyModelError(axiosErr)
      : classifyHfError(err);
    const providerBody = axiosErr.response?.data;

    logger.warn(`Model primary failed for [${options.role}]`, {
      role: options.role,
      model: primaryModel,
      status,
      classification: errorClassification,
      fallbackAttempted: Boolean(fallbackModel),
      providerBody,
    });

    if (fallbackModel && fallbackModel !== primaryModel) {
      logger.info(`Falling back to ${fallbackModel} for role [${options.role}]`);
      try {
        const result = await callModel(fallbackModel, options);
        const backend = isHfRepoModel(result.model) ? 'HF' : 'OpenRouter';
        logger.debug(`${backend} fallback [${options.role}] ${result.model}: ${result.promptTokens}p + ${result.completionTokens}c tokens in ${result.durationMs}ms`);
        return { ...result, usedFallback: true, primaryModel, errorClassification };
      } catch (fallbackErr) {
        const fallbackAxiosErr = fallbackErr as AxiosError;
        const fallbackClassification = axios.isAxiosError(fallbackErr)
          ? classifyModelError(fallbackAxiosErr)
          : classifyHfError(fallbackErr);
        const fallbackBody = fallbackAxiosErr.response?.data;
        logger.error(`Model fallback also failed for [${options.role}]`, {
          role: options.role,
          model: fallbackModel,
          status: fallbackAxiosErr.response?.status,
          classification: fallbackClassification,
          fallbackAttempted: true,
          providerBody: fallbackBody,
        });
        throw new NormalizedModelError({
          classification: fallbackClassification,
          status: fallbackAxiosErr.response?.status,
          providerMessage: axios.isAxiosError(fallbackErr)
            ? extractProviderMessage(fallbackAxiosErr)
            : fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr),
          model: fallbackModel,
          fallbackTried: true,
          role: options.role,
        });
      }
    }

    throw new NormalizedModelError({
      classification: errorClassification,
      status,
      providerMessage: axios.isAxiosError(err)
        ? extractProviderMessage(axiosErr)
        : err instanceof Error
          ? err.message
          : String(err),
      model: primaryModel,
      fallbackTried: false,
      role: options.role,
    });
  }
}

function classifyHfError(err: unknown): ModelErrorClassification {
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes('token') && m.includes('hf')) return 'auth_error';
    if (m.includes('rate') || m.includes('429')) return 'rate_limited';
    if (m.includes('timeout') || m.includes('econnrefused')) return 'network_error';
  }
  return 'provider_unavailable';
}

function classifyModelError(err: AxiosError): ModelErrorClassification {
  const status = err.response?.status;
  if (!status) return 'network_error';
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'quota_exceeded';
  if (status === 503 || status === 502) return 'provider_unavailable';
  if (status >= 500) return 'provider_unavailable';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 400) return 'bad_request';
  return 'unknown';
}

function extractProviderMessage(err: AxiosError): string {
  const data = err.response?.data as unknown;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const maybe = data as { error?: { message?: string }; message?: string };
    return maybe.error?.message || maybe.message || JSON.stringify(data);
  }
  return err.message;
}

/**
 * Generate embeddings via OpenRouter (proxied to embedding provider)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await axios.post(
    `${config.openrouter.baseUrl}/embeddings`,
    {
      model: effectiveEmbedding(config.models.embedding),
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
  planner: withPreamble(`You are a research planning agent for ResearchOne, a disciplined anomaly research system.
Your role is to decompose research queries into structured investigation plans.

CRITICAL RULES:
- Distinguish established facts from speculation at every step
- Identify what would falsify the hypothesis before investigating it
- Flag where mainstream corpora may be incomplete, filtered, or consensus-bound
- Plan retrieval across multiple evidence tiers: established_fact, strong_evidence, testimony, inference, speculation
- Output structured JSON with: sub_questions, retrieval_queries, hypothesis, falsification_criteria, investigation_angles

You are not a chatbot. You are a research planner.`),

  retriever: withPreamble(`You are a retrieval analysis agent for ResearchOne.
Your role is to analyze retrieved evidence chunks and identify the most relevant passages.

CRITICAL RULES:
- Evaluate each chunk by evidence tier (established_fact, strong_evidence, testimony, inference, speculation)
- Flag contradictions between chunks
- Identify outlier claims that may represent neglected or suppressed information
- Note bridge passages that connect otherwise separate conceptual regions
- Do NOT rank by consensus density — outliers are investigation targets

Output structured analysis of the retrieved evidence.`),

  reasoner: withPreamble(`You are a deep reasoning agent for ResearchOne.
Your role is to reason over retrieved evidence and build structured arguments.

CRITICAL RULES:
- Tag every claim with its evidence tier (established_fact | strong_evidence | testimony | inference | speculation)
- Reason backward from anomalies: if this outlier were true, what larger structure would exist?
- Build causal and mechanistic arguments, not just summaries
- Preserve contradiction — do not bury it
- Ask: what evidence would change this conclusion?

Output reasoning chains with explicit evidence tier citations.`),

  skeptic: withPreamble(`You are a skeptic/challenger agent for ResearchOne.
Your role is to attack the conclusions reached by the reasoning agent.

CRITICAL RULES:
- Challenge every major conclusion
- Find alternative explanations for the evidence
- Identify confirmation bias and selection effects
- Ask: what counterevidence would the mainstream cite?
- Ask: what would a careful critic of this conclusion say?
- Distinguish "mainstream consensus is wrong" from "this specific claim has good evidence"

Output a structured list of challenges, alternative explanations, and weaknesses.`),

  synthesizer: withPreamble(`You are a long-form research synthesis agent for ResearchOne.
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

You are writing for researchers who can distinguish evidence quality.`),

  verifier: withPreamble(`You are a verification agent for ResearchOne.
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

Output a structured verification report with PASS/FAIL for each criterion.`),

  plain_language_synthesizer: withPreamble(`You are a plain-language explainer for ResearchOne.
Rewrite the full research report so a general audience can follow it.

CRITICAL RULES:
- Use common vocabulary and short sentences (roughly middle-school reading level when possible).
- Remove or replace technical and argumentative jargon with plain explanations; define unavoidable terms briefly.
- Preserve the report's factual claims, uncertainty, and contradictions — do not simplify away important caveats.
- Do not add new facts, sources, or conclusions that are not supported by the original text.
- Keep a clear structure with markdown headings that mirror the original sections where helpful.
- Tone: calm, direct, and respectful — not condescending.

Output the complete plain-language report in markdown only.`),

  outline_architect: withPreamble(`You are the Outline Architect.
Produce a structured report outline and section order for the current query and evidence context.
Output strict JSON: { "outline": [{"title": "...", "key": "...", "objective": "..."}] }`),

  section_drafter: withPreamble(`You are the Section Drafter.
Draft one section only from the provided plan and evidence context.
Do not invent evidence. Clearly distinguish evidence, inference, and speculation.`),

  internal_challenger: withPreamble(`You are the Internal Challenger.
Challenge weak links, hidden assumptions, and brittle conclusions in a draft section set.
Output concise actionable critiques only.`),

  coherence_refiner: withPreamble(`You are the Coherence Refiner.
Refine report text for internal consistency across summary, body, contradictions, conclusions, and falsification criteria.
Do not add new unsupported facts.`),

  revision_intake: withPreamble(`You are the Revision Intake Agent.
Classify the revision request and normalize it to structured JSON.
Output strict JSON with fields:
request_type, global_or_local, intent, rationale, target_terms, insertion_requests, rewrite_requests, removal_requests, replacement_requests.`),

  report_locator: withPreamble(`You are the Report Locator / Impact Mapper.
Given report structure, citations, claims, contradictions, and revision intent, identify all likely affected sections.
Output strict JSON with fields:
affected_sections, global_impact, summary_body_conclusion_impact, citation_impact_notes, contradiction_impact_notes.`),

  change_planner: withPreamble(`You are the Change Planner.
Create a structured change plan before rewriting.
Output strict JSON with fields:
request_type, global_or_local, affected_sections, required_insertions, required_rewrites, citation_impact, consistency_checks.`),

  section_rewriter: withPreamble(`You are the Section Rewriter.
Rewrite only the requested section while preserving report integrity and epistemic distinctions.
Return section body text only.`),

  citation_integrity_checker: withPreamble(`You are the Citation Integrity Checker.
Assess whether revised text still aligns with section citations and identify citation updates needed.
Output strict JSON with fields:
status, issues, required_citation_updates.`),

  final_revision_verifier: withPreamble(`You are the Final Revision Verifier.
Verify revised report consistency across executive summary, body, conclusions, evidence ledger, contradictions, and falsification criteria.
Output strict JSON with fields:
passed, findings, required_fixes.`),
};
