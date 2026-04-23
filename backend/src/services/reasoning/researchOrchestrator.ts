import { query, queryOne, withTransaction } from '../../db/pool';
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
import { clearRunCancelled, isRunCancellationRequested, ResearchCancelledError } from '../researchCancellation';
import type { PerRunModelOverrides } from '../runtimeModelStore';
import { APPROVED_REASONING_MODEL_ALLOWLIST, type ResearchObjective, isHfRepoModel } from './reasoningModelPolicy';
import { allowFallbackByRoleFromOverrides } from './v2FallbackResolution';
import { mergeOrchestratorHintsIntoFailureMeta } from '../../utils/researchFailureHints';

export interface ResearchJobData {
  runId: string;
  query: string;
  supplemental?: string;
  filterTags?: string[];
  modelOverrides?: PerRunModelOverrides;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
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
  eventType?: 'progress' | 'run_started' | 'run_failed' | 'run_completed' | 'run_resumed';
  retryable?: boolean;
  failureMeta?: Record<string, unknown>;
}

type ProgressCallback = (update: ResearchProgress) => void;

async function assertNotCancelled(runId: string): Promise<void> {
  if (await isRunCancellationRequested(runId)) {
    throw new ResearchCancelledError();
  }
}

interface ResearchPlan {
  sub_questions: string[];
  retrieval_queries: string[];
  hypothesis: string;
  falsification_criteria: string[];
  investigation_angles: string[];
}

function normalizeRetrievalQueries(raw: unknown, fallback: string): string[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t) out.push(t);
    } else if (typeof item === 'number' || typeof item === 'boolean') {
      out.push(String(item));
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const q = o.query ?? o.text ?? o.q;
      if (typeof q === 'string' && q.trim()) out.push(q.trim());
      else out.push(JSON.stringify(item));
    }
  }
  return out.length > 0 ? out : [fallback];
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

interface ReaderFrontMatter {
  overall_summary: string;
  conclusions_nutshell: string;
  metric_glosses: Array<{ label: string; narrative: string }>;
}

function normalizeRunOverrides(overrides: PerRunModelOverrides | undefined): PerRunModelOverrides {
  if (!overrides || typeof overrides !== 'object') return { overrides: {} };
  return {
    overrides: overrides.overrides ?? {},
    embedding: typeof overrides.embedding === 'string' ? overrides.embedding : undefined,
  };
}

function runtimeOverrideForRole(
  overrides: PerRunModelOverrides,
  role: keyof typeof APPROVED_REASONING_MODEL_ALLOWLIST
): { primary?: string; fallback?: string } | undefined {
  const entry = overrides.overrides?.[role];
  if (!entry) return undefined;
  const primary = entry.primary?.trim() || undefined;
  const fallback = entry.fallback?.trim() || undefined;
  if (!primary && !fallback) return undefined;
  return { primary, fallback };
}

function snapshotModelEnsemble(overrides: PerRunModelOverrides): Record<string, unknown> {
  const roles = Object.keys(APPROVED_REASONING_MODEL_ALLOWLIST);
  const out: Record<string, unknown> = {};
  for (const role of roles) {
    const o = overrides.overrides?.[role];
    out[role] = {
      primary_override: o?.primary ?? null,
      fallback_override: o?.fallback ?? null,
      fallback_enabled: o?.fallbackEnabled === true,
    };
  }
  return out;
}

