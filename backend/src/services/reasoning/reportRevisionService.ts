import { query, withTransaction } from '../../db/pool';
import { callRoleModel, SYSTEM_PROMPTS } from '../openrouter/openrouterService';
import {
  formatRetrievedChunksForPrompt,
  retrieveRevisionSupplementalChunks,
} from '../retrieval/retrievalService';
import { runScope } from '../telemetry';
import type { PerRunModelOverrides } from '../runtimeModelStore';
import {
  parseResearchObjective,
  type ReasoningModelRole,
  type ResearchObjective,
} from './reasoningModelPolicy';
import { normalizeRunOverrides, runtimeOverrideForRole } from './researchOrchestratorNormalize';
import { allowFallbackByRoleFromModelEnsembleSnapshot } from './v2FallbackResolution';
import { ADJUDICATIVE_SECTION_INTENTS } from './reportGenerator';
import { logger } from '../../utils/logger';

/** Source of an automated revision (Work Order T). Same pipeline as user revisions; UI/reporting only. */
export type RevisionTriggerSource = 'user' | 'parallel_monitor' | 'reverse_citation_watch';

/** Full audit row returned to revision UI (Gate 6 — matches frontend RevisionAttachmentAudit). */
export interface RevisionAttachmentAudit {
  kind: 'url' | 'file';
  url?: string;
  filename?: string;
  mimetype?: string;
  ingestion_job_id: string;
  fetch_status?: 'success' | 'failed';
  fetch_error?: string;
  ingestion_status?: string;
  extractedChars?: number;
  inline_status?: 'included' | 'skipped' | 'failed';
  retrieval_status?: 'queued' | 'completed' | 'failed' | 'pending';
}

export interface RevisionProgress {
  reportId: string;
  revisionId?: string;
  stage: string;
  percent: number;
  message: string;
  timestamp: string;
}

export interface ChangePlan {
  request_type: string;
  global_or_local: string;
  affected_sections: string[];
  required_insertions: Array<{ title: string; content: string; after_section_type?: string }>;
  required_rewrites: Array<{ section_type: string; instruction: string }>;
  citation_impact: Record<string, unknown>;
  consistency_checks: string[];
}

interface ReportRow {
  id: string;
  title: string;
  query: string;
  status: string;
  executive_summary: string | null;
  conclusion: string | null;
  falsification_criteria: string | null;
  unresolved_questions: string[] | null;
  recommended_queries: string[] | null;
  contradiction_count: number;
  source_count: number;
  chunk_count: number;
  metadata: Record<string, unknown> | null;
  root_report_id: string | null;
  parent_report_id: string | null;
  version_number: number | null;
  user_id: string | null;
}

interface ReportSectionRow {
  id: string;
  report_id: string;
  section_type: string;
  title: string;
  content: string;
  section_order: number;
}

interface RevisionIntake {
  request_type?: string;
  global_or_local?: string;
  target_terms?: string[];
  insertion_requests?: Array<{ title?: string; content?: string; after_section_type?: string }>;
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3);
}

function toSectionMap(sections: ReportSectionRow[]): Record<string, ReportSectionRow> {
  return Object.fromEntries(sections.map((s) => [s.section_type, s]));
}

export function locateAffectedSections(args: {
  sections: ReportSectionRow[];
  request: string;
  targetTerms: string[];
}): string[] {
  const sectionTypes = new Set<string>();
  const requestTokens = new Set([...tokenize(args.request), ...args.targetTerms.map((v) => v.toLowerCase())]);
  for (const section of args.sections) {
    const haystack = `${section.title}\n${section.content}`.toLowerCase();
    for (const token of requestTokens) {
      if (token && haystack.includes(token)) {
        sectionTypes.add(section.section_type);
        break;
      }
    }
  }
  return [...sectionTypes];
}

export function applyGlobalTerminologyChange(content: string, fromTerm: string, toTerm: string): string {
  if (!fromTerm || !toTerm) return content;
  const escaped = fromTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), toTerm);
}

export function inferInsertionIndex(sectionTypes: string[], insertion: { after_section_type?: string; title: string }): number {
  if (insertion.after_section_type) {
    const explicit = sectionTypes.indexOf(insertion.after_section_type);
    if (explicit >= 0) return explicit + 1;
  }
  const normalizedTitle = insertion.title.toLowerCase();
  if (normalizedTitle.includes('conclusion')) {
    const idx = sectionTypes.indexOf('synthesis');
    if (idx >= 0) return idx + 1;
  }
  const evidenceIdx = sectionTypes.indexOf('evidence_ledger');
  return evidenceIdx >= 0 ? evidenceIdx + 1 : sectionTypes.length;
}

