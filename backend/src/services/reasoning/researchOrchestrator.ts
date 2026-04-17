import { query, withTransaction } from '../../db/pool';
import axios, { AxiosError } from 'axios';
import {
  callRoleModel,
  SYSTEM_PROMPTS,
  ModelCallResult,
  NormalizedModelError,
} from '../openrouter/openrouterService';
import { retrieveChunks, RetrievedChunk } from '../retrieval/retrievalService';
import { runDiscoveryOrchestrator } from '../discovery/discoveryOrchestrator';
import { extractAndPersistClaims } from './claimExtractor';
import { extractAndPersistContradictions } from './contradictionExtractor';
import { mapAndPersistCitations } from './citationMapper';
import { logger } from '../../utils/logger';
import { saveRunCheckpoint } from './checkpointService';
import { generateIterativeReport } from './reportGenerator';
import { config } from '../../config';

export interface ResearchJobData {
  runId: string;
  query: string;
  supplemental?: string;
  filterTags?: string[];
}

export interface ResearchProgress {
  stage: string;
  percent: number;
  message: string;
  runId: string;
  detail?: string;
  substep?: string;
  timestamp: string;
  model?: string;
  tokenUsage?: { prompt: number; completion: number };
  sourceCount?: number;
  chunkCount?: number;
}

type ProgressCallback = (update: ResearchProgress) => void;

interface ResearchPlan {
  sub_questions: string[];
  retrieval_queries: string[];
  hypothesis: string;
  falsification_criteria: string[];
  investigation_angles: string[];
}

interface VerificationResult {
  passed: boolean;
  criteria: Array<{ criterion: string; status: 'PASS' | 'FAIL'; note: string }>;
  overall: string;
}

interface ResearchFailureDetails {
  errorMessage: string;
  failureMeta: Record<string, unknown>;
  retryable: boolean;
}
const RETRIEVAL_PROGRESS_BASE = 22;
const RETRIEVAL_PROGRESS_CAP = 34;

