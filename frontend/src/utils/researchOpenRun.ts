import type { CitationStyleSlug, ResearchObjective, ResearchRun } from './api';
import { isInFlightRunStatus } from './researchRuns';

/** Run is actively tracked on the research page (trace + plan gate), not draft-only view. */
export function isLiveAttachedResearchRun(status: string | undefined | null): boolean {
  return isInFlightRunStatus(status ?? '');
}

export type ResearchRequestFormSlice = {
  query: string;
  supplemental: string;
  filterTags: string;
};

/** Map a persisted run row into the standard research request form fields. */
export function researchRequestFromRun(run: ResearchRun): ResearchRequestFormSlice {
  return {
    query: run.query ?? '',
    supplemental: run.supplemental ?? '',
    filterTags: '',
  };
}

export type DeepResearchRequestFormSlice = ResearchRequestFormSlice & {
  researchObjective?: ResearchObjective;
  citationStyle?: CitationStyleSlug;
  supplementalUrlLines: string[];
};

/** Map a persisted run row into Deep Research form fields (query + V2 options). */
export function deepResearchRequestFromRun(run: ResearchRun): DeepResearchRequestFormSlice {
  const base = researchRequestFromRun(run);
  const urlLines = (run.supplemental_attachments ?? [])
    .filter((a) => a.kind === 'url' && a.url)
    .map((a) => a.url as string);

  const objective = run.research_objective;
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

  return {
    ...base,
    researchObjective,
    citationStyle,
    supplementalUrlLines: urlLines,
  };
}
