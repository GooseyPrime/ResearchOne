import { callRoleModel, getSystemPrompt } from '../openrouter/openrouterService';
import type { ResearchObjective } from './reasoningModelPolicy';
import {
  CLAIM_CLASS_SOURCING_BURDEN,
  getIntentOutputTemplate,
  INTENT_OUTPUT_TEMPLATES,
} from '../formatting/templates/intentOutputTemplates';
import {
  deriveContractWordTarget,
  deriveItemLabel,
  expandSectionPlanForContract,
  findRepeatedArtifact,
  type ContractArtifact,
} from './contractOutline';

export interface ReportSectionDraft {
  title: string;
  key: string;
  content: string;
}

/**
 * Table formatting rules for the section drafter (WO-AC R5).
 *
 * Run `e5aac059` emitted a 20-row portfolio table in which row 2 was truncated
 * mid-row and then repeated after a blank line. That split one table into two
 * fragments: the reader saw broken output and the deterministic counter read 8
 * rows instead of 20, failing the contract on a table that was substantively
 * complete.
 */
const TABLE_SECTION_PATTERN = /table|matrix|portfolio|compar|grid|scorecard|dimensions|summary of/i;

/**
 * Whether a given section is plausibly going to emit a table.
 *
 * With R1 outline expansion a run can make ~40 drafter calls; injecting table
 * rules into all of them wastes prompt tokens and constrains prose sections
 * that will never contain a table (Copilot review, PR #205). Rules are included
 * when the section itself looks tabular, or when the run's contract asks for a
 * tabular artifact — the latter matters because a section titled
 * "Opportunities 1–5" may legitimately carry the portfolio table.
 */
export function sectionExpectsTable(args: {
  title: string;
  key: string;
  contractWantsTable: boolean;
}): boolean {
  if (TABLE_SECTION_PATTERN.test(args.title) || TABLE_SECTION_PATTERN.test(args.key)) return true;
  return args.contractWantsTable;
}

/** True when any requested artifact or format implies a tabular deliverable. */
export function contractRequestsTable(
  artifacts: readonly ContractArtifact[] | undefined,
  requestedFormats: readonly string[] | undefined
): boolean {
  const artifactHit = (artifacts ?? []).some((artifact) =>
    TABLE_SECTION_PATTERN.test(`${artifact.type ?? ''} ${artifact.description ?? ''}`)
  );
  if (artifactHit) return true;
  return (requestedFormats ?? []).some((format) => TABLE_SECTION_PATTERN.test(format));
}

export const TABLE_FORMATTING_RULES = `
Markdown table rules (MANDATORY when you emit a table):
- One row per line. A row must NEVER be split across lines or interrupted by a
  blank line — a blank line ends the table and everything after it is lost.
- Never repeat a row.
- Every row must have exactly the same number of cells as the header row.
- Escape any literal pipe inside a cell as \\| so it is not read as a column break.
- Keep cell text short; put long prose in the narrative, not in a cell.
- Do not wrap the table in a code fence: fenced tables render as code, not tables.`;

interface RuntimeSectionPlanEntry {
  title: string;
  key: string;
  weight: number;
}

const ADJUDICATIVE_SECTION_PLAN: Array<{ title: string; key: string; weight: number }> = [
  { title: 'Executive Summary', key: 'executive_summary', weight: 0.6 },
  { title: 'Research Question and Scope', key: 'research_question_scope', weight: 0.5 },
  { title: 'Evidence Ledger', key: 'evidence_ledger', weight: 1.4 },
  { title: 'Reasoning and Analysis', key: 'reasoning_analysis', weight: 1.6 },
  { title: 'Contradiction Analysis', key: 'contradiction_analysis', weight: 1.0 },
  { title: 'Challenges and Alternative Explanations', key: 'challenges_alternatives', weight: 1.0 },
  { title: 'Synthesis and Conclusions', key: 'synthesis_conclusions', weight: 1.2 },
  { title: 'Falsification Criteria', key: 'falsification_criteria', weight: 0.6 },
  { title: 'Unresolved Questions', key: 'unresolved_questions', weight: 0.5 },
  { title: 'Recommended Next Queries', key: 'recommended_next_queries', weight: 0.5 },
];

