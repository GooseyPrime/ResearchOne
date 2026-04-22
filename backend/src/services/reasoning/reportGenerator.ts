import { callRoleModel, SYSTEM_PROMPTS } from '../openrouter/openrouterService';
import type { ResearchObjective } from './reasoningModelPolicy';

export interface ReportSectionDraft {
  title: string;
  key: string;
  content: string;
}

const SECTION_PLAN: Array<{ title: string; key: string }> = [
  { title: 'Executive Summary', key: 'executive_summary' },
  { title: 'Research Question and Scope', key: 'research_question_scope' },
  { title: 'Evidence Ledger', key: 'evidence_ledger' },
  { title: 'Reasoning and Analysis', key: 'reasoning_analysis' },
  { title: 'Contradiction Analysis', key: 'contradiction_analysis' },
  { title: 'Challenges and Alternative Explanations', key: 'challenges_alternatives' },
  { title: 'Synthesis and Conclusions', key: 'synthesis_conclusions' },
  { title: 'Falsification Criteria', key: 'falsification_criteria' },
  { title: 'Unresolved Questions', key: 'unresolved_questions' },
  { title: 'Recommended Next Queries', key: 'recommended_next_queries' },
];

const MAX_SECTION_SUMMARY_CHARS = 1200;
const MAX_ROLLING_SUMMARY_CHARS = 6000;

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
  onSectionProgress?: (payload: { title: string; index: number; total: number }) => void | Promise<void>;
}): Promise<{ markdown: string; sections: ReportSectionDraft[]; outline: string[] }> {
  const v2 = {
    engineVersion: args.engineVersion,
    researchObjective: args.researchObjective,
    allowFallbackByRole: args.allowFallbackByRole,
  };
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

Return the full revised markdown report.`,
      },
    ],
  });

  return {
    markdown: refinement.content.trim() || sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n'),
    sections,
    outline: resolvedOutline,
  };
}