export function basicConsistencyChecks(sections: ReportSectionRow[], intentId?: string): string[] {
  const map = toSectionMap(sections);
  const issues: string[] = [];
  if (!map.executive_summary || !map.executive_summary.content.trim()) issues.push('missing_executive_summary');
  if (!map.conclusion || !map.conclusion.content.trim()) issues.push('missing_conclusion');
  // Falsification criteria only applies to adjudicative intents (adjudication, investigation,
  // story_verification) and legacy runs with no intentId. Descriptive intents never produce
  // this section, so checking for it would always produce a false positive (Rule 37).
  const requiresFalsification = !intentId || ADJUDICATIVE_SECTION_INTENTS.has(intentId);
  if (requiresFalsification && (!map.falsification_criteria || !map.falsification_criteria.content.trim())) {
    issues.push('missing_falsification_criteria');
  }
  return issues;
}

/**
 * Create the `report_revision_requests` row and return the real DB id.
 * Call this BEFORE ingesting supplemental files so the ingestion_jobs rows
 * are tagged with the real request id from the start.
 *
 * Uses the same migration-014 fallback as `createReportRevision` — if the
 * `metadata`/`supplemental_attachments` columns are not yet present the
 * INSERT falls back to the legacy column set (Postgres SQLSTATE 42703).
 */
export async function createRevisionRequest(args: {
  reportId: string;
  requestText: string;
  rationale?: string;
  initiatedBy?: string;
  initiatedByType?: string;
  revisionTriggeredBy?: RevisionTriggerSource;
}): Promise<{ requestId: string }> {
  const baseMeta = {
    has_supplemental_context: false,
    supplemental_context_chars: 0,
    attachment_count: 0,
    ...(args.revisionTriggeredBy ? { triggeredBy: args.revisionTriggeredBy } : {}),
  };
  let requestRows: Array<{ id: string }>;
  try {
    requestRows = await query<{ id: string }>(
      `INSERT INTO report_revision_requests (report_id, request_text, rationale, initiated_by, initiated_by_type, status, metadata, supplemental_attachments)
       VALUES ($1, $2, $3, $4, $5, 'queued', $6::jsonb, $7::jsonb) RETURNING id`,
      [
        args.reportId,
        args.requestText,
        args.rationale ?? '',
        args.initiatedBy ?? 'system',
        args.initiatedByType ?? 'user',
        JSON.stringify(baseMeta),
        JSON.stringify([]),
      ]
    );
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== '42703') throw err;
    requestRows = await query<{ id: string }>(
      `INSERT INTO report_revision_requests (report_id, request_text, rationale, initiated_by, initiated_by_type, status)
       VALUES ($1, $2, $3, $4, $5, 'queued') RETURNING id`,
      [
        args.reportId,
        args.requestText,
        args.rationale ?? '',
        args.initiatedBy ?? 'system',
        args.initiatedByType ?? 'user',
      ]
    );
  }
  if (!requestRows[0]?.id) throw new Error('Failed to create revision request row');
  return { requestId: requestRows[0].id };
}

/**
 * Public entry. Establishes telemetry scope for the revision pipeline.
 *
 * Revision-emitted `agent_executions` rows have:
 *   run_id    = NULL    (revisions don't create research_runs rows)
 *   report_id = args.reportId  (the report being revised)
 *   user_id   = args.initiatedBy
 *
 * Per Rule 25 invariant I-2: only this function may call runScope.run
 * inside the revision module. The seven revision agents (revision_intake,
 * report_locator, change_planner, section_rewriter, citation_integrity_checker,
 * final_revision_verifier — see REASONING_MODEL_ROLES) inherit this scope
 * via AsyncLocalStorage.
 */
export async function createReportRevision(args: {
  reportId: string;
  requestText: string;
  rationale?: string;
  initiatedBy?: string;
  initiatedByType?: string;
  revisionTriggeredBy?: RevisionTriggerSource;
  /** Concatenated text extracted from user-attached files / URLs (built by
   *  `ingestSupplementalForRevision` at the route level). Spliced into the
   *  revision_intake / change_planner / section_rewriter prompts so the
   *  models can review the attached material on this revision call. */
  supplementalContext?: string;
  /** Audit list of the attachments that produced `supplementalContext`. Stored
   *  on the revision_request row's metadata for the report detail page to
   *  display. */
  supplementalAttachments?: Array<Record<string, unknown>>;
  onProgress?: (update: RevisionProgress) => void;
  /** Pre-created request id from `createRevisionRequest`. When provided the
   *  INSERT is skipped and this id is used directly; the row's metadata and
   *  supplemental_attachments are updated to reflect the final ingest result. */
  requestId?: string;
}): Promise<{
  revisionId: string;
  revisedReportId: string;
  changePlan: ChangePlan;
  supplementalAttachments?: RevisionAttachmentAudit[];
}> {
  return runScope.run(
    {
      runId: null,
      reportId: args.reportId,
      userId: args.initiatedBy ?? null,
      orgId: null,
    },
    () => createReportRevisionInner(args)
  );
}

