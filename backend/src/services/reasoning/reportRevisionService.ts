import { query, withTransaction } from '../../db/pool';
import { callRoleModel, SYSTEM_PROMPTS } from '../openrouter/openrouterService';

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

export function basicConsistencyChecks(sections: ReportSectionRow[]): string[] {
  const map = toSectionMap(sections);
  const issues: string[] = [];
  if (!map.executive_summary || !map.executive_summary.content.trim()) issues.push('missing_executive_summary');
  if (!map.conclusion || !map.conclusion.content.trim()) issues.push('missing_conclusion');
  if (!map.falsification_criteria || !map.falsification_criteria.content.trim()) {
    issues.push('missing_falsification_criteria');
  }
  return issues;
}

export async function createReportRevision(args: {
  reportId: string;
  requestText: string;
  rationale?: string;
  initiatedBy?: string;
  initiatedByType?: string;
  onProgress?: (update: RevisionProgress) => void;
}): Promise<{ revisionId: string; revisedReportId: string; changePlan: ChangePlan }> {
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
  if (baseSections.length === 0) {
    throw new Error('Report has no sections');
  }

  const requestRows = await query<{ id: string }>(
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
  const requestId = requestRows[0].id;

  emit('intake', 12, 'Parsing revision request');
  const intakeResult = await callRoleModel({
    role: 'revision_intake',
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.revision_intake },
      { role: 'user', content: `Revision request:\n${args.requestText}\nRationale:\n${args.rationale ?? ''}\nReturn JSON only.` },
    ],
  });
  const intake = parseJson<RevisionIntake>(intakeResult.content) ?? {};

  emit('location', 24, 'Locating impacted sections');
  const targetTerms = intake.target_terms ?? [];
  const deterministicHits = locateAffectedSections({ sections: baseSections, request: args.requestText, targetTerms });
  const locatorResult = await callRoleModel({
    role: 'report_locator',
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
    role: 'change_planner',
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.change_planner },
      {
        role: 'user',
        content: `Request:\n${args.requestText}
Intake:\n${JSON.stringify(intake)}
Affected sections:\n${JSON.stringify(affectedSections)}
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
  if (changePlan.global_or_local === 'global_terminology' && targetTerms.length >= 2) {
    revisedSections = revisedSections.map((section) => ({
      ...section,
      content: applyGlobalTerminologyChange(section.content, targetTerms[0], targetTerms[1]),
    }));
  } else {
    for (const rewrite of changePlan.required_rewrites) {
      const idx = revisedSections.findIndex((s) => s.section_type === rewrite.section_type);
      if (idx < 0) continue;
      const section = revisedSections[idx];
      const rewriteResult = await callRoleModel({
        role: 'section_rewriter',
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.section_rewriter },
          {
            role: 'user',
            content: `Revision request:\n${args.requestText}
Section type: ${section.section_type}
Section title: ${section.title}
Rewrite instruction: ${rewrite.instruction}
Current content:\n${section.content}
Return revised section body only.`,
          },
        ],
      });
      revisedSections[idx] = { ...section, content: rewriteResult.content.trim() || section.content };
    }
  }

  if (changePlan.required_insertions.length > 0) {
    let sectionTypes = revisedSections.map((s) => s.section_type);
    for (const insertion of changePlan.required_insertions) {
      const insertAt = inferInsertionIndex(sectionTypes, insertion);
      const sectionType = insertion.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      revisedSections.splice(insertAt, 0, {
        id: `inserted-${sectionType}`,
        report_id: args.reportId,
        section_type: sectionType || 'inserted_section',
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
  for (const section of revisedSections) {
    const checkerResult = await callRoleModel({
      role: 'citation_integrity_checker',
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
    citationChecks[section.section_type] = parseJson<Record<string, unknown>>(checkerResult.content) ?? {
      status: 'unknown',
      issues: [],
      required_citation_updates: [],
    };
  }

  emit('verification', 82, 'Running final revision verifier');
  const verifierResult = await callRoleModel({
    role: 'final_revision_verifier',
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
  const consistencyIssues = basicConsistencyChecks(revisedSections);

  emit('persistence', 90, 'Persisting revised report version');
  let revisionId = '';
  let revisedReportId = '';
  await withTransaction(async (client) => {
    const currentVersion = baseReport.version_number ?? 1;
    const rootReportId = baseReport.root_report_id ?? baseReport.id;
    const newVersion = currentVersion + 1;

    const newReport = await client.query<{ id: string }>(
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
      [
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
        }),
        rootReportId,
        baseReport.id,
        newVersion,
        args.rationale ?? '',
        args.initiatedBy ?? 'system',
      ]
    );
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

    const revision = await client.query<{ id: string }>(
      `INSERT INTO report_revisions (
         report_id, base_report_id, revised_report_id, parent_report_id, root_report_id,
         revision_number, request_id, rationale, initiated_by, initiated_by_type, status,
         change_plan, verifier_result, consistency_issues
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'applied', $11, $12, $13)
       RETURNING id`,
      [
        rootReportId,
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
    revisionId = revision.rows[0].id;

    for (const section of revisedSections) {
      const before = baseSections.find((s) => s.section_type === section.section_type);
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
  return { revisionId, revisedReportId, changePlan };
}

export async function listReportRevisions(reportId: string): Promise<Record<string, unknown>[]> {
  return query(
    `SELECT id, report_id, base_report_id, revised_report_id, revision_number, rationale, initiated_by,
            initiated_by_type, status, created_at
     FROM report_revisions
     WHERE report_id=$1
     ORDER BY revision_number DESC, created_at DESC`,
    [reportId]
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