/** Descriptive / discovery section plan — used for non-adjudicative intents.
 *  Omits `falsification_criteria` and `contradiction_analysis` (which are
 *  only meaningful for causal-test / adjudicative queries) and adds
 *  deliverable-focused sections instead. */
export const DESCRIPTIVE_SECTION_PLAN: Array<{ title: string; key: string; weight: number }> = [
  { title: 'Executive Summary', key: 'executive_summary', weight: 0.6 },
  { title: 'Research Question and Scope', key: 'research_question_scope', weight: 0.5 },
  { title: 'Evidence Ledger', key: 'evidence_ledger', weight: 1.4 },
  { title: 'Reasoning and Analysis', key: 'reasoning_analysis', weight: 1.6 },
  { title: 'Synthesis and Conclusions', key: 'synthesis_conclusions', weight: 1.5 },
  { title: 'Recommended Next Queries', key: 'recommended_next_queries', weight: 0.5 },
];

/** Intent IDs that use the full adjudicative section plan (hypothesis +
 *  falsification + contradiction).  All other intents use
 *  `DESCRIPTIVE_SECTION_PLAN`.  `undefined` (legacy runs) defaults to the
 *  adjudicative plan for backward compatibility. */
export const ADJUDICATIVE_SECTION_INTENTS = new Set<string>([
  'adjudication',
  'investigation',
  'story_verification',
]);

const KNOWN_NON_LEGACY_INTENTS = new Set<string>(
  Object.values(INTENT_OUTPUT_TEMPLATES)
    .map((template) => template.intentId)
    .filter((intentId) => intentId !== 'legacy')
);

const MAX_SECTION_SUMMARY_CHARS = 1200;
const MAX_ROLLING_SUMMARY_CHARS = 6000;
const MAX_SPECIALIST_FINDINGS_CHARS = 8000;

/** Per-section floor — even short presets must give each section enough
 *  budget to write a coherent paragraph. The total minimum
 *  (`REPORT_WORD_COUNT_MIN`) is derived from this so the per-section floor
 *  cannot push the summed budget above what the user requested. */
export const REPORT_WORD_COUNT_PER_SECTION_FLOOR = 80;

/** Bounds for user-supplied targetWordCount. Below the floor the report is
 *  too thin to be useful; above the ceiling the section drafter starts
 *  repeating itself even with steering, so we clamp to keep output
 *  substantive. The floor equals ADJUDICATIVE_SECTION_PLAN.length × per-section floor so
 *  the per-section budget allocator never has to overshoot the requested
 *  total to satisfy the per-section floor (Codex/Copilot PR #50 review). */
export const REPORT_WORD_COUNT_MIN = ADJUDICATIVE_SECTION_PLAN.length * REPORT_WORD_COUNT_PER_SECTION_FLOOR;
export const REPORT_WORD_COUNT_MAX = 12000;
export const REPORT_WORD_COUNT_DEFAULT = 2200;
const GENERATED_TITLE_MAX_LENGTH = 120;

export function clampWordTarget(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return REPORT_WORD_COUNT_DEFAULT;
  return Math.max(REPORT_WORD_COUNT_MIN, Math.min(REPORT_WORD_COUNT_MAX, Math.round(n)));
}

export function deriveGeneratedReportTitle(query: string, markdown: string, intentId?: string): string {
  const headingMatch = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  const firstHeading = headingMatch?.[1]?.trim();
  if (firstHeading && firstHeading.length <= GENERATED_TITLE_MAX_LENGTH && !looksLikeRawQuery(firstHeading, query)) {
    return firstHeading;
  }

  const firstSentence = markdown
    .replace(/^#+\s+/gm, '')
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !looksLikeRawQuery(line, query));
  if (firstSentence) {
    return trimTitle(firstSentence);
  }

  const fallbackIntentTitle = intentId
    ? intentId.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : 'Research Report';
  return trimTitle(`${fallbackIntentTitle} Report`);
}

export function stripPromptEchoFromReport(markdown: string, query: string): string {
  const trimmed = markdown.trim();
  const prompt = query.trim();
  if (!prompt) return trimmed;

  if (trimmed.startsWith(prompt)) {
    return trimmed.slice(prompt.length).replace(/^\s+/, '');
  }

  const queryLabelPrefix = `Research query: ${prompt}`;
  if (trimmed.startsWith(queryLabelPrefix)) {
    return trimmed.slice(queryLabelPrefix.length).replace(/^\s+/, '');
  }

  return trimmed;
}

