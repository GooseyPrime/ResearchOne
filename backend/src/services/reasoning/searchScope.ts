/**
 * What a run searched, said in a sentence or two for the closing note of a
 * report whose own rules ask for a stated scope and search method.
 *
 * The fault this closes: a literature review is checked for "stated scope and
 * search methodology", and the check fails a review whose search scope is
 * unstated. On a Layer 1 run nothing could state it. The section writer is shown
 * passages and may say only what they support, and no passage describes this
 * run's search; the closing note, which code writes, gave a source count and a
 * date. With the citation lock on, a repair may only cut, so it could not add
 * the statement either. The review ended failed with a sound, cited report.
 *
 * The statement is a fact about the run, so it is written from the run's own
 * record and never by a model.
 */
import { getIntentOutputTemplate } from '../formatting/templates/intentOutputTemplates';
import { presentationFailures } from './baselineReport';

/** What discovery recorded, over every search pass of one run. */
export interface SearchRecord {
  /** The search queries that were run, in order, without repeats. */
  queries: string[];
  /** The providers that returned a result the run considered. */
  providers: string[];
  /** Results considered after off-topic ones were set aside. */
  found: number;
  /** Results chosen to be read. */
  selected: number;
}

/** The part of a discovery summary this reads. A skipped stage records a number where the list would be. */
export interface SearchPassSummary {
  queriesExecuted?: unknown;
  candidatesFound?: unknown;
  candidatesSelected?: unknown;
  sources?: unknown;
}

/** A required deliverable that asks the report to state its own search. */
const SEARCH_SCOPE_DELIVERABLE = /\bsearch (?:methodology|method|strategy|scope)\b/i;

/**
 * Whether the report type's own rules require the report to say what was
 * searched. Read from the deliverables the type declares, so the statement is
 * written exactly where a check will ask for it.
 */
export function reportStatesSearchScope(intentId: string | null | undefined): boolean {
  if (!intentId) return false;
  const template = getIntentOutputTemplate(`intent_${intentId}`);
  return template.intentId === intentId && template.requiredDeliverables.some((deliverable) => SEARCH_SCOPE_DELIVERABLE.test(deliverable));
}

/**
 * The closing note with the statement in front of it, so the note reads search,
 * then sources read. A report that used no sources says only that.
 */
export function withSearchScope(about: string, scopeNote: string, readCount: number): string {
  return scopeNote && readCount > 0 ? `${scopeNote} ${about}` : about;
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** One record from every search pass a run made: the first search, a targeted second one, a search the material check asked for. */
export function mergeSearchRecords(summaries: ReadonlyArray<SearchPassSummary | null | undefined>): SearchRecord {
  const queries: string[] = [];
  const providers: string[] = [];
  const seenQueries = new Set<string>();
  let found = 0;
  let selected = 0;
  for (const summary of summaries) {
    if (!summary) continue;
    if (Array.isArray(summary.queriesExecuted)) {
      for (const raw of summary.queriesExecuted) {
        if (typeof raw !== 'string') continue;
        const text = raw.replace(/\s+/g, ' ').trim();
        const key = text.toLowerCase();
        if (!text || seenQueries.has(key)) continue;
        seenQueries.add(key);
        queries.push(text);
      }
    }
    if (Array.isArray(summary.sources)) {
      for (const source of summary.sources) {
        const provider = (source as { provider?: unknown } | null)?.provider;
        if (typeof provider === 'string' && provider.trim() && !providers.includes(provider.trim())) providers.push(provider.trim());
      }
    }
    found += count(summary.candidatesFound);
    selected += count(summary.candidatesSelected);
  }
  return { queries, providers, found, selected };
}

/** Where each provider searches, in the name a reader would know. Several providers search the open web. */
const PLACE_BY_PROVIDER: Readonly<Record<string, string>> = {
  tavily: 'the open web',
  brave: 'the open web',
  generic: 'the open web',
  parallel: 'the open web',
  arxiv: 'arXiv',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  pmc: 'PubMed Central',
  scite: 'Scite',
  clinicaltrials: 'ClinicalTrials.gov',
  uspto: 'United States patent records',
};

function listInWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const QUERIES_SHOWN = 5;
const QUERY_MAX_CHARS = 120;

/**
 * A query as it can be shown: one line, no characters that Markdown or the
 * citation numbering would read as something else. A query that carries wording
 * the reader standard does not allow is not shown; it is still counted.
 */
function showableQuery(query: string): string | null {
  // Read as written first: taking the underscore out of a grade label would hide it from the check.
  if (presentationFailures(query).length > 0) return null;
  const text = query
    .replace(/[[\]`*_#<>|]/g, ' ')
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 3) return null;
  const shown = text.length > QUERY_MAX_CHARS ? `${text.slice(0, QUERY_MAX_CHARS).replace(/\s+\S*$/, '')}…` : text;
  return presentationFailures(shown).length === 0 ? shown : null;
}

/**
 * The statement itself. Empty when the run recorded no search, so a report is
 * never given a sentence about a search that did not happen.
 */
export function describeSearchScope(record: SearchRecord): string {
  if (record.queries.length === 0) return '';
  const places: string[] = [];
  for (const provider of record.providers) {
    const place = PLACE_BY_PROVIDER[provider.toLowerCase()];
    if (place && !places.includes(place)) places.push(place);
  }
  const total = record.queries.length;
  const shown = record.queries.map(showableQuery).filter((query): query is string => query !== null).slice(0, QUERIES_SHOWN);
  const where = places.length > 0 ? `The search covered ${listInWords(places)}` : 'The search ran';
  const terms =
    shown.length === 0
      ? ''
      : shown.length === total
        ? `: ${shown.map((query) => `“${query}”`).join('; ')}`
        : `, among them ${shown.map((query) => `“${query}”`).join('; ')}`;
  const first = `${where} with ${total} ${total === 1 ? 'query' : 'queries'}${terms}.`;
  if (record.found <= 0 || record.selected <= 0 || record.selected > record.found) return first;
  const results = `It returned ${record.found} ${record.found === 1 ? 'result' : 'results'} on the subject, of which ${record.selected} ${record.selected === 1 ? 'was' : 'were'} chosen to be read for ${record.selected === 1 ? 'its' : 'their'} bearing on the question.`;
  return `${first} ${results}`;
}

/**
 * The statement for one run, or nothing. Written only for a Layer 1 report whose
 * type requires it; every other run gets an empty string and its report is what
 * it was.
 */
export function searchScopeNoteFor(args: {
  layer1Run: boolean;
  intentId: string | null | undefined;
  summaries: ReadonlyArray<SearchPassSummary | null | undefined>;
}): string {
  if (!args.layer1Run || !reportStatesSearchScope(args.intentId)) return '';
  return describeSearchScope(mergeSearchRecords(args.summaries));
}

/** Told to the section writer when the closing note will carry the statement. */
export const SEARCH_SCOPE_WRITER_RULE =
  ' What was searched and how sources were chosen is stated in a closing note that is added after your text, from the record of this research. Do not describe a search, name a database searched, or state inclusion criteria yourself.';

/**
 * Told to the checks that read the finished report. The note is not the
 * writer's: the checks are told where the statement is and where it comes from.
 */
export function searchScopeGateContext(scopeNote: string): string {
  return scopeNote
    ? 'The closing section "About this report" is written from the record of this research, not by the writer. It is the report\'s statement of what was searched and how sources were chosen.\n\n'
    : '';
}
