import { callRoleModel, SYSTEM_PROMPTS } from '../openrouter/openrouterService';
import type { ResearchObjective } from './reasoningModelPolicy';

export interface ReportSectionDraft {
  title: string;
  key: string;
  content: string;
}

const SECTION_PLAN: Array<{ title: string; key: string; weight: number }> = [
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

const MAX_SECTION_SUMMARY_CHARS = 1200;
const MAX_ROLLING_SUMMARY_CHARS = 6000;

/** Per-section floor — even short presets must give each section enough
 *  budget to write a coherent paragraph. The total minimum
 *  (`REPORT_WORD_COUNT_MIN`) is derived from this so the per-section floor
 *  cannot push the summed budget above what the user requested. */
export const REPORT_WORD_COUNT_PER_SECTION_FLOOR = 80;

/** Bounds for user-supplied targetWordCount. Below the floor the report is
 *  too thin to be useful; above the ceiling the section drafter starts
 *  repeating itself even with steering, so we clamp to keep output
 *  substantive. The floor equals SECTION_PLAN.length × per-section floor so
 *  the per-section budget allocator never has to overshoot the requested
 *  total to satisfy the per-section floor (Codex/Copilot PR #50 review). */
export const REPORT_WORD_COUNT_MIN = SECTION_PLAN.length * REPORT_WORD_COUNT_PER_SECTION_FLOOR;
export const REPORT_WORD_COUNT_MAX = 12000;
export const REPORT_WORD_COUNT_DEFAULT = 2200;

export function clampWordTarget(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return REPORT_WORD_COUNT_DEFAULT;
  return Math.max(REPORT_WORD_COUNT_MIN, Math.min(REPORT_WORD_COUNT_MAX, Math.round(n)));
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
 *  request within ≤ SECTION_PLAN.length words of `Math.round` slack. */
export function distributeWordBudget(totalWords: number): Map<string, number> {
  const floor = REPORT_WORD_COUNT_PER_SECTION_FLOOR;
  const flooredKeys = new Set<string>();

  // Iterate to a fixed point. Each pass may newly pin sections whose
  // redistributed share still falls below the floor.
  let changed = true;
  while (changed) {
    changed = false;
    const flooredCost = flooredKeys.size * floor;
    const remainingTotal = Math.max(0, totalWords - flooredCost);
    const remainingWeight = SECTION_PLAN
      .filter((s) => !flooredKeys.has(s.key))
      .reduce((s, sec) => s + sec.weight, 0);
    if (remainingWeight === 0) break;

    for (const sec of SECTION_PLAN) {
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
  const remainingWeight = SECTION_PLAN
    .filter((s) => !flooredKeys.has(s.key))
    .reduce((s, sec) => s + sec.weight, 0);

  const budgets = new Map<string, number>();
  for (const sec of SECTION_PLAN) {
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

export async function generateIterativeReport(args: {
  query: string;
  plan: unknown;
  evidenceContext: string;
  retrieverAnalysis: string;
  reasoningChains: string;
  challenges: string;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  /** User-requested total report length in words. Clamped to
   *  [REPORT_WORD_COUNT_MIN, REPORT_WORD_COUNT_MAX]. Falls back to
   *  REPORT_WORD_COUNT_DEFAULT if not provided. */
  targetWordCount?: number;
  onSectionProgress?: (payload: { title: string; index: number; total: number }) => void | Promise<void>;
}): Promise<{ markdown: string; sections: ReportSectionDraft[]; outline: string[]; targetWordCount: number }> {
  const v2 = {
    engineVersion: args.engineVersion,
    researchObjective: args.researchObjective,
    allowFallbackByRole: args.allowFallbackByRole,
  };
  const targetWordCount = clampWordTarget(args.targetWordCount);
  const sectionBudgets = distributeWordBudget(targetWordCount);
  const outlineResponse = await callRoleModel({
    role: 'outline_architect',
    ...v2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.outline_architect },
      {
        role: 'user',
        content: `Generate a report outline for query "${args.query}".
Required sections:\n${SECTION_PLAN.map((s) => `- ${s.title}`).join('\n')}
Plan:\n${JSON.stringify(args.plan, null, 2)}
Evidence:\n${args.evidenceContext.slice(0, 8000)}
Return strict JSON only.`,
      },
    ],
  });

  const outlinePayload = safeJsonParse<{ outline?: Array<{ title?: string }> }>(outlineResponse.content);
  const outline = (outlinePayload?.outline ?? [])
    .map((s) => (s.title || '').trim())
    .filter(Boolean);
  const resolvedOutline = outline.length > 0 ? outline : SECTION_PLAN.map((s) => s.title);

  const sections: ReportSectionDraft[] = [];
  let rollingSummary = '';

  for (let i = 0; i < SECTION_PLAN.length; i++) {
    const section = SECTION_PLAN[i];
    await args.onSectionProgress?.({ title: section.title, index: i + 1, total: SECTION_PLAN.length });

    const sectionTarget = sectionBudgets.get(section.key) ?? Math.round(targetWordCount / SECTION_PLAN.length);
    const lengthDirective = formatLengthDirective(targetWordCount, sectionTarget, section.title);

    const sectionResult = await callRoleModel({
      role: 'section_drafter',
      ...v2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.section_drafter },
        {
          role: 'user',
          content: `Section to draft: ${section.title}
Research query: ${args.query}
Plan: ${JSON.stringify(args.plan)}
Retriever analysis: ${args.retrieverAnalysis}
Reasoning output: ${args.reasoningChains}
Skeptic output: ${args.challenges}
Evidence context: ${args.evidenceContext}
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

  const challenger = await callRoleModel({
    role: 'internal_challenger',
    ...v2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.internal_challenger },
      {
        role: 'user',
        content: `Challenge this draft report for weak assumptions and unsupported jumps:\n${sections
          .map((s) => `## ${s.title}\n${s.content}`)
          .join('\n\n')}`,
      },
    ],
  });

  const refinement = await callRoleModel({
    role: 'coherence_refiner',
    ...v2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS.coherence_refiner },
      {
        role: 'user',
        content: `Refine report text while preserving epistemic integrity.
Challenger findings:\n${challenger.content}

Draft:\n${sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n')}

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