async function createReportRevisionInner(args: {
  reportId: string;
  requestText: string;
  rationale?: string;
  initiatedBy?: string;
  initiatedByType?: string;
  revisionTriggeredBy?: RevisionTriggerSource;
  supplementalContext?: string;
  supplementalAttachments?: Array<Record<string, unknown>>;
  onProgress?: (update: RevisionProgress) => void;
  requestId?: string;
}): Promise<{
  revisionId: string;
  revisedReportId: string;
  changePlan: ChangePlan;
  supplementalAttachments?: RevisionAttachmentAudit[];
}> {
  const emit = (stage: string, percent: number, message: string, revisionId?: string) => {
    args.onProgress?.({
      reportId: args.reportId,
      revisionId,
      stage,
      percent,
      message,
      timestamp: new Date().toISOString(),
    });
  };

  emit('intake', 5, 'Creating revision request');
  const reportRows = await query<ReportRow>('SELECT * FROM reports WHERE id=$1', [args.reportId]);
  if (reportRows.length === 0) {
    throw new Error('Report not found');
  }
  const baseReport = reportRows[0];
  const baseSections = await query<ReportSectionRow>(
    'SELECT * FROM report_sections WHERE report_id=$1 ORDER BY section_order',
    [args.reportId]
  );

  const reportRunModelEnsembleRows = await query<{
    model_ensemble: Record<string, unknown> | null;
    model_overrides: Record<string, unknown> | null;
    engine_version: string | null;
    research_objective: string | null;
  }>(
    `SELECT rr.model_ensemble, rr.model_overrides, rr.engine_version, rr.research_objective FROM research_runs rr
      JOIN reports r ON r.run_id = rr.id
     WHERE r.id = $1
     LIMIT 1`,
    [args.reportId]
  );
  const reportRunModelEnsemble = reportRunModelEnsembleRows[0]?.model_ensemble ?? null;
  const runEngineVersion = reportRunModelEnsembleRows[0]?.engine_version?.trim() || undefined;
  const runObjective: ResearchObjective | undefined = parseResearchObjective(
    reportRunModelEnsembleRows[0]?.research_objective ?? undefined
  );
  const runModelOverrides = normalizeRunOverrides(
    (reportRunModelEnsembleRows[0]?.model_overrides ?? null) as PerRunModelOverrides | undefined
  );
  const allowFallbackByRole = allowFallbackByRoleFromModelEnsembleSnapshot(
    reportRunModelEnsembleRows[0]?.model_ensemble ?? null
  );
  const revOpts = {
    engineVersion: runEngineVersion,
    researchObjective: runObjective,
    allowFallbackByRole,
  };
  const revisionRoleCall = (role: ReasoningModelRole) => ({
    role,
    ...revOpts,
    runtimeOverrides: runtimeOverrideForRole(runModelOverrides, role),
  });
  if (baseSections.length === 0) {
    throw new Error('Report has no sections');
  }

  // INSERT — try the new schema first (with metadata + supplemental_attachments).
  // If migration 014 has not yet been applied, fall back to the legacy column
  // set so the route does not 500 during a deploy gap. Only the specific
  // "undefined column" error (Postgres SQLSTATE 42703) is recovered.
  //
  // When a pre-created requestId is supplied (from `createRevisionRequest` at
  // the route level) we skip the INSERT and instead UPDATE the row with the
  // final supplemental metadata now that we know the real attachment list.
  const supplementalAttachments = args.supplementalAttachments ?? [];
  const requestMetadata = {
    has_supplemental_context: Boolean(args.supplementalContext && args.supplementalContext.length > 0),
    supplemental_context_chars: args.supplementalContext?.length ?? 0,
    attachment_count: supplementalAttachments.length,
    ...(args.revisionTriggeredBy ? { triggeredBy: args.revisionTriggeredBy } : {}),
  };
  let requestId: string;
  if (args.requestId) {
    requestId = args.requestId;
    // Back-fill the metadata and supplemental_attachments that weren't
    // available when the row was first created (before ingest completed).
    try {
      await query(
        `UPDATE report_revision_requests SET metadata=$1::jsonb, supplemental_attachments=$2::jsonb WHERE id=$3`,
        [JSON.stringify(requestMetadata), JSON.stringify(supplementalAttachments), requestId]
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== '42703') throw err;
      // supplemental_attachments column not yet present — update metadata only.
      await query(
        `UPDATE report_revision_requests SET metadata=$1::jsonb WHERE id=$2`,
        [JSON.stringify(requestMetadata), requestId]
      );
    }
  } else {
    let requestRows: Array<{ id: string }>;
    try {
      requestRows = await query<{ id: string }>(
        `INSERT INTO report_revision_requests (report_id, request_text, rationale, initiated_by, initiated_by_type, status, metadata, supplemental_attachments)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6::jsonb, $7::jsonb) RETURNING id`,
        [
          args.reportId,
          args.requestText,
          args.rationale ?? '',
          args.initiatedBy ?? 'system',
          args.initiatedByType ?? 'user',
          JSON.stringify(requestMetadata),
          JSON.stringify(supplementalAttachments),
        ]
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== '42703') throw err;
      requestRows = await query<{ id: string }>(
        `INSERT INTO report_revision_requests (report_id, request_text, rationale, initiated_by, initiated_by_type, status)
         VALUES ($1, $2, $3, $4, $5, 'queued') RETURNING id`,
        [
          args.reportId,
          args.requestText,
          args.rationale ?? '',
          args.initiatedBy ?? 'system',
          args.initiatedByType ?? 'user',
        ]
      );
    }
    if (!requestRows[0]?.id) throw new Error('Failed to create revision request row');
    requestId = requestRows[0].id;
  }
  emit('retrieval', 8, 'Retrieving supplemental corpus chunks');
  let retrievedSupplementalContext = '';
  let enrichedAttachments: RevisionAttachmentAudit[] = [];
  if (supplementalAttachments.length > 0) {
    const retrievedChunks = await retrieveRevisionSupplementalChunks({
      reportId: args.reportId,
      revisionRequestId: requestId,
      queryText: args.requestText,
    });
    retrievedSupplementalContext = formatRetrievedChunksForPrompt(retrievedChunks);
    enrichedAttachments = await enrichRevisionSupplementalAttachments(supplementalAttachments, {
      retrievedChunkCount: retrievedChunks.length,
    });
    try {
      await query(
        `UPDATE report_revision_requests SET supplemental_attachments=$1::jsonb WHERE id=$2`,
        [JSON.stringify(enrichedAttachments), requestId]
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== '42703') throw err;
    }
  }

  // Build a single supplemental block to splice into model prompts when
  // attachments are present. Kept short to stay inside per-prompt budgets.
  const inlineSupplemental = args.supplementalContext?.trim() ?? '';
  const combinedSupplemental = [inlineSupplemental, retrievedSupplementalContext].filter(Boolean).join('\n\n---\n\n');
  const supplementalBlock = combinedSupplemental.length > 0
    ? `\n\nUser-attached supplemental context (review and weigh as sources; cite when used):\n${combinedSupplemental}`
    : '';

  emit('intake', 12, 'Parsing revision request');
  const intakeResult = await callRoleModel({
    ...revisionRoleCall('revision_intake'),
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.revision_intake },
      { role: 'user', content: `Revision request:\n${args.requestText}\nRationale:\n${args.rationale ?? ''}${supplementalBlock}\nReturn JSON only.` },
    ],
  });
  const intake = parseJson<RevisionIntake>(intakeResult.content) ?? {};

  emit('location', 24, 'Locating impacted sections');
  const targetTerms = intake.target_terms ?? [];
  const deterministicHits = locateAffectedSections({ sections: baseSections, request: args.requestText, targetTerms });
  const locatorResult = await callRoleModel({
    ...revisionRoleCall('report_locator'),
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.report_locator },
      {
        role: 'user',
        content: `Request:\n${args.requestText}
Sections:\n${baseSections.map((s) => `${s.section_type}: ${s.title}`).join('\n')}
Use this deterministic pre-hit list:\n${JSON.stringify(deterministicHits)}
Return strict JSON.`,
      },
    ],
  });
  const locatorPayload = parseJson<{ affected_sections?: string[]; global_impact?: string }>(locatorResult.content) ?? {};
  const affectedSections = [...new Set([...(locatorPayload.affected_sections ?? []), ...deterministicHits])];

  emit('planning', 38, 'Building structured change plan');
  const plannerResult = await callRoleModel({
    ...revisionRoleCall('change_planner'),
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.change_planner },
      {
        role: 'user',
        content: `Request:\n${args.requestText}
Intake:\n${JSON.stringify(intake)}
Affected sections:\n${JSON.stringify(affectedSections)}${supplementalBlock}
Return strict JSON.`,
      },
    ],
  });
  const parsedPlan = parseJson<ChangePlan>(plannerResult.content);
  const changePlan: ChangePlan = parsedPlan ?? {
    request_type: intake.request_type ?? 'edit',
    global_or_local: intake.global_or_local ?? (affectedSections.length > 1 ? 'multi_section' : 'single_section'),
    affected_sections: affectedSections,
    required_insertions: (intake.insertion_requests ?? [])
      .map((r) => ({ title: r.title ?? 'New Section', content: r.content ?? '', after_section_type: r.after_section_type }))
      .filter((r) => r.content.trim().length > 0),
    required_rewrites: affectedSections.map((section_type) => ({
      section_type,
      instruction: args.requestText,
    })),
    citation_impact: {},
    consistency_checks: [
      'executive_summary_matches_body',
      'conclusion_matches_evidence',
      'contradictions_updated',
      'falsification_updated_if_claim_changes',
    ],
  };

  emit('rewriting', 56, 'Rewriting impacted sections');
  let revisedSections = baseSections.map((section) => ({ ...section }));
  const fromTerm = targetTerms[0]?.trim();
  const toTerm = targetTerms[1]?.trim();
  if (changePlan.global_or_local === 'global_terminology' && fromTerm && toTerm) {
    revisedSections = revisedSections.map((section) => ({
      ...section,
      content: applyGlobalTerminologyChange(section.content, fromTerm, toTerm),
    }));
  } else {
    for (const rewrite of changePlan.required_rewrites) {
      const idx = revisedSections.findIndex((s) => s.section_type === rewrite.section_type);
      if (idx < 0) continue;
      const section = revisedSections[idx];
      const rewriteResult = await callRoleModel({
        ...revisionRoleCall('section_rewriter'),
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.section_rewriter },
          {
            role: 'user',
            content: `Revision request:\n${args.requestText}
Section type: ${section.section_type}
Section title: ${section.title}
Rewrite instruction: ${rewrite.instruction}
Current content:\n${section.content}${supplementalBlock}
Return revised section body only.`,
          },
        ],
      });
      const rewrittenContent = rewriteResult.content.trim();
      if (!rewrittenContent) {
        logger.warn(`Revision rewrite returned empty content; keeping original`, {
          reportId: args.reportId,
          sectionType: section.section_type,
        });
      }
      revisedSections[idx] = { ...section, content: rewrittenContent || section.content };
    }
  }

  if (changePlan.required_insertions.length > 0) {
    let sectionTypes = revisedSections.map((s) => s.section_type);
    for (const [insertNumber, insertion] of changePlan.required_insertions.entries()) {
      const insertAt = inferInsertionIndex(sectionTypes, insertion);
      const normalized = insertion.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const sectionType = normalized || `inserted_section_${insertNumber + 1}`;
      revisedSections.splice(insertAt, 0, {
        id: `inserted-${sectionType}-${insertNumber + 1}`,
        report_id: args.reportId,
        section_type: sectionType,
        title: insertion.title,
        content: insertion.content,
        section_order: insertAt + 1,
      });
      sectionTypes = revisedSections.map((s) => s.section_type);
    }
  }
  revisedSections = revisedSections.map((section, index) => ({ ...section, section_order: index + 1 }));

  emit('citation_integrity', 70, 'Running citation integrity checks');
  const citationChecks: Record<string, unknown> = {};
  const citationEntries = await Promise.all(
    revisedSections.map(async (section) => {
      const checkerResult = await callRoleModel({
        ...revisionRoleCall('citation_integrity_checker'),
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.citation_integrity_checker },
          {
            role: 'user',
            content: `Section type: ${section.section_type}
Title: ${section.title}
Content:\n${section.content}
Return JSON only.`,
          },
        ],
      });
      return [
        section.section_type,
        parseJson<Record<string, unknown>>(checkerResult.content) ?? {
          status: 'unknown',
          issues: [],
          required_citation_updates: [],
        },
      ] as const;
    })
  );
  for (const [sectionType, check] of citationEntries) {
    citationChecks[sectionType] = check;
  }

  emit('verification', 82, 'Running final revision verifier');
  const verifierResult = await callRoleModel({
    ...revisionRoleCall('final_revision_verifier'),
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.final_revision_verifier },
      {
        role: 'user',
        content: `Request:\n${args.requestText}
Change plan:\n${JSON.stringify(changePlan, null, 2)}
Revised report sections:\n${revisedSections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n')}
Return strict JSON.`,
      },
    ],
  });
  const verifierPayload = parseJson<{ passed?: boolean; findings?: unknown[]; required_fixes?: string[] }>(
    verifierResult.content
  ) ?? { passed: true, findings: [], required_fixes: [] };
  const consistencyIssues = basicConsistencyChecks(
    revisedSections,
    typeof baseReport.metadata?.orchestration_intent === 'string'
      ? baseReport.metadata.orchestration_intent
      : undefined
  );
  const revisionImpactSummary = {
    requested_change: args.requestText,
    affected_sections: changePlan.affected_sections,
    rewrite_count: changePlan.required_rewrites.length,
    insertion_count: changePlan.required_insertions.length,
    consistency_issues: consistencyIssues,
    epistemic_impact:
      consistencyIssues.length > 0
        ? 'Revision introduced or retained unresolved consistency checks that need review.'
        : 'Revision preserved core report consistency checks while applying requested changes.',
  };

  emit('persistence', 90, 'Persisting revised report version');
  let revisionId = '';
  let revisedReportId = '';
  await withTransaction(async (client) => {
    const currentVersion = baseReport.version_number ?? 1;
    const rootReportId = baseReport.root_report_id ?? baseReport.id;
    const newVersion = currentVersion + 1;

    const revisionReportBaseParams = [
      baseReport.id,
      baseReport.title,
      baseReport.query,
      revisedSections.find((s) => s.section_type === 'executive_summary')?.content ?? baseReport.executive_summary ?? '',
      revisedSections.find((s) => s.section_type === 'conclusion')?.content ?? baseReport.conclusion ?? '',
      revisedSections.find((s) => s.section_type === 'falsification_criteria')?.content ??
        baseReport.falsification_criteria ??
        '',
      baseReport.unresolved_questions ?? [],
      baseReport.recommended_queries ?? [],
      baseReport.contradiction_count,
      baseReport.source_count,
      baseReport.chunk_count,
      JSON.stringify({
        ...(baseReport.metadata ?? {}),
        revision_request_id: requestId,
        revision_verifier: verifierPayload,
        consistency_issues: consistencyIssues,
        citation_checks: citationChecks,
        revision_impact_summary: revisionImpactSummary,
        model_ensemble: reportRunModelEnsemble,
        revision_model_ensemble: reportRunModelEnsemble,
      }),
      rootReportId,
      baseReport.id,
      newVersion,
      args.rationale ?? '',
      args.initiatedBy ?? 'system',
    ];
    let newReport: { rows: Array<{ id: string }> };
    await client.query('SAVEPOINT pre_revision_report_insert');
    try {
      newReport = await client.query<{ id: string }>(
        `INSERT INTO reports (
           run_id, title, query, status, executive_summary, conclusion, falsification_criteria,
           unresolved_questions, recommended_queries, contradiction_count, source_count, chunk_count,
           metadata, finalized_at, root_report_id, parent_report_id, version_number, revision_rationale, revised_by,
           user_id
         )
         VALUES (
           (SELECT run_id FROM reports WHERE id=$1),
           $2, $3, 'finalized', $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, NOW(), $13, $14, $15, $16, $17,
           $18
         )
         RETURNING id`,
        [...revisionReportBaseParams, baseReport.user_id ?? null]
      );
    } catch (revReportErr) {
      if ((revReportErr as { code?: string })?.code !== '42703') throw revReportErr;
      await client.query('ROLLBACK TO SAVEPOINT pre_revision_report_insert');
      newReport = await client.query<{ id: string }>(
        `INSERT INTO reports (
           run_id, title, query, status, executive_summary, conclusion, falsification_criteria,
           unresolved_questions, recommended_queries, contradiction_count, source_count, chunk_count,
           metadata, finalized_at, root_report_id, parent_report_id, version_number, revision_rationale, revised_by
         )
         VALUES (
           (SELECT run_id FROM reports WHERE id=$1),
           $2, $3, 'finalized', $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, NOW(), $13, $14, $15, $16, $17
         )
         RETURNING id`,
        revisionReportBaseParams
      );
    }
    revisedReportId = newReport.rows[0].id;

    const insertedSections = new Map<string, string>();
    for (const section of revisedSections) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO report_sections (report_id, section_type, title, content, section_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [revisedReportId, section.section_type, section.title, section.content, section.section_order]
      );
      insertedSections.set(section.section_type, inserted.rows[0].id);
    }

    const copiedCitations = await client.query<{
      section_type: string;
      chunk_id: string | null;
      claim_id: string | null;
      source_id: string | null;
      citation_text: string | null;
      evidence_tier: string;
      stance: string;
    }>(
      `SELECT rs.section_type, rc.chunk_id, rc.claim_id, rc.source_id, rc.citation_text, rc.evidence_tier, rc.stance
       FROM report_citations rc
       JOIN report_sections rs ON rs.id = rc.section_id
       WHERE rc.report_id = $1`,
      [baseReport.id]
    );

    for (const citation of copiedCitations.rows) {
      const newSectionId = insertedSections.get(citation.section_type);
      if (!newSectionId) continue;
      await client.query(
        `INSERT INTO report_citations (report_id, section_id, chunk_id, claim_id, source_id, citation_text, evidence_tier, stance)
         VALUES ($1, $2, $3, $4, $5, $6, $7::evidence_tier, $8::claim_stance)`,
        [
          revisedReportId,
          newSectionId,
          citation.chunk_id,
          citation.claim_id,
          citation.source_id,
          citation.citation_text,
          citation.evidence_tier,
          citation.stance,
        ]
      );
    }

    const revisionMetaJson = JSON.stringify(
      args.revisionTriggeredBy ? { triggeredBy: args.revisionTriggeredBy } : {}
    );
    let revision: { rows: Array<{ id: string }> };
    await client.query('SAVEPOINT pre_metadata_insert');
    try {
      revision = await client.query<{ id: string }>(
        `INSERT INTO report_revisions (
           report_id, base_report_id, revised_report_id, parent_report_id, root_report_id,
           revision_number, request_id, rationale, initiated_by, initiated_by_type, status,
           change_plan, verifier_result, consistency_issues, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'applied', $11, $12, $13, $14::jsonb)
         RETURNING id`,
        [
          baseReport.id,
          baseReport.id,
          revisedReportId,
          baseReport.id,
          rootReportId,
          newVersion,
          requestId,
          args.rationale ?? '',
          args.initiatedBy ?? 'system',
          args.initiatedByType ?? 'user',
          JSON.stringify(changePlan),
          JSON.stringify(verifierPayload),
          consistencyIssues,
          revisionMetaJson,
        ]
      );
    } catch (revErr) {
      const code = (revErr as { code?: string } | null)?.code;
      if (code !== '42703') throw revErr;
      await client.query('ROLLBACK TO SAVEPOINT pre_metadata_insert');
      revision = await client.query<{ id: string }>(
        `INSERT INTO report_revisions (
           report_id, base_report_id, revised_report_id, parent_report_id, root_report_id,
           revision_number, request_id, rationale, initiated_by, initiated_by_type, status,
           change_plan, verifier_result, consistency_issues
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'applied', $11, $12, $13)
         RETURNING id`,
        [
          baseReport.id,
          baseReport.id,
          revisedReportId,
          baseReport.id,
          rootReportId,
          newVersion,
          requestId,
          args.rationale ?? '',
          args.initiatedBy ?? 'system',
          args.initiatedByType ?? 'user',
          JSON.stringify(changePlan),
          JSON.stringify(verifierPayload),
          consistencyIssues,
        ]
      );
    }
    revisionId = revision.rows[0].id;

    const baseByType = new Map(baseSections.map((section) => [section.section_type, section]));
    for (const section of revisedSections) {
      const before = baseByType.get(section.section_type);
      const changed = !before || before.content !== section.content;
      if (!changed) continue;
      await client.query(
        `INSERT INTO report_revision_sections (
           revision_id, revised_report_id, section_type, section_title, section_order,
           before_content, after_content, change_type
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          revisionId,
          revisedReportId,
          section.section_type,
          section.title,
          section.section_order,
          before?.content ?? '',
          section.content,
          before ? 'rewrite' : 'insertion',
        ]
      );
      await client.query(
        `INSERT INTO report_revision_diffs (revision_id, section_type, before_content, after_content, diff_metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          revisionId,
          section.section_type,
          before?.content ?? '',
          section.content,
          JSON.stringify({
            changed,
            beforeLength: before?.content.length ?? 0,
            afterLength: section.content.length,
          }),
        ]
      );
    }

    await client.query(
      `UPDATE report_revision_requests SET status='applied', processed_at=NOW(), applied_revision_id=$1 WHERE id=$2`,
      [revisionId, requestId]
    );
  });

  emit('done', 100, 'Revision applied', revisionId);
  return {
    revisionId,
    revisedReportId,
    changePlan,
    ...(enrichedAttachments.length > 0 ? { supplementalAttachments: enrichedAttachments } : {}),
  };
}

