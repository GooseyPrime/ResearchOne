import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { config } from '../../config';

export interface ReportSectionDraft {
  title: string;
  key: string;
  content: string;
}

const SECTION_PLAN = [
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

function getTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && 'text' in entry && typeof (entry as { text?: unknown }).text === 'string') {
          return (entry as { text: string }).text;
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

export async function generateIterativeReport(args: {
  query: string;
  plan: unknown;
  evidenceContext: string;
  retrieverAnalysis: string;
  reasoningChains: string;
  challenges: string;
  onSectionProgress?: (payload: { title: string; index: number; total: number }) => void | Promise<void>;
}): Promise<{ markdown: string; sections: ReportSectionDraft[]; outline: string[] }> {
  const model = new ChatOpenAI({
    model: config.models.synthesizer,
    apiKey: config.openrouter.apiKey,
    configuration: { baseURL: `${config.openrouter.baseUrl}` },
    maxTokens: 2200,
    temperature: 0.35,
  });

  const outlineResponse = await model.invoke([
    new SystemMessage('You build concise report outlines for disciplined research writing. Output JSON array of section headings only.'),
    new HumanMessage(`Generate an outline for this report.\nQuery: ${args.query}\nUse these sections as required:\n${SECTION_PLAN.map((s) => `- ${s.title}`).join('\n')}`),
  ]);

  let outline = SECTION_PLAN.map((s) => s.title);
  try {
    const parsed = JSON.parse(getTextContent(outlineResponse.content));
    if (Array.isArray(parsed) && parsed.length > 0) {
      outline = parsed.map((item) => String(item));
    }
  } catch {
    // keep default
  }

  const sections: ReportSectionDraft[] = [];
  let rollingSummary = '';

  for (let i = 0; i < SECTION_PLAN.length; i++) {
    const section = SECTION_PLAN[i];
    await args.onSectionProgress?.({ title: section.title, index: i + 1, total: SECTION_PLAN.length });

    const sectionResult = await model.invoke([
      new SystemMessage(
        'Write one report section only. Stay evidence-bounded. No hidden reasoning. Use clear analytical prose and mark uncertainty explicitly.'
      ),
      new HumanMessage(
        `Section to write: ${section.title}
Research query: ${args.query}
Plan: ${JSON.stringify(args.plan)}
Retriever analysis: ${args.retrieverAnalysis}
Reasoning output: ${args.reasoningChains}
Skeptic output: ${args.challenges}
Evidence context: ${args.evidenceContext}
Rolling summary from previous sections: ${rollingSummary || 'none yet'}
Return only section body text.`
      ),
    ]);

    const sectionText = getTextContent(sectionResult.content).trim();
    sections.push({ title: section.title, key: section.key, content: sectionText });

    rollingSummary = `${rollingSummary}\n\n[${section.title}]\n${sectionText.slice(0, MAX_SECTION_SUMMARY_CHARS)}`.slice(-MAX_ROLLING_SUMMARY_CHARS);
  }

  const skepticReview = await model.invoke([
    new SystemMessage('You are the final skeptic reviewer. Return concise critique points as markdown bullet list.'),
    new HumanMessage(`Review these draft sections for overreach and weak support:\n${sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n')}`),
  ]);
  const skepticNotes = getTextContent(skepticReview.content).trim();

  const refinement = await model.invoke([
    new SystemMessage('Refine report text without adding new facts; preserve section structure.'),
    new HumanMessage(`Refine this report and append a short "Verifier Notes" section based on critique.\nCritique:\n${skepticNotes}\n\nDraft:\n${sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n')}`),
  ]);
  const refinedText = getTextContent(refinement.content).trim();

  return {
    markdown: refinedText || sections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n'),
    sections,
    outline,
  };
}