export async function runResearchJob(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<{ runId: string; reportId: string }> {
  const { runId, query: researchQuery, supplemental, filterTags } = data;
  const modelLog: ModelCallResult[] = [];
  let currentStage = 'queued';
  let currentPercent = 0;
  let currentMessage = 'Queued';

  const progress = (
    stage: string,
    percent: number,
    message: string,
    extra?: Omit<ResearchProgress, 'stage' | 'percent' | 'message' | 'runId' | 'timestamp'>
  ) => {
    currentStage = stage;
    currentPercent = percent;
    currentMessage = message;
    onProgress({ stage, percent, message, runId, timestamp: new Date().toISOString(), ...extra });
    logger.info(`[${runId}] ${stage}: ${message}`);
  };

  // Mark run as running
  await query(
    `UPDATE research_runs SET status='running', started_at=NOW() WHERE id=$1`,
    [runId]
  );

  try {
    // ────────────────────────────────────────────────────────────────
    // STAGE 1: PLANNER — decompose the research query
    // ────────────────────────────────────────────────────────────────
    progress('planning', 5, 'Decomposing research query with planner...', { substep: 'request_started' });

    const plannerResult = await callRoleModel({
      role: 'planner',
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.planner },
        {
          role: 'user',
          content: `Research Query: ${researchQuery}\n\n${supplemental ? `Supplemental Context:\n${supplemental}\n\n` : ''}Produce a structured JSON research plan.`,
        },
      ],
    });
    modelLog.push(plannerResult);
    progress('planning', 8, 'Planner response parsed', {
      substep: 'response_parsed',
      model: plannerResult.model,
      tokenUsage: { prompt: plannerResult.promptTokens, completion: plannerResult.completionTokens },
    });

    let plan: ResearchPlan;
    try {
      const jsonMatch = plannerResult.content.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch?.[0] ?? plannerResult.content) as ResearchPlan;
    } catch {
      plan = {
        sub_questions: [researchQuery],
        retrieval_queries: [researchQuery],
        hypothesis: researchQuery,
        falsification_criteria: ['Counterevidence would disprove this'],
        investigation_angles: ['Main investigation'],
      };
    }

    await query(
      `UPDATE research_runs SET plan=$1 WHERE id=$2`,
      [JSON.stringify(plan), runId]
    );
    await saveRunCheckpoint({
      runId,
      stage: 'planning',
      checkpointKey: 'plan',
      snapshot: { plan },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 2: DISCOVERY — autonomous external research if needed
    // ────────────────────────────────────────────────────────────────
    progress('discovery', 15, 'Running autonomous external discovery...', { substep: 'queries_generating' });

    const discoverySummary = await runDiscoveryOrchestrator({
      runId,
      researchQuery,
      plan: plan as unknown as Record<string, unknown>,
      filterTags,
    });

    await query(
      `UPDATE research_runs SET discovery_summary=$1 WHERE id=$2`,
      [JSON.stringify(discoverySummary), runId]
    );
    await saveRunCheckpoint({
      runId,
      stage: 'discovery',
      checkpointKey: 'discovery_summary',
      snapshot: { discoverySummary },
    });

    logger.info(`[${runId}] Discovery: ingested=${discoverySummary.sourcesIngested}, skipped=${discoverySummary.sourcesSkipped}`);

    // ────────────────────────────────────────────────────────────────
    // STAGE 3: RETRIEVAL — gather evidence (now includes discovery sources)
    // ────────────────────────────────────────────────────────────────
    progress('retrieval', 20, 'Retrieving evidence from corpus...', { substep: 'retrieval_started' });

    const allChunks: RetrievedChunk[] = [];
    const seenIds = new Set<string>();

    for (const rq of plan.retrieval_queries.slice(0, 5)) {
      const chunks = await retrieveChunks({
        query: rq,
        topK: 15,
        filterTags,
        hybridSearch: true,
      });
      for (const c of chunks) {
        if (!seenIds.has(c.id)) {
          seenIds.add(c.id);
          allChunks.push(c);
        }
      }
      progress('retrieval', Math.min(RETRIEVAL_PROGRESS_CAP, RETRIEVAL_PROGRESS_BASE + allChunks.length), `Retrieval query complete: ${rq}`, {
        substep: 'query_done',
        chunkCount: allChunks.length,
      });
    }

    logger.info(`[${runId}] Retrieved ${allChunks.length} unique chunks`);
    const retrievalIds = allChunks.map(c => c.id);

    await query(
      `UPDATE research_runs SET retrieval_ids=$1 WHERE id=$2`,
      [retrievalIds, runId]
    );
    await saveRunCheckpoint({
      runId,
      stage: 'retrieval',
      checkpointKey: 'retrieval_ids',
      snapshot: { retrievalIds, chunkCount: allChunks.length },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 4: RETRIEVER ANALYSIS — evaluate evidence quality
    // ────────────────────────────────────────────────────────────────
    progress('retriever_analysis', 35, 'Analyzing retrieved evidence...', {
      substep: 'analysis_started',
      chunkCount: allChunks.length,
      sourceCount: new Set(allChunks.map((c) => c.source_url)).size,
    });

    const evidenceContext = formatEvidenceContext(allChunks);

    const retrieverResult = await callRoleModel({
      role: 'retriever',
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.retriever },
        {
          role: 'user',
          content: `Research Query: ${researchQuery}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nRetrieved Evidence:\n${evidenceContext}\n\nAnalyze this evidence. Identify high-value chunks, outliers, contradictions, and bridge passages.`,
        },
      ],
    });
    modelLog.push(retrieverResult);
    await saveRunCheckpoint({
      runId,
      stage: 'retriever_analysis',
      checkpointKey: 'retriever_analysis',
      snapshot: { output: retrieverResult.content },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 5: REASONER — build structured arguments
    // ────────────────────────────────────────────────────────────────
    progress('reasoning', 50, 'Reasoning over evidence...', { substep: 'reasoner_started' });

    const reasonerResult = await callRoleModel({
      role: 'reasoner',
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.reasoner },
        {
          role: 'user',
          content: `Research Query: ${researchQuery}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nEvidence Analysis:\n${retrieverResult.content}\n\nEvidence Chunks:\n${evidenceContext}\n\nBuild detailed reasoning chains. Tag every claim with evidence tier.`,
        },
      ],
    });
    modelLog.push(reasonerResult);
    await saveRunCheckpoint({
      runId,
      stage: 'reasoning',
      checkpointKey: 'reasoner_output',
      snapshot: { output: reasonerResult.content },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 6: SKEPTIC — challenge conclusions
    // ────────────────────────────────────────────────────────────────
    progress('challenge', 65, 'Challenging conclusions with skeptic...', { substep: 'skeptic_started' });

    const skepticResult = await callRoleModel({
      role: 'skeptic',
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.skeptic },
        {
          role: 'user',
          content: `Research Query: ${researchQuery}\n\nReasoning Produced:\n${reasonerResult.content}\n\nChallenge these conclusions. Find weaknesses, alternatives, and counterevidence.`,
        },
      ],
    });
    modelLog.push(skepticResult);
    await saveRunCheckpoint({
      runId,
      stage: 'challenge',
      checkpointKey: 'skeptic_output',
      snapshot: { output: skepticResult.content },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 7: SYNTHESIZER — write the full report
    // ────────────────────────────────────────────────────────────────
    progress('synthesis', 80, 'Generating iterative report sections...', { substep: 'outline_started' });

    const generatedReport = await generateIterativeReport({
      query: researchQuery,
      plan,
      evidenceContext,
      retrieverAnalysis: retrieverResult.content,
      reasoningChains: reasonerResult.content,
      challenges: skepticResult.content,
      onSectionProgress: async ({ title, index, total }) => {
        progress('synthesis', Math.min(90, 80 + Math.floor((index / total) * 10)), `Report section ${index}/${total}: ${title}`, {
          substep: 'section_generated',
          detail: title,
        });
        await saveRunCheckpoint({
          runId,
          stage: 'synthesis',
          checkpointKey: `section_${index}`,
          snapshot: { sectionTitle: title, index, total },
        });
      },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 8: VERIFIER — epistemic quality gate
    // ────────────────────────────────────────────────────────────────
    progress('verification', 92, 'Verifying epistemic standards...');

    const verifierResult = await callRoleModel({
      role: 'verifier',
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.verifier },
        {
          role: 'user',
          content: `Verify this research report meets epistemic standards:\n\n${generatedReport.markdown}`,
        },
      ],
    });
    modelLog.push(verifierResult);

    let verification: VerificationResult = { passed: true, criteria: [], overall: 'PASS' };
    try {
      const jsonMatch = verifierResult.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        verification = JSON.parse(jsonMatch[0]) as VerificationResult;
      }
    } catch {
      // Continue even if verification JSON parse fails
    }

    // ────────────────────────────────────────────────────────────────
    // STAGE 9: SAVE REPORT
    // ────────────────────────────────────────────────────────────────
    progress('saving', 94, 'Saving report to corpus...');

    const reportSections = parseReportSections(generatedReport.markdown);
    const reportId = await saveReport({
      runId,
      query: researchQuery,
      plan,
      allChunks,
      synthesizerContent: generatedReport.markdown,
      verification,
      discoverySummary: discoverySummary as unknown as Record<string, unknown>,
    });
    await saveRunCheckpoint({
      runId,
      stage: 'saving',
      checkpointKey: 'report_saved',
      snapshot: { reportId, sectionCount: reportSections.length },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 10: EPISTEMIC PERSISTENCE — claims, contradictions, citations
    // ────────────────────────────────────────────────────────────────
    progress('epistemic_persistence', 97, 'Persisting claims, contradictions, and citations...');

    try {
      const claims = await extractAndPersistClaims({
        runId,
        reportId,
        researchQuery,
        chunks: allChunks,
        reasonerOutput: reasonerResult.content,
        synthesizerOutput: generatedReport.markdown,
      });

      await extractAndPersistContradictions({
        runId,
        reportId,
        chunks: allChunks,
        claims,
        skepticOutput: skepticResult.content,
      });

      await mapAndPersistCitations({
        runId,
        reportId,
        chunks: allChunks,
        claims,
        reportSections,
        discoverySummary: discoverySummary as unknown as Record<string, unknown>,
      });
    } catch (epistemicErr) {
      // Do not fail the run if epistemic persistence fails — log and continue
      logger.error(`[${runId}] Epistemic persistence failed:`, epistemicErr);
    }

    // Update run with model log, report_id, and completion
    await query(
      `UPDATE research_runs SET status='completed', completed_at=NOW(), model_log=$1, report_id=$2, failed_stage=NULL, failure_meta='{}'::jsonb WHERE id=$3`,
      [JSON.stringify(modelLog), reportId, runId]
    );

    progress('done', 100, 'Research complete');

    return { runId, reportId };
  } catch (err) {
    const failureDetails = buildResearchFailureDetails(err, currentStage);
    try {
      await query(
        `UPDATE research_runs SET status='failed', error_message=$1, failed_stage=$2, failure_meta=$3, completed_at=NOW() WHERE id=$4`,
        [failureDetails.errorMessage, currentStage, JSON.stringify(failureDetails.failureMeta), runId]
      );
    } catch (dbErr) {
      logger.error(`Research run ${runId}: failed to persist failure row`, dbErr);
      try {
        await query(
          `UPDATE research_runs SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
          [failureDetails.errorMessage.slice(0, 2000), runId]
        );
      } catch (fallbackErr) {
        logger.error(`Research run ${runId}: fallback failure UPDATE also failed`, fallbackErr);
      }
    }
    logger.error(`Research run ${runId} failed:`, err);
    const enrichedError = Object.assign(new Error(failureDetails.errorMessage), {
      runId,
      stage: currentStage,
      percent: currentPercent,
      message: currentMessage,
      retryable: failureDetails.retryable,
      failureMeta: failureDetails.failureMeta,
    });
    throw enrichedError;
  }
}

function buildResearchFailureDetails(err: unknown, stage: string): ResearchFailureDetails {
  if (err instanceof NormalizedModelError) {
    const endpoint = `${config.openrouter.baseUrl}/chat/completions`;
    const providerMessage = err.providerMessage || 'No provider message returned';
    const status = err.status ?? 'unknown';
    const retryable = err.classification === 'rate_limited' || err.classification === 'provider_unavailable';
    return {
      errorMessage: `Model provider request failed at ${stage} (role=${err.role}, model=${err.model}, status=${status}, classification=${err.classification}): ${providerMessage}`,
      failureMeta: {
        classification: err.classification,
        status: err.status,
        providerMessage,
        model: err.model,
        fallbackTried: err.fallbackTried,
        role: err.role,
        endpoint,
      },
      retryable,
    };
  }
  if (axios.isAxiosError(err)) {
    return buildAxiosFailureDetails(err, stage);
  }
  const errorMessage = err instanceof Error ? err.message : String(err);
  return {
    errorMessage,
    failureMeta: {},
    retryable: false,
  };
}

function buildAxiosFailureDetails(err: AxiosError, stage: string): ResearchFailureDetails {
  const status = err.response?.status;
  const endpoint = err.config?.url;
  const method = err.config?.method ? err.config.method.toUpperCase() : 'GET';
  const providerMessage = extractAxiosProviderMessage(err);
  const classification = classifyAxiosError(status);
  const statusLabel = status ?? 'network_error';
  const retryable =
    classification === 'rate_limited'
    || classification === 'provider_unavailable'
    || classification === 'network_error';

  const openrouterBase = config.openrouter.baseUrl.replace(/\/+$/, '');
  const isOpenRouterCall = typeof endpoint === 'string' && endpoint.startsWith(openrouterBase);
  const openrouter404Hint =
    status === 404 && isOpenRouterCall
      ? ' If this URL is OpenRouter, check OPENROUTER_BASE_URL on the server (must be base only, e.g. https://openrouter.ai/api/v1 — not .../chat/completions).'
      : '';

  return {
    errorMessage: `Upstream request failed at ${stage} (${method} ${endpoint ?? 'unknown endpoint'}, status=${statusLabel}, classification=${classification}): ${providerMessage}${openrouter404Hint}`,
    failureMeta: {
      classification,
      status,
      providerMessage,
      endpoint,
      method,
      code: err.code,
      ...(isOpenRouterCall ? { upstream: 'openrouter' } : {}),
    },
    retryable,
  };
}

function classifyAxiosError(status?: number): string {
  if (!status) return 'network_error';
  if (status === 404) return 'endpoint_not_found';
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 400) return 'bad_request';
  if (status >= 500) return 'provider_unavailable';
  return 'unknown';
}

function extractAxiosProviderMessage(err: AxiosError): string {
  const data = err.response?.data as unknown;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const maybe = data as { error?: { message?: string }; message?: string; detail?: string };
    return maybe.error?.message || maybe.message || maybe.detail || JSON.stringify(data);
  }
  return err.message;
}

function formatEvidenceContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => [
      `[CHUNK ${i + 1}] ID: ${c.id}`,
      `Source: ${c.source_title || c.source_url || 'Unknown'}`,
      `Similarity: ${c.similarity.toFixed(3)}`,
      c.evidence_tier ? `Evidence Tier: ${c.evidence_tier}` : '',
      `Content:\n${c.content}`,
      '---',
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

async function saveReport(args: {
  runId: string;
  query: string;
  plan: ResearchPlan;
  allChunks: RetrievedChunk[];
  synthesizerContent: string;
  verification: VerificationResult;
  discoverySummary?: Record<string, unknown>;
}): Promise<string> {
  const { runId, query: researchQuery, plan, allChunks, synthesizerContent, verification, discoverySummary } = args;

  // Parse sections from synthesizer output
  const sections = parseReportSections(synthesizerContent);

  let reportId!: string;

  await withTransaction(async (client) => {
    const reportResult = await client.query(
      `INSERT INTO reports (run_id, title, query, status, executive_summary, conclusion, falsification_criteria, source_count, chunk_count, finalized_at)
       VALUES ($1, $2, $3, 'finalized', $4, $5, $6, $7, $8, NOW()) RETURNING id`,
      [
        runId,
        researchQuery.slice(0, 200),
        researchQuery,
        sections.find(s => s.type === 'executive_summary')?.content ?? '',
        sections.find(s => s.type === 'conclusion')?.content ?? '',
        plan.falsification_criteria.join('\n'),
        new Set(allChunks.map(c => c.source_url)).size,
        allChunks.length,
      ]
    );
    reportId = reportResult.rows[0].id;

    // Insert all sections
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      await client.query(
        `INSERT INTO report_sections (report_id, section_type, title, content, section_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [reportId, sec.type, sec.title, sec.content, i + 1]
      );
    }

    // Store verification metadata
    await client.query(
      `UPDATE reports SET metadata=$1 WHERE id=$2`,
      [JSON.stringify({ verification, plan, discovery: discoverySummary ?? null }), reportId]
    );
  });

  return reportId;
}

function parseReportSections(content: string): Array<{ type: string; title: string; content: string }> {
  const SECTION_MAP: Record<string, string> = {
    'executive summary': 'executive_summary',
    'research question': 'research_question',
    'evidence ledger': 'evidence_ledger',
    'reasoning': 'reasoning',
    'contradiction': 'contradiction_analysis',
    'challenge': 'challenges',
    'synthesis': 'synthesis',
    'conclusion': 'conclusion',
    'falsification': 'falsification_criteria',
    'unresolved': 'unresolved_questions',
    'recommended': 'recommended_queries',
  };

  const headerRegex = /^#{1,3}\s+(.+)$/m;
  const lines = content.split('\n');
  const sections: Array<{ type: string; title: string; content: string }> = [];

  let currentTitle = 'Report';
  let currentType = 'body';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (headerRegex.test(line)) {
      if (currentLines.length > 0) {
        sections.push({
          type: currentType,
          title: currentTitle,
          content: currentLines.join('\n').trim(),
        });
      }
      currentTitle = line.replace(/^#+\s+/, '');
      currentType = 'body';
      for (const [key, type] of Object.entries(SECTION_MAP)) {
        if (currentTitle.toLowerCase().includes(key)) {
          currentType = type;
          break;
        }
      }
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({ type: currentType, title: currentTitle, content: currentLines.join('\n').trim() });
  }

  // If no sections were parsed, treat the whole thing as body
  if (sections.length === 0) {
    sections.push({ type: 'body', title: 'Report', content: content });
  }

  return sections;
}