function normalizeFetchStatus(raw: unknown): 'success' | 'failed' {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'ok' || s === 'success') return 'success';
  return 'failed';
}

function resolveRetrievalStatus(
  ingestionStatus: string | undefined,
  retrievedChunkCount: number
): RevisionAttachmentAudit['retrieval_status'] {
  const ingest = (ingestionStatus ?? '').toLowerCase();
  if (ingest === 'failed' || ingest === 'error') return 'failed';
  if (retrievedChunkCount > 0 && (ingest === 'complete' || ingest === 'completed')) return 'completed';
  if (ingest === 'complete' || ingest === 'completed') return 'pending';
  if (ingest === 'queued' || ingest === 'processing' || ingest === 'running') return 'queued';
  return retrievedChunkCount > 0 ? 'completed' : 'pending';
}

/** Maps ingest audit rows to the full RevisionAttachmentAudit contract for UI + API. */
export async function enrichRevisionSupplementalAttachments(
  attachments: Array<Record<string, unknown>>,
  options: { retrievedChunkCount: number }
): Promise<RevisionAttachmentAudit[]> {
  if (attachments.length === 0) return [];

  const jobIds = attachments
    .map((a) => String(a.ingestion_job_id ?? '').trim())
    .filter(Boolean);
  const jobStatusById = new Map<string, string>();
  if (jobIds.length > 0) {
    try {
      const rows = await query<{ id: string; status: string }>(
        `SELECT id, status FROM ingestion_jobs WHERE id = ANY($1::uuid[])`,
        [jobIds]
      );
      for (const row of rows) {
        jobStatusById.set(row.id, row.status);
      }
    } catch (err) {
      logger.debug('[revision] enrichRevisionSupplementalAttachments ingestion_jobs lookup skipped', err);
    }
  }

  return attachments.map((raw) => {
    const kind = raw.kind === 'file' ? 'file' : 'url';
    const jobId = String(raw.ingestion_job_id ?? '');
    const fetchStatus = normalizeFetchStatus(raw.fetch_status);
    const extractedChars =
      typeof raw.extractedChars === 'number' ? raw.extractedChars : undefined;
    const fetchError =
      typeof raw.error === 'string'
        ? raw.error
        : typeof raw.fetch_error === 'string'
          ? raw.fetch_error
          : undefined;
    const ingestionStatus = jobStatusById.get(jobId);

    let inline_status: RevisionAttachmentAudit['inline_status'];
    if (fetchStatus === 'failed') {
      inline_status = 'failed';
    } else if ((extractedChars ?? 0) > 0) {
      inline_status = 'included';
    } else {
      inline_status = 'skipped';
    }

    const base: RevisionAttachmentAudit = {
      kind,
      ingestion_job_id: jobId,
      fetch_status: fetchStatus,
      ...(fetchError ? { fetch_error: fetchError } : {}),
      ...(typeof extractedChars === 'number' ? { extractedChars } : {}),
      ...(ingestionStatus ? { ingestion_status: ingestionStatus } : {}),
      inline_status,
      retrieval_status: resolveRetrievalStatus(ingestionStatus, options.retrievedChunkCount),
    };

    if (kind === 'url') {
      return { ...base, url: typeof raw.url === 'string' ? raw.url : undefined };
    }
    return {
      ...base,
      filename: typeof raw.filename === 'string' ? raw.filename : undefined,
      mimetype: typeof raw.mimetype === 'string' ? raw.mimetype : undefined,
    };
  });
}

