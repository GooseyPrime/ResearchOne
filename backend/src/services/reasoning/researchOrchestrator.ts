import { query, queryOne, withTransaction } from '../../db/pool';
import { callRoleModel, SYSTEM_PROMPTS, ModelCallResult } from '../openrouter/openrouterService';
import { retrieveChunks, RetrievedChunk } from '../retrieval/retrievalService';
import { runDiscoveryOrchestrator } from '../discovery/discoveryOrchestrator';
import { extractAndPersistClaims } from './claimExtractor';
import { extractAndPersistContradictions } from './contradictionExtractor';
import { mapAndPersistCitations } from './citationMapper';
import { logger } from '../../utils/logger';

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

export async function runResearchJob(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<{ runId: string; reportId: string }> {
  const { runId, query: researchQuery, supplemental, filterTags } = data;
  const modelLog: ModelCallResult[] = [];

  const progress = (stage: string, percent: number, message: string) => {
    onProgress({ stage, percent, message, runId });
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
    progress('planning', 5, 'Decomposing research query with planner...');

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

    // ────────────────────────────────────────────────────────────────
    // STAGE 2: DISCOVERY — autonomous external research if needed
    // ────────────────────────────────────────────────────────────────
    progress('discovery', 15, 'Running autonomous external discovery...');

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

    logger.info(`[${runId}] Discovery: ingested=${discoverySummary.sourcesIngested}, skipped=${discoverySummary.sourcesSkipped}`);

    // ────────────────────────────────────────────────────────────────
    // STAGE 3: RETRIEVAL — gather evidence (now includes discovery sources)
    // ────────────────────────────────────────────────────────────────
    progress('retrieval', 20, 'Retrieving evidence from corpus...');

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
    }

    logger.info(`[${runId}] Retrieved ${allChunks.length} unique chunks`);
    const retrievalIds = allChunks.map(c => c.id);

    await query(
      `UPDATE research_runs SET retrieval_ids=$1 WHERE id=$2`,
      [retrievalIds, runId]
    );

    // ────────────────────────────────────────────────────────────────
    // STAGE 4: RETRIEVER ANALYSIS — evaluate evidence quality
    // ────────────────────────────────────────────────────────────────
    progress('retriever_analysis', 35, 'Analyzing retrieved evidence...');

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

    // ────────────────────────────────────────────────────────────────
    // STAGE 5: REASONER — build structured arguments
    // ────────────────────────────────────────────────────────────────
    progress('reasoning', 50, 'Reasoning over evidence...');

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

    // ────────────────────────────────────────────────────────────────
    // STAGE 6: SKEPTIC — challenge conclusions
    // ────────────────────────────────────────────────────────────────
    progress('challenge', 65, 'Challenging conclusions with skeptic...');

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

    // ────────────────────────────────────────────────────────────────
    // STAGE 7: SYNTHESIZER — write the full report
    // ────────────────────────────────────────────────────────────────
    progress('synthesis', 80, 'Synthesizing long-form research report...');

    const synthesizerResult = await callRoleModel({
      role: 'synthesizer',
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.synthesizer },
        {
          role: 'user',
          content: buildSynthesisPrompt({
            query: researchQuery,
            plan,
            evidenceContext,
            retrieverAnalysis: retrieverResult.content,
            reasoningChains: reasonerResult.content,
            challenges: skepticResult.content,
          }),
        },
      ],
    });
    modelLog.push(synthesizerResult);

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
          content: `Verify this research report meets epistemic standards:\n\n${synthesizerResult.content}`,
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

    const reportSections = parseReportSections(synthesizerResult.content);
    const reportId = await saveReport({
      runId,
      query: researchQuery,
      plan,
      allChunks,
      synthesizerContent: synthesizerResult.content,
      verification,
      discoverySummary: discoverySummary as unknown as Record<string, unknown>,
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
        synthesizerOutput: synthesizerResult.content,
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
      `UPDATE research_runs SET status='completed', completed_at=NOW(), model_log=$1, report_id=$2 WHERE id=$3`,
      [JSON.stringify(modelLog), reportId, runId]
    );

    progress('done', 100, 'Research complete');

    return { runId, reportId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE research_runs SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
      [errMsg, runId]
    );
    logger.error(`Research run ${runId} failed:`, err);
    throw err;
  }
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

function buildSynthesisPrompt(args: {
  query: string;
  plan: ResearchPlan;
  evidenceContext: string;
  retrieverAnalysis: string;
  reasoningChains: string;
  challenges: string;
}): string {
  return `Research Query: ${args.query}

Investigation Plan:
${JSON.stringify(args.plan, null, 2)}

Evidence Analysis:
${args.retrieverAnalysis}

Reasoning Chains:
${args.reasoningChains}

Challenges and Counterarguments:
${args.challenges}

Evidence Base (${args.evidenceContext.split('---').length} chunks retrieved):
${args.evidenceContext}

Write a complete professional research report with ALL of the following sections:
1. Executive Summary
2. Research Question and Scope
3. Evidence Ledger (all major claims tagged with evidence tiers)
4. Reasoning and Analysis
5. Contradiction Analysis (do not suppress contradictions)
6. Challenges and Alternative Explanations
7. Synthesis and Conclusions
8. Falsification Criteria (what would prove this wrong)
9. Unresolved Questions
10. Recommended Next Queries

DO NOT exceed the evidence. Mark inferences clearly. This is a research report, not an opinion piece.`;
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