function buildReaderFrontMatter(args: {
  executiveSummary: string;
  conclusion: string;
  contradictionCount: number;
  sourceCount: number;
  chunkCount: number;
  falsificationCriteria: string[];
}): ReaderFrontMatter {
  const summary = args.executiveSummary.trim().replace(/\s+/g, ' ');
  const conclusion = args.conclusion.trim().replace(/\s+/g, ' ');

  const fallbackSummary = `This report synthesizes evidence from ${args.sourceCount} sources and ${args.chunkCount} evidence chunks to evaluate the core research question.`;
  const fallbackConclusion = args.contradictionCount > 0
    ? `The findings include ${args.contradictionCount} explicit contradiction points, meaning important claims conflict and require targeted follow-up validation.`
    : 'The current evidence set does not surface explicit contradiction pairs, but conclusions remain conditional on corpus coverage.';

  return {
    overall_summary: [summary.slice(0, 260) || fallbackSummary, conclusion.slice(0, 220) || fallbackConclusion]
      .filter(Boolean)
      .join(' '),
    conclusions_nutshell: conclusion.slice(0, 360) || fallbackConclusion,
    metric_glosses: [
      {
        label: 'Contradictions',
        narrative:
          args.contradictionCount > 0
            ? `${args.contradictionCount} claim conflicts were detected. Each conflict shows two evidence-backed statements that cannot both be true as currently framed.`
            : 'No explicit claim conflicts were detected in this run; this does not prove harmony, only that no direct contradiction pairs were extracted.',
      },
      {
        label: 'Counterevidence / Falsification',
        narrative:
          args.falsificationCriteria.length > 0
            ? `Falsification is defined against these targets: ${args.falsificationCriteria.slice(0, 2).join('; ')}.`
            : 'Counterevidence would need to directly invalidate the report’s central mechanism claims and assumptions.',
      },
      {
        label: 'Evidence coverage',
        narrative: `${args.sourceCount} sources and ${args.chunkCount} chunks were reviewed; broader coverage can still change the confidence profile of conclusions.`,
      },
    ],
  };
}