export async function listReportRevisions(reportId: string): Promise<Record<string, unknown>[]> {
  const roots = await query<{ root_id: string }>(
    `SELECT COALESCE(root_report_id, id) AS root_id FROM reports WHERE id=$1`,
    [reportId]
  );
  const rootId = roots[0]?.root_id ?? reportId;
  return query(
    `SELECT id, report_id, base_report_id, revised_report_id, revision_number, rationale, initiated_by,
            initiated_by_type, status, created_at
     FROM report_revisions
     WHERE root_report_id=$1
        OR report_id=$2
        OR base_report_id=$2
        OR revised_report_id=$2
     ORDER BY revision_number DESC, created_at DESC`,
    [rootId, reportId]
  );
}

export async function getReportRevision(reportId: string, revisionId: string): Promise<Record<string, unknown> | null> {
  const revisions = await query(
    `SELECT * FROM report_revisions WHERE id=$1 AND report_id=$2`,
    [revisionId, reportId]
  );
  if (revisions.length === 0) return null;
  const sections = await query(
    `SELECT * FROM report_revision_sections WHERE revision_id=$1 ORDER BY section_order`,
    [revisionId]
  );
  const diffs = await query(
    `SELECT * FROM report_revision_diffs WHERE revision_id=$1 ORDER BY created_at`,
    [revisionId]
  );
  return { ...revisions[0], sections, diffs };
}
