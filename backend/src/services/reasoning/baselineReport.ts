import { baselineLayerEnabled } from '../../config';
import { readerFacingLabelHits } from '../formatting/reportPresentation';

export interface UsedSource {
  title: string;
  publisher?: string | null;
  date?: string | null;
  url?: string | null;
}

export function topicHeadings(query: string): string[] {
  const subject = query.replace(/[?]+$/g, '').replace(/^(what|when|why|how|who|where)\s+/i, '').trim();
  const topic = subject || 'the question';
  return [`How ${topic} is described`, `What the records show about ${topic}`];
}

export function readerSections(intentId: string | undefined, query = ''): Array<{ key: string; title: string; weight: number; system?: boolean }> {
  const body =
    intentId === 'survey'
      ? [
          { key: 'established', title: 'What is well established', weight: 1 },
          { key: 'contested', title: 'Where researchers disagree', weight: 1 },
          { key: 'open_questions', title: 'Open questions', weight: 1 },
        ]
      : intentId === 'how_to'
        ? [{ key: 'steps', title: 'Steps', weight: 1 }]
        : intentId === 'comparative'
          ? [{ key: 'comparison', title: 'Comparison', weight: 1 }]
          : topicHeadings(query).map((title, index) => ({ key: `topic_${index}`, title, weight: 1 }));
  return [
    { key: 'summary', title: 'Summary', weight: 1 },
    { key: 'key_findings', title: 'Key findings', weight: 1 },
    ...body,
    { key: 'limits', title: 'Limits of this report', weight: 1 },
    { key: 'references', title: 'References', weight: 1, system: true },
    { key: 'about', title: 'About this report', weight: 1, system: true },
  ];
}

export function draftedSections(intentId: string | undefined, query = ''): Array<{ key: string; title: string; weight: number }> {
  return readerSections(intentId, query).filter((section) => !section.system);
}

/** Remove a grade field or label. Ordinary words such as testimony stay. */
export function stripGradeLines(context: string): string {
  return context
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*evidence tier\s*:\s*\S+\s*$/i, '')
        .replace(/\b(?:established_fact|strong_evidence)\b:?/gi, '')
        .replace(/\[\s*(?:established_fact|strong_evidence|testimony|inference|speculation)\s*\]/gi, '')
    )
    .join('\n');
}

export function trimSummaryAtSentence(text: string, maxWords = 150): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  const cut = words.slice(0, maxWords).join(' ');
  const boundary = cut.match(/^[\s\S]*[.!?](?=\s|$)/);
  return (boundary?.[0] ?? cut).trim();
}

export function presentationFailures(text: string): string[] {
  return readerFacingLabelHits(text);
}

export function scorePresentationClean(text: string): number {
  return presentationFailures(text).length === 0 ? 1 : 0;
}

export const REQUIRED_READER_SECTIONS = ['Summary', 'Key findings', 'Limits of this report', 'References', 'About this report'];

export function scoreStructureComplete(text: string, required = REQUIRED_READER_SECTIONS): number {
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? '');
  let cursor = 0;
  for (const title of required) {
    const index = headings.findIndex((heading, position) => position >= cursor && heading === title);
    if (index === -1) return 0;
    cursor = index + 1;
  }
  const summary = text.split(/^##\s+Summary\s*$/m)[1]?.split(/^##\s+/m)[0] ?? '';
  return summary.trim().split(/\s+/).filter(Boolean).length <= 150 ? 1 : 0;
}

function proseBlocks(content: string): string[] {
  return content.split(/\n{2,}/).filter((block) => !block.trim().startsWith('```') && !block.includes('|'));
}

export function repeatedSentences(sections: Array<{ content: string }>): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const section of sections) {
    for (const block of proseBlocks(section.content)) {
      for (const sentence of block.split(/(?<=[.!?])\s+/)) {
        const key = sentence.trim().toLowerCase();
        if (key.length < 40) continue;
        if (seen.has(key)) repeated.push(sentence.trim());
        seen.add(key);
      }
    }
  }
  return repeated;
}

export function scoreNoRepetition(sections: Array<{ content: string }>): number {
  return repeatedSentences(sections).length === 0 ? 1 : 0;
}

export function removeRepeatedSentences<T extends { content: string }>(sections: T[]): T[] {
  const seen = new Set<string>();
  return sections.map((section) => {
    const blocks = section.content.split(/\n{2,}/);
    const next = blocks.map((block) => {
      if (block.trim().startsWith('```') || block.includes('|')) return block;
      return block
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          const key = sentence.trim().toLowerCase();
          if (key.length < 40) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .join(' ');
    });
    return { ...section, content: next.join('\n\n') };
  });
}

export function readerTitle(query: string, proposed: string): string {
  const title = proposed.trim();
  if (!title || title.toLowerCase() === 'framing' || title.toLowerCase() === query.trim().toLowerCase()) {
    return topicHeadings(query)[0] ?? 'Report';
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

export function buildReferences(sources: UsedSource[]): string {
  return sources
    .map((source, index) => {
      const parts = [source.publisher, source.title, source.date].filter(Boolean);
      return `${index + 1}. ${parts.join(', ')}${source.url ? ` ${source.url}` : ''}`;
    })
    .join('\n');
}

export function buildAbout(sources: UsedSource[], searched: string): string {
  return `About this report: ${searched}. ${sources.length} source${sources.length === 1 ? ' was' : 's were'} read.`;
}
