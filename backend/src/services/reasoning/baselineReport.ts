import { baselineLayerEnabled } from '../../config';

export const READER_SECTION_ORDER = [
  'summary',
  'key_findings',
  'body',
  'disagreement',
  'limits',
  'references',
  'about',
] as const;

const READER_HEADINGS: Record<(typeof READER_SECTION_ORDER)[number], string> = {
  summary: 'Summary',
  key_findings: 'Key findings',
  body: 'What the sources report',
  disagreement: 'Where sources disagree',
  limits: 'Limits of this report',
  references: 'References',
  about: 'About this report',
};

const SURVEY_HEADINGS: Record<string, string> = {
  established: 'What is well established',
  contested: 'Where researchers disagree',
  hypothesized: 'Open questions',
  lore: 'What is repeated without a primary record',
  open_questions: 'Open questions',
};

const FORBIDDEN = [
  'established_fact',
  'strong_evidence',
  'testimony',
  'inference',
  'speculation',
  'under_review',
  'plan_pending_confirmation',
  'verdict',
  'case for',
  'case against',
  'falsified',
  'adjudicate',
  'this report synthesizes evidence',
];

export function readerSections(intentId: string | undefined): Array<{ key: string; title: string; weight: number }> {
  if (intentId === 'survey') {
    return [
      { key: 'summary', title: 'Summary', weight: 1 },
      { key: 'established', title: SURVEY_HEADINGS.established, weight: 1 },
      { key: 'contested', title: SURVEY_HEADINGS.contested, weight: 1 },
      { key: 'hypothesized', title: SURVEY_HEADINGS.hypothesized, weight: 1 },
      { key: 'limits', title: 'Limits of this report', weight: 1 },
      { key: 'about', title: 'About this report', weight: 1 },
    ];
  }
  if (intentId === 'how_to') {
    return [
      { key: 'summary', title: 'Summary', weight: 1 },
      { key: 'steps', title: 'Steps', weight: 1 },
      { key: 'limits', title: 'Limits of this report', weight: 1 },
      { key: 'about', title: 'About this report', weight: 1 },
    ];
  }
  if (intentId === 'comparative') {
    return [
      { key: 'summary', title: 'Summary', weight: 1 },
      { key: 'comparison', title: 'Comparison', weight: 1 },
      { key: 'limits', title: 'Limits of this report', weight: 1 },
      { key: 'about', title: 'About this report', weight: 1 },
    ];
  }
  return READER_SECTION_ORDER.map((key) => ({ key, title: READER_HEADINGS[key], weight: 1 }));
}

export function stripGradeLines(context: string): string {
  return context
    .split('\n')
    .filter((line) => !/evidence tier|established_fact|strong_evidence|testimony|inference|speculation/i.test(line))
    .join('\n');
}

export function capSummary(text: string, maxWords = 150): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(' ');
}

export function presentationFailures(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN.filter((word) => lower.includes(word));
}

export function scorePresentationClean(text: string): number {
  return presentationFailures(text).length === 0 ? 1 : 0;
}

export function scoreStructureComplete(text: string): number {
  const hasTitle = /^#\s+\S/m.test(text);
  const hasSummary = /^##\s+Summary/m.test(text);
  const summary = text.split(/^##\s+/m)[1] ?? '';
  const words = summary.split(/\s+/).filter(Boolean).length;
  return hasTitle && hasSummary && words <= 150 ? 1 : 0;
}

export function repeatedSentences(sections: Array<{ content: string }>): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const section of sections) {
    for (const sentence of section.content.split(/(?<=[.!?])\s+/)) {
      const key = sentence.trim().toLowerCase();
      if (key.length < 40) continue;
      if (seen.has(key)) repeated.push(sentence.trim());
      seen.add(key);
    }
  }
  return repeated;
}

export function scoreNoRepetition(sections: Array<{ content: string }>): number {
  return repeatedSentences(sections).length === 0 ? 1 : 0;
}

export function removeRepeatedSentences(sections: Array<{ title: string; key: string; content: string }>): Array<{ title: string; key: string; content: string }> {
  const seen = new Set<string>();
  return sections.map((section) => {
    const kept = section.content.split(/(?<=[.!?])\s+/).filter((sentence) => {
      const key = sentence.trim().toLowerCase();
      if (key.length < 40) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...section, content: kept.join(' ') };
  });
}

export function readerTitle(query: string, proposed: string): string {
  const title = proposed.trim();
  if (!title || title.toLowerCase() === 'framing' || title.toLowerCase() === query.trim().toLowerCase()) {
    return 'What the sources report';
  }
  return title;
}

export function wordFloor(intentId: string | undefined): number {
  if (baselineLayerEnabled() && (intentId === 'factual_report' || intentId === 'how_to')) return 120;
  return 400;
}

export function plainQuestionIntent(classifierFailed: boolean, unsure: boolean): 'factual_report' | null {
  if (!baselineLayerEnabled()) return null;
  if (classifierFailed || unsure) return 'factual_report';
  return null;
}

export function lookupNeedsDiscovery(corpusEmpty: boolean): boolean {
  return baselineLayerEnabled() && corpusEmpty;
}

export function scoreReportQuality(text: string): number {
  let score = 1;
  if (/^##\s+Summary/m.test(text)) score += 1;
  if (/^##\s+Key findings/m.test(text)) score += 1;
  if (!presentationFailures(text).length) score += 1;
  if (text.split(/\s+/).length < 2000) score += 1;
  return score;
}