async function appendRunProgressEvent(runId: string, event: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE research_runs
        SET progress_events = CASE
          WHEN jsonb_typeof(progress_events) = 'array'
            THEN (progress_events || $2::jsonb)
          ELSE $2::jsonb
        END
      WHERE id = $1`,
    [runId, JSON.stringify([event])]
  );
}

function v2CallOpts(
  engineVersion: string | undefined,
  researchObjective: ResearchObjective | undefined,
  allowFallbackByRole: Record<string, boolean>
) {
  return {
    engineVersion: engineVersion ?? undefined,
    researchObjective: researchObjective ?? undefined,
    allowFallbackByRole,
  };
}

export async function runResearchJob(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<{ runId: string; reportId: string }> {
  const {
    runId,
    query: researchQuery,
    supplemental,
    filterTags,
    modelOverrides: incomingModelOverrides,
    engineVersion,
    researchObjective,
  } = data;
  const runModelOverrides = normalizeRunOverrides(incomingModelOverrides);
  const allowFallbackByRole = allowFallbackByRoleFromOverrides(runModelOverrides);
  const v2 = v2CallOpts(engineVersion, researchObjective, allowFallbackByRole);
  const resumeJobPayload: ResearchJobData = {
    runId,
    query: researchQuery,
    supplemental,
    filterTags,
    modelOverrides: runModelOverrides,
    engineVersion,
    researchObjective,
  };
  const modelLog: ModelCallResult[] = [];
  let currentStage = 'queued';
  let currentPercent = 0;
  let currentMessage = 'Queued';

  const progress = async (
    stage: string,
    percent: number,
    message: string,
    extra?: Omit<ResearchProgress, 'stage' | 'percent' | 'message' | 'runId' | 'timestamp'>
  ) => {
    await assertNotCancelled(runId);
    currentStage = stage;
    currentPercent = percent;
    currentMessage = message;
    const payload = { stage, percent, message, runId, timestamp: new Date().toISOString(), ...extra };
    onProgress(payload);
    logger.info(`[${runId}] ${stage}: ${message}`);
    try {
      await query(
        `UPDATE research_runs SET progress_stage=$1, progress_percent=$2, progress_message=$3, progress_updated_at=NOW() WHERE id=$4`,
        [stage, Math.round(percent), message.slice(0, 2000), runId]
      );
      await appendRunProgressEvent(runId, payload);
    } catch (e) {
      logger.warn(`[${runId}] progress persist skipped`, e);
    }
  };

  // Mark run as running
  await query(
    `UPDATE research_runs
        SET status='running',
            started_at=NOW(),
            model_overrides=$2::jsonb,
            model_ensemble=$3::jsonb
      WHERE id=$1`,
    [runId, JSON.stringify(runModelOverrides), JSON.stringify(snapshotModelEnsemble(runModelOverrides))]
  );

  try {
    // ────────────────────────────────────────────────────────────────
    // STAGE 1: PLANNER — decompose the research query
    // ────────────────────────────────────────────────────────────────
    await progress('planning', 5, 'Decomposing research query with planner...', { substep: 'request_started' });

    const plannerResult = await callRoleModel({
      role: 'planner',
      ...v2,
      runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'planner'),
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.planner },
        {
          role: 'user',
          content: `Research Query: ${researchQuery}\n\n${supplemental ? `Supplemental Context:\n${supplemental}\n\n` : ''}Produce a structured JSON research plan.`,
        },
      ],
    });
    modelLog.push(plannerResult);
    await progress('planning', 8, 'Planner response parsed', {
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
    plan.retrieval_queries = normalizeRetrievalQueries(plan.retrieval_queries, researchQuery);

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
    await progress('discovery', 15, 'Running autonomous external discovery...', { substep: 'queries_generating' });

    const discoverySummary = await runDiscoveryOrchestrator({
      runId,
      researchQuery,
      plan: plan as unknown as Record<string, unknown>,
      filterTags,
      engineVersion,
      researchObjective,
      allowFallbackByRole,
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
    await progress('retrieval', 20, 'Retrieving evidence from corpus...', { substep: 'retrieval_started' });

    const allChunks: RetrievedChunk[] = [];
    const seenIds = new Set<string>();

    for (const rq of plan.retrieval_queries.slice(0, 5)) {
      const rqStr = typeof rq === 'string' ? rq : JSON.stringify(rq);
      const chunks = await retrieveChunks({
        query: rqStr,
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
      await progress('retrieval', Math.min(RETRIEVAL_PROGRESS_CAP, RETRIEVAL_PROGRESS_BASE + allChunks.length), `Retrieval query complete: ${rqStr}`, {
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
    await progress('retriever_analysis', 35, 'Analyzing retrieved evidence...', {
      substep: 'analysis_started',
      chunkCount: allChunks.length,
      sourceCount: new Set(allChunks.map((c) => c.source_url)).size,
    });

    const evidenceContext = formatEvidenceContext(allChunks);

    const retrieverResult = await callRoleModel({
      role: 'retriever',
      ...v2,
      runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'retriever'),
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
    await progress('reasoning', 50, 'Reasoning over evidence...', { substep: 'reasoner_started' });

    const reasonerResult = await callRoleModel({
      role: 'reasoner',
      ...v2,
      runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'reasoner'),
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
    await progress('challenge', 65, 'Challenging conclusions with skeptic...', { substep: 'skeptic_started' });

    const skepticResult = await callRoleModel({
      role: 'skeptic',
      ...v2,
      callPurpose: 'pipeline_skeptic',
      runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'skeptic'),
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
    await progress('synthesis', 80, 'Generating iterative report sections...', { substep: 'outline_started' });

    const generatedReport = await generateIterativeReport({
      query: researchQuery,
      plan,
      evidenceContext,
      retrieverAnalysis: retrieverResult.content,
      reasoningChains: reasonerResult.content,
      challenges: skepticResult.content,
      engineVersion: v2.engineVersion,
      researchObjective: v2.researchObjective,
      allowFallbackByRole: v2.allowFallbackByRole,
      onSectionProgress: async ({ title, index, total }) => {
        await progress('synthesis', Math.min(90, 80 + Math.floor((index / total) * 10)), `Report section ${index}/${total}: ${title}`, {
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
    await progress('verification', 92, 'Verifying epistemic standards...');

    const verifierResult = await callRoleModel({
      role: 'verifier',
      ...v2,
      runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'verifier'),
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
    // STAGE 8b: PLAIN LANGUAGE — sister report for general audiences
    // ────────────────────────────────────────────────────────────────
    await progress('plain_language', 93, 'Writing plain-language version of the report...', { substep: 'plain_language_started' });

    const plainLanguageResult = await callRoleModel({
      role: 'plain_language_synthesizer',
      ...v2,
      runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'plain_language_synthesizer'),
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.plain_language_synthesizer },
        {
          role: 'user',
          content: `Rewrite the following research report in plain language for a general reader. Keep uncertainty and contradictions explicit.\n\n${generatedReport.markdown.slice(0, 120000)}`,
        },
      ],
    });
    modelLog.push(plainLanguageResult);
    await progress('plain_language', 93, 'Plain-language report drafted', {
      substep: 'plain_language_done',
      model: plainLanguageResult.model,
      tokenUsage: { prompt: plainLanguageResult.promptTokens, completion: plainLanguageResult.completionTokens },
    });

    const plainLanguageMarkdown = plainLanguageResult.content.trim();

        // ────────────────────────────────────────────────────────────────
    // STAGE 9: SAVE REPORT
    // ────────────────────────────────────────────────────────────────
    await progress('saving', 94, 'Saving report to corpus...');

    const reportSections = parseReportSections(generatedReport.markdown);
    const readerFrontMatter = buildReaderFrontMatter({
      executiveSummary: reportSections.find((s) => s.type === 'executive_summary')?.content ?? '',
      conclusion: reportSections.find((s) => s.type === 'conclusion')?.content ?? '',
      contradictionCount: 0,
      sourceCount: new Set(allChunks.map((c) => c.source_url)).size,
      chunkCount: allChunks.length,
      falsificationCriteria: plan.falsification_criteria,
    });
    const prov = await queryOne<{
      supplemental: string;
      supplemental_attachments: unknown;
    }>(`SELECT supplemental, supplemental_attachments FROM research_runs WHERE id=$1`, [runId]);

    const reportId = await saveReport({
      runId,
      query: researchQuery,
      plan,
      allChunks,
      synthesizerContent: generatedReport.markdown,
      verification,
      discoverySummary: discoverySummary as unknown as Record<string, unknown>,
      plainLanguageMarkdown,
      readerFrontMatter,
      modelEnsemble: snapshotModelEnsemble(runModelOverrides),
      supplementalText: prov?.supplemental ?? '',
      supplementalAttachments: Array.isArray(prov?.supplemental_attachments)
        ? (prov.supplemental_attachments as Record<string, unknown>[])
        : [],
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
    await progress('epistemic_persistence', 97, 'Persisting claims, contradictions, and citations...');

    try {
      const claims = await extractAndPersistClaims({
        runId,
        reportId,
        researchQuery,
        chunks: allChunks,
        reasonerOutput: reasonerResult.content,
        synthesizerOutput: generatedReport.markdown,
        ...v2,
      });

      await extractAndPersistContradictions({
        runId,
        reportId,
        chunks: allChunks,
        claims,
        skepticOutput: skepticResult.content,
        ...v2,
      });

      await mapAndPersistCitations({
        runId,
        reportId,
        chunks: allChunks,
        claims,
        reportSections,
        discoverySummary: discoverySummary as unknown as Record<string, unknown>,
        ...v2,
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

    await progress('done', 100, 'Research complete');
    await appendRunProgressEvent(runId, {
      runId,
      stage: 'done',
      percent: 100,
      message: 'Research complete',
      timestamp: new Date().toISOString(),
      eventType: 'run_completed',
    });

    await query(
      `UPDATE research_runs SET progress_stage=NULL, progress_percent=NULL, progress_message=NULL, progress_updated_at=NULL, resume_job_payload=NULL WHERE id=$1`,
      [runId]
    );
    return { runId, reportId };
  } catch (err) {
    if (err instanceof ResearchCancelledError) {
      await query(
        `UPDATE research_runs SET status='cancelled', error_message=$1, completed_at=NOW(), progress_stage=NULL, progress_percent=NULL, progress_message=NULL, progress_updated_at=NULL WHERE id=$2`,
        ['Cancelled by user', runId]
      );
      await clearRunCancelled(runId);
      throw err;
    }
    const failureDetails = buildResearchFailureDetails(err, currentStage);
    const failureMetaWithResume = {
      ...failureDetails.failureMeta,
      retryable: failureDetails.retryable,
      resumeAvailable: failureDetails.retryable,
      resumeHint:
        failureDetails.retryable
          ? 'Use POST /api/research/:id/retry-from-failure (or the Resume button) to re-queue this run with the same parameters.'
          : undefined,
    };
    try {
      await query(
        `UPDATE research_runs SET status='failed', error_message=$1, failed_stage=$2, failure_meta=$3, completed_at=NOW(), resume_job_payload=$5 WHERE id=$4`,
        [
          failureDetails.errorMessage,
          currentStage,
          JSON.stringify(failureMetaWithResume),
          runId,
          JSON.stringify(resumeJobPayload),
        ]
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
    await appendRunProgressEvent(runId, {
      runId,
      stage: currentStage,
      percent: currentPercent,
      message: currentMessage,
      timestamp: new Date().toISOString(),
      eventType: 'run_failed',
      failure: {
        errorMessage: failureDetails.errorMessage,
        retryable: failureDetails.retryable,
        failureMeta: failureMetaWithResume,
      },
    });
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
  const errWithMeta = err as Error & { failureMeta?: Record<string, unknown>; retryable?: boolean };
  if (errWithMeta.failureMeta && typeof errWithMeta.failureMeta === 'object') {
    const meta = { ...errWithMeta.failureMeta } as Record<string, unknown>;
    mergeOrchestratorHintsIntoFailureMeta(meta);
    return {
      errorMessage: errWithMeta.message || 'Request failed',
      failureMeta: meta,
      retryable: Boolean(errWithMeta.retryable),
    };
  }
  if (err instanceof NormalizedModelError) {
    const upstream = err.upstream || (isHfRepoModel(err.model) ? 'huggingface_inference' : 'openrouter');
    const endpoint =
      err.endpoint
      || (upstream === 'huggingface_inference'
        ? 'https://api-inference.huggingface.co'
        : upstream === 'together'
          ? `${config.together.baseUrl.replace(/\/+$/, '')}/chat/completions`
          : `${config.openrouter.baseUrl}/chat/completions`);
    const providerMessage = err.providerMessage || 'No provider message returned';
    const status = err.status ?? 'unknown';
    const retryable = err.classification === 'rate_limited' || err.classification === 'provider_unavailable';
    const failureMeta: Record<string, unknown> = {
      classification: err.classification,
      status: err.status,
      providerMessage,
      model: err.model,
      fallbackTried: err.fallbackTried,
      role: err.role,
      endpoint,
      upstream,
      providerFallbackAttempted: err.providerFallbackAttempted === true,
      providerFallbackBackend: err.providerFallbackBackend || null,
      providerFallbackResult: err.providerFallbackResult || null,
    };
    mergeOrchestratorHintsIntoFailureMeta(failureMeta);
    return {
      errorMessage: `Model provider request failed at ${stage} (role=${err.role}, model=${err.model}, status=${status}, classification=${err.classification}): ${providerMessage}`,
      failureMeta,
      retryable,
    };
  }
  if (axios.isAxiosError(err)) {
    return buildAxiosFailureDetails(err, stage);
  }
  const errorMessage = err instanceof Error ? err.message : String(err);
  const lower = errorMessage.toLowerCase();
  const hints: string[] = [];
  if (lower.includes('hf_token') || lower.includes('hugging face token')) {
    hints.push('HF_TOKEN may be missing or invalid on the server.');
  }
  if (lower.includes('openrouter') || lower.includes('chat/completions')) {
    hints.push('Check OPENROUTER_API_KEY and OPENROUTER_BASE_URL (must be the API base, e.g. https://openrouter.ai/api/v1, not .../chat/completions).');
  }
  return {
    errorMessage,
    failureMeta: hints.length ? { orchestratorHints: hints } : {},
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

  const hints: string[] = [];
  if (retryable) {
    hints.push('You can use “Resume from last failure” on the Research page if the run saved a retry payload.');
  }
  if (classification === 'provider_unavailable' && isOpenRouterCall) {
    hints.push('OpenRouter may be temporarily unavailable; wait and retry, or verify billing/rate limits.');
  }

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
      ...(hints.length ? { orchestratorHints: hints } : {}),
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
  plainLanguageMarkdown?: string;
  readerFrontMatter?: ReaderFrontMatter;
  modelEnsemble?: Record<string, unknown>;
  supplementalText: string;
  supplementalAttachments: Record<string, unknown>[];
}): Promise<string> {
  const {
    runId,
    query: researchQuery,
    plan,
    allChunks,
    synthesizerContent,
    verification,
    discoverySummary,
    plainLanguageMarkdown,
    readerFrontMatter,
    modelEnsemble,
    supplementalText,
    supplementalAttachments,
  } = args;

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
      [
        JSON.stringify({
          verification,
          plan,
          discovery: discoverySummary ?? null,
          research_request: {
            query: researchQuery,
            supplemental: supplementalText,
            supplemental_attachments: supplementalAttachments,
          },
          ...(plainLanguageMarkdown && plainLanguageMarkdown.length > 0
            ? { plain_language_markdown: plainLanguageMarkdown }
            : {}),
          ...(readerFrontMatter ? { reader_front_matter: readerFrontMatter } : {}),
          ...(modelEnsemble ? { model_ensemble: modelEnsemble } : {}),
        }),
        reportId,
      ]
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