export function ensureGeneratedTitleHeading(markdown: string, query: string, intentId?: string): string {
  const cleaned = stripPromptEchoFromReport(markdown, query);
  const title = deriveGeneratedReportTitle(query, cleaned, intentId);
  const headingMatch = cleaned.match(/^\s*#\s+(.+?)\s*$/m);
  if (!headingMatch) {
    return `# ${title}\n\n${cleaned}`.trim();
  }
  const currentHeading = headingMatch[1]?.trim() ?? '';
  if (!looksLikeRawQuery(currentHeading, query)) {
    return cleaned;
  }
  return cleaned.replace(/^\s*#\s+(.+?)\s*$/m, `# ${title}`);
}

/** Compute per-section word budgets from the total target, distributed by the
 *  per-section `weight`. Sections whose weighted share falls below the
 *  per-section floor are pinned at the floor and the deficit is
 *  redistributed across the remaining sections. Pinning is iterated to a
 *  fixed point: if a previously-non-floored section drops below the floor
 *  during redistribution, it is pinned too, and the loop runs again. The
 *  result is the smallest budget assignment that respects the floor while
 *  summing as close as possible to `totalWords`.
 *
 *  Contract: at totalWords == REPORT_WORD_COUNT_MIN every section sits at
 *  exactly the floor and the sum equals `totalWords` (verified by the
 *  reportLengthSteering test suite). For larger totals the sum tracks the
 *  request within ≤ sectionPlan.length words of `Math.round` slack.
 *
 *  `sectionPlan` defaults to `ADJUDICATIVE_SECTION_PLAN` (adjudicative 10-section plan)
 *  for backward compatibility. Pass `DESCRIPTIVE_SECTION_PLAN` for
 *  non-adjudicative intent routing. */
export function distributeWordBudget(
  totalWords: number,
  sectionPlan: Array<{ key: string; weight: number }> = ADJUDICATIVE_SECTION_PLAN
): Map<string, number> {
  const floor = REPORT_WORD_COUNT_PER_SECTION_FLOOR;
  const flooredKeys = new Set<string>();

  // Iterate to a fixed point. Each pass may newly pin sections whose
  // redistributed share still falls below the floor.
  let changed = true;
  while (changed) {
    changed = false;
    const flooredCost = flooredKeys.size * floor;
    const remainingTotal = Math.max(0, totalWords - flooredCost);
    const remainingWeight = sectionPlan
      .filter((s) => !flooredKeys.has(s.key))
      .reduce((s, sec) => s + sec.weight, 0);
    if (remainingWeight === 0) break;

    for (const sec of sectionPlan) {
      if (flooredKeys.has(sec.key)) continue;
      const share = remainingTotal * (sec.weight / remainingWeight);
      if (share < floor) {
        flooredKeys.add(sec.key);
        changed = true;
      }
    }
  }

  const flooredCost = flooredKeys.size * floor;
  const remainingTotal = Math.max(0, totalWords - flooredCost);
  const remainingWeight = sectionPlan
    .filter((s) => !flooredKeys.has(s.key))
    .reduce((s, sec) => s + sec.weight, 0);

  const budgets = new Map<string, number>();
  for (const sec of sectionPlan) {
    if (flooredKeys.has(sec.key) || remainingWeight === 0) {
      budgets.set(sec.key, floor);
    } else {
      const share = sec.weight / remainingWeight;
      budgets.set(sec.key, Math.round(remainingTotal * share));
    }
  }
  return budgets;
}

function formatLengthDirective(target: number, sectionTarget: number, sectionTitle: string): string {
  return [
    '',
    'LENGTH GUIDANCE — strict but substantive:',
    `- Whole report target: ~${target} words across all sections.`,
    `- This section ("${sectionTitle}") target: ~${sectionTarget} words (±15%).`,
    '- Use the budget on substance, not filler. Each paragraph must add a new fact, evidence chain, contradiction, or synthesis step.',
    '- If you run out of substantive material, STOP early — do not pad with restatements, generic caveats, or marketing language.',
    '- Cite specific evidence chunks and sources by their numbers/titles wherever you assert a claim.',
    '- Maintain epistemic precision: do not weaken claims with hedging that the evidence does not require, and do not overstate claims to fill space.',
  ].join('\n');
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function titleFromTemplateSection(sectionKey: string): string {
  return sectionKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function trimTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= GENERATED_TITLE_MAX_LENGTH) return normalized;
  return normalized.slice(0, GENERATED_TITLE_MAX_LENGTH - 1).trimEnd() + '…';
}

function looksLikeRawQuery(candidate: string, query: string): boolean {
  const normalizedCandidate = candidate.replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalizedCandidate.length > 0 && normalizedQuery.startsWith(normalizedCandidate);
}

function sectionPlanFromTemplate(templateId: string): RuntimeSectionPlanEntry[] {
  const template = getIntentOutputTemplate(templateId);
  const weight = template.sections.length > 0 ? 1 / template.sections.length : 1;
  return template.sections.map((sectionKey) => ({
    key: sectionKey,
    title: titleFromTemplateSection(sectionKey),
    weight,
  }));
}

export async function generateIterativeReport(args: {
  query: string;
  plan: unknown;
  sourceContext: string;
  retrieverAnalysis: string;
  reasoningChains: string;
  challenges: string;
  specialistFindings?: string;
  /**
   * Set when the evidence-sufficiency gate found little independent
   * corroboration. This is a SYNTHESIS MODIFIER — the full deliverable is
   * still produced, with explicit uncertainty labelling. It must never cause
   * synthesis to be skipped or replaced with a template (Rule 37 R-L).
   */
  limitedSourcingDirective?: string;
  /**
   * Requested artifacts from the confirmed brief (WO-AC R1/R2).
   *
   * Drives outline expansion and the word budget: a request for N items with
   * required subsections gets N drafting slots and a budget sized to the
   * contract, instead of being compressed into the intent's static plan.
   */
  contractArtifacts?: readonly ContractArtifact[];
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  requestedFormats?: string[];
  /** User-requested total report length in words. Clamped to
   *  [REPORT_WORD_COUNT_MIN, REPORT_WORD_COUNT_MAX]. Falls back to
   *  REPORT_WORD_COUNT_DEFAULT if not provided. */
  targetWordCount?: number;
  byokApiKeyOverride?: string;
  /** Intent ID from the orchestration profile. `undefined` (legacy runs)
   *  defaults to the full adjudicative section plan for backward
   *  compatibility. */
  intentId?: string;
  outputTemplateId?: string;
  onSectionProgress?: (payload: { title: string; index: number; total: number }) => void | Promise<void>;
  skipChallenger?: boolean;
  isAdjudicative?: boolean;
}): Promise<{ markdown: string; sections: ReportSectionDraft[]; outline: string[]; targetWordCount: number }> {
  let activeSectionPlan: RuntimeSectionPlanEntry[];
  let templateNarrativeHint = '';
  let templateVerifierRubric = '';
  let templateRequiredDeliverables: readonly string[] = [];
  if (args.outputTemplateId) {
    const template = getIntentOutputTemplate(args.outputTemplateId);
    if (args.intentId && template.intentId !== args.intentId) {
      throw new Error(
        `INTENT_TEMPLATE_MISMATCH: intent=${args.intentId} template=${args.outputTemplateId} templateIntent=${template.intentId}`
      );
    }
    activeSectionPlan = sectionPlanFromTemplate(args.outputTemplateId);
    templateNarrativeHint = template.narrativeHint;
    templateVerifierRubric = template.verifierRubric;
    templateRequiredDeliverables = template.requiredDeliverables;
  } else if (args.intentId && KNOWN_NON_LEGACY_INTENTS.has(args.intentId)) {
    throw new Error(`INTENT_TEMPLATE_MISSING: known intent "${args.intentId}" requires outputTemplateId`);
  } else {
    activeSectionPlan =
      args.intentId != null && !ADJUDICATIVE_SECTION_INTENTS.has(args.intentId)
        ? DESCRIPTIVE_SECTION_PLAN
        : ADJUDICATIVE_SECTION_PLAN;
  }

  // WO-AC R1 — expand the intent's static plan to fit the request's contract.
  // Five fixed sections cannot hold 20 items x 5 subsections plus a blueprint;
  // the drafter writes what fits and stops. Expanding gives each item its own
  // drafting slot (and makes it independently repairable — R3).
  const outlineExpansion = expandSectionPlanForContract({
    basePlan: activeSectionPlan,
    artifacts: args.contractArtifacts,
    intentId: args.intentId,
    explicitWordTarget: args.targetWordCount,
    perSectionFloor: REPORT_WORD_COUNT_PER_SECTION_FLOOR,
  });
  activeSectionPlan = outlineExpansion.plan;

  const v2 = {
    engineVersion: args.engineVersion,
    researchObjective: args.researchObjective,
    allowFallbackByRole: args.allowFallbackByRole,
    byokApiKeyOverride: args.byokApiKeyOverride,
    isAdjudicative: args.isAdjudicative,
  };

  // WO-AC R2 — scale the word budget to the contract. A 107-block deliverable
  // must not share a default budget with a four-section explainer. An explicit
  // user target always wins.
  const repeatedArtifact = findRepeatedArtifact(args.contractArtifacts);
  const requiredFieldsPerItem =
    (repeatedArtifact?.explicitRequiredFields?.length ?? 0) +
    (repeatedArtifact?.inferredRequiredFields?.length ?? 0);
  const contractTarget = deriveContractWordTarget({
    explicitTarget: args.targetWordCount,
    itemCount: outlineExpansion.itemCount,
    requiredFieldsPerItem,
    baselineWords: clampWordTarget(undefined),
  });
  const targetWordCount = clampWordTarget(contractTarget ?? args.targetWordCount);
  const contractWantsTable = contractRequestsTable(args.contractArtifacts, args.requestedFormats);

  // Required field NAMES must reach the drafter. Fields can be inferred by the
  // planner or edited at plan confirmation, so they may not appear anywhere in
  // the original query — the drafter would then omit them and fail
  // `adaptiveFieldCompletenessForOpportunities`, re-entering the very repair
  // loop this work order removes (Codex review, PR #205).
  const confirmedFields = Array.from(
    new Set([
      ...(repeatedArtifact?.explicitRequiredFields ?? []),
      ...(repeatedArtifact?.inferredRequiredFields ?? []),
    ].map((field) => field.trim()).filter(Boolean))
  );
  const confirmedFieldsBlock =
    confirmedFields.length > 0
      ? `Confirmed required fields for EVERY ${deriveItemLabel(repeatedArtifact, args.intentId).toLowerCase()} in this report:\n${confirmedFields
          .map((field) => `- ${field}`)
          .join('\n')}\nEvery one of these must appear for every item. Do not rename or omit them.`
      : '';
  const requestedFormatsBlock =
    Array.isArray(args.requestedFormats) && args.requestedFormats.length > 0
      ? `Requested presentation formats:\n${args.requestedFormats.map((format) => `- ${format}`).join('\n')}`
      : 'Requested presentation formats:\n- automatic / best fit';
  const sectionBudgets = distributeWordBudget(targetWordCount, activeSectionPlan);
  const outlineResponse = await callRoleModel({
    role: 'outline_architect',
    ...v2,
    messages: [
      { role: 'system', content: getSystemPrompt('outline_architect', args.isAdjudicative ?? false) },
      {
        role: 'user',
        content: `Generate a report outline for query "${args.query}".
Required sections:\n${activeSectionPlan.map((s) => `- ${s.title}`).join('\n')}
Template narrative guidance:\n${templateNarrativeHint || 'none'}
Required deliverables:\n${templateRequiredDeliverables.length > 0 ? templateRequiredDeliverables.map((d) => `- ${d}`).join('\n') : '- none'}
Intent verifier rubric:\n${templateVerifierRubric || 'none'}
${requestedFormatsBlock}
Plan:\n${JSON.stringify(args.plan, null, 2)}
Evidence:\n${args.sourceContext.slice(0, 8000)}
Specialist findings:\n${(args.specialistFindings ?? 'none').slice(0, MAX_SPECIALIST_FINDINGS_CHARS)}
Return strict JSON only.`,
      },
    ],
  });

  const outlinePayload = safeJsonParse<{ outline?: Array<{ title?: string }> }>(outlineResponse.content);
  const outline = (outlinePayload?.outline ?? [])
    .map((s) => (s.title || '').trim())
    .filter(Boolean);
  const resolvedOutline = outline.length > 0 ? outline : activeSectionPlan.map((s) => s.title);

  const sections: ReportSectionDraft[] = [];
  let rollingSummary = '';

  for (let i = 0; i < activeSectionPlan.length; i++) {
    const section = activeSectionPlan[i];
    await args.onSectionProgress?.({ title: section.title, index: i + 1, total: activeSectionPlan.length });

    const sectionTarget = sectionBudgets.get(section.key) ?? Math.round(targetWordCount / activeSectionPlan.length);
    const lengthDirective = formatLengthDirective(targetWordCount, sectionTarget, section.title);

    const sectionResult = await callRoleModel({
      role: 'section_drafter',
      ...v2,
      messages: [
        { role: 'system', content: getSystemPrompt('section_drafter', args.isAdjudicative ?? false) },
        {
          role: 'user',
          content: `Section to draft: ${section.title}
Research query: ${args.query}
Plan: ${JSON.stringify(args.plan)}
Retriever analysis: ${args.retrieverAnalysis}
Reasoning output: ${args.reasoningChains}
Skeptic output: ${args.challenges}
Specialist findings: ${args.specialistFindings ?? 'none'}
Template narrative guidance: ${templateNarrativeHint || 'none'}
${args.isAdjudicative ? '' : `\n${CLAIM_CLASS_SOURCING_BURDEN}\n`}${
            sectionExpectsTable({ title: section.title, key: section.key, contractWantsTable })
              ? TABLE_FORMATTING_RULES
              : ''
          }
${args.limitedSourcingDirective ? `\n${args.limitedSourcingDirective}\n` : ''}
${confirmedFieldsBlock}
Required deliverables for this intent:\n${templateRequiredDeliverables.length > 0 ? templateRequiredDeliverables.map((d) => `- ${d}`).join('\n') : '- none'}
Verifier rubric for this intent:\n${templateVerifierRubric || 'none'}
${requestedFormatsBlock}
Source material: ${args.sourceContext}
Rolling summary from previous sections: ${rollingSummary || 'none yet'}
${lengthDirective}
Return section body text only.`,
        },
      ],
    });

    const sectionText = sectionResult.content.trim();
    sections.push({ title: section.title, key: section.key, content: sectionText });
    rollingSummary = `${rollingSummary}\n\n[${section.title}]\n${sectionText.slice(0, MAX_SECTION_SUMMARY_CHARS)}`.slice(
      -MAX_ROLLING_SUMMARY_CHARS
    );
  }

  const challenger = args.skipChallenger
    ? { content: '', model: 'skipped-by-profile', role: 'internal_challenger', promptTokens: 0, completionTokens: 0, durationMs: 0, usedFallback: false, primaryModel: 'skipped-by-profile' }
    : await callRoleModel({
        role: 'internal_challenger',
        ...v2,
        isAdjudicative: args.isAdjudicative,
        messages: [
          { role: 'system', content: getSystemPrompt('internal_challenger', args.isAdjudicative ?? false) },
          {
            role: 'user',
            content: `Challenge this draft report for weak assumptions and unsupported jumps:
${sections
              .map((s) => `## ${s.title}
${s.content}`)
              .join('\n\n')}`,
          },
        ],
      });


  const refinement = await callRoleModel({
    role: 'coherence_refiner',
    ...v2,
    messages: [
      { role: 'system', content: getSystemPrompt('coherence_refiner', args.isAdjudicative ?? false) },
      {
        role: 'user',
        content: `Refine report text while preserving epistemic integrity.
Challenger findings:\n${challenger.content}

Draft:\n${sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n')}

${requestedFormatsBlock}

LENGTH GUIDANCE: keep the full report close to ~${targetWordCount} words. Tighten redundant phrasing but do not delete substantive evidence, claims, or counterarguments. If a section is materially under its share of the budget, extend it with substantive analysis from the challenger findings rather than padding.

Return the full revised markdown report.`,
      },
    ],
  });

  return {
    markdown: refinement.content.trim() || sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n'),
    sections,
    outline: resolvedOutline,
    targetWordCount,
  };
}
