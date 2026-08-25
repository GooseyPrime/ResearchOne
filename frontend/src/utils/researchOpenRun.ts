import type { CitationStyleSlug, ResearchObjective, ResearchRun } from './api';

export type ResearchRequestFormSlice = {
  query: string;
  supplemental: string;
  filterTags: string;
  researchObjective?: ResearchObjective;
  citationStyle?: CitationStyleSlug;
  requestedFormats?: string[];
  targetWordCount?: number;
  supplementalUrlLines: string[];
};

/**
 * Map a persisted run row back into the request form.
 *
 * There used to be two of these — a "standard" slice with three fields and a
 * "deep" slice with everything — because there were two forms. One form, one
 * mapping: the fields a run row does not carry come back empty, which is the
 * same thing the narrow version did.
 */
export function researchRequestFormFromRun(run: ResearchRun): ResearchRequestFormSlice {
  const base = {
    query: run.query ?? '',
    supplemental: run.supplemental ?? '',
    filterTags: '',
  };
  const urlLines = (run.supplemental_attachments ?? [])
    .filter((a) => a.kind === 'url' && a.url)
    .map((a) => a.url as string);

  const objective = run.requested_research_objective ?? run.research_objective;
  const researchObjective =
    typeof objective === 'string' &&
    [
      'GENERAL_EPISTEMIC_RESEARCH',
      'INVESTIGATIVE_SYNTHESIS',
      'NOVEL_APPLICATION_DISCOVERY',
      'PATENT_GAP_ANALYSIS',
      'ANOMALY_CORRELATION',
    ].includes(objective)
      ? (objective as ResearchObjective)
      : undefined;

  const style = run.citation_style;
  const citationStyle =
    typeof style === 'string' && style.length > 0 ? (style as CitationStyleSlug) : undefined;
  const requestedFormats = Array.isArray((run as ResearchRun & { requested_formats?: unknown }).requested_formats)
    ? ((run as ResearchRun & { requested_formats?: unknown }).requested_formats as unknown[])
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    : undefined;
  const targetWordCount =
    typeof (run as ResearchRun & { target_word_count?: unknown }).target_word_count === 'number'
      ? ((run as ResearchRun & { target_word_count?: number }).target_word_count as number)
      : undefined;

  return {
    ...base,
    researchObjective,
    citationStyle,
    requestedFormats,
    targetWordCount,
    supplementalUrlLines: urlLines,
  };
}
