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
  /** The providers whose results the run went on to consider. A provider that returned nothing new is not in the record. */
  providers: string[];
  /** Results left to consider once duplicates and off-topic results were set aside. */
  considered: number;
  /**
   * Results chosen to be read: queued to be fetched and stored for this run.
   * Discovery marks a result when it queues it, so one whose fetch later failed
   * is still counted here. How many sources were in fact read is the closing
   * note's own count, which comes from the passages the run retrieved.
   */
  chosen: number;
  /** Results the library already held from earlier research. */
  reused: number;
  /** Results chosen although they matched the question only loosely, to give the run enough sources. */
  looselyMatched: number;
}

/** The part of a discovery summary this reads. A skipped stage records a number where the list would be. */
export interface SearchPassSummary {
  queriesExecuted?: unknown;
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

/** One record from every search pass a run made: the first search, a targeted second one, a search the material check asked for. */
export function mergeSearchRecords(summaries: ReadonlyArray<SearchPassSummary | null | undefined>): SearchRecord {
  const queries: string[] = [];
  const providers: string[] = [];
  const seenQueries = new Set<string>();
  let considered = 0;
  let chosen = 0;
  let reused = 0;
  let looselyMatched = 0;
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
    if (!Array.isArray(summary.sources)) continue;
    for (const entry of summary.sources) {
      if (!entry || typeof entry !== 'object') continue;
      const source = entry as { provider?: unknown; ingested?: unknown; skipReason?: unknown; selectionRationale?: unknown };
      considered += 1;
      if (typeof source.provider === 'string' && source.provider.trim() && !providers.includes(source.provider.trim())) providers.push(source.provider.trim());
      if (source.ingested === true) {
        chosen += 1;
        // Discovery records a result it kept only to give the run enough sources.
        if (typeof source.selectionRationale === 'string' && source.selectionRationale.includes('off-topic')) looselyMatched += 1;
      } else if (source.skipReason === 'already_in_corpus') {
        reused += 1;
      }
    }
  }
  return { queries, providers, considered, chosen, reused, looselyMatched };
}

/** Where each provider's results come from, in the name a reader would know. Several providers search the open web. */
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

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The statement itself. Empty when the run recorded no search, so a report is
 * never given a sentence about a search that did not happen. Each sentence says
 * only what the record holds: the queries run, where the results that were
 * considered came from, the order they were taken in, and what became of them.
 */
export function describeSearchScope(record: SearchRecord): string {
  if (record.queries.length === 0) return '';
  const total = record.queries.length;
  const shown = record.queries.map(showableQuery).filter((query): query is string => query !== null).slice(0, QUERIES_SHOWN);
  const terms =
    shown.length === 0
      ? ''
      : shown.length === total
        ? `: ${shown.map((query) => `“${query}”`).join('; ')}`
        : `, among them ${shown.map((query) => `“${query}”`).join('; ')}`;
  const sentences = [`The search used ${plural(total, 'query', 'queries')}${terms}.`];
  if (record.considered <= 0) return sentences[0];
  const places: string[] = [];
  for (const provider of record.providers) {
    const place = PLACE_BY_PROVIDER[provider.toLowerCase()];
    if (place && !places.includes(place)) places.push(place);
  }
  if (places.length > 0) sentences.push(`The results considered came from ${listInWords(places)}.`);
  const outcome: string[] = [];
  if (record.chosen > 0) outcome.push(`${record.chosen} ${record.chosen === 1 ? 'was' : 'were'} chosen to be read`);
  if (record.reused > 0) outcome.push(`${record.reused} ${record.reused === 1 ? 'was' : 'were'} already held from earlier research`);
  sentences.push(
    `Results were ranked by how closely they matched the question, and the closest were taken first. ${
      outcome.length > 0 ? `Of ${plural(record.considered, 'result', 'results')} considered, ${outcome.join(' and ')}.` : `${plural(record.considered, 'result was', 'results were')} considered.`
    }`
  );
  if (record.looselyMatched > 0) {
    sentences.push(
      `${record.looselyMatched} of those chosen matched the question only loosely and ${record.looselyMatched === 1 ? 'was' : 'were'} kept so that the report had enough sources to draw on.`
    );
  }
  return sentences.join(' ');
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

const CLOSING_HEADING = /^## About this report[ \t]*$/gm;

/**
 * The last "About this report" section: where its heading starts, where its
 * text begins, and where it ends, which is the next heading or the end of the
 * report. A repair can append a section after the closing note, and that
 * section is not part of the note.
 */
function closingNoteAt(markdown: string): { heading: number; body: number; end: number } | null {
  let last: RegExpExecArray | null = null;
  for (const match of markdown.matchAll(CLOSING_HEADING)) last = match;
  if (!last) return null;
  const body = last.index + last[0].length;
  const next = /^#{1,6}[ \t]+\S/m.exec(markdown.slice(body));
  return { heading: last.index, body, end: next ? body + next.index : markdown.length };
}

/**
 * The text of the closing note as code wrote it, taken from a report before any
 * model is handed that report to rewrite. Empty when the report has no closing
 * note. This is what a later rewrite is held to.
 */
export function closingNoteOf(markdown: string): string {
  const at = closingNoteAt(markdown);
  return at ? markdown.slice(at.body, at.end).trim() : '';
}

/**
 * The report with its closing note as code wrote it. The note is code's, not
 * the writer's: without the citation lock a redraft or a repair is handed the
 * whole report and can return the note reworded, replaced with a statement that
 * no sources were used, or gone with its heading. Whatever came back, the note
 * is put back from `writtenNote`, the text taken before any rewrite, and not
 * worked out from what the rewrite left. Only the note's own text is replaced;
 * a section that follows it is kept; a report whose note is gone gets it back
 * at the end. With nothing to hold the report to, the text is returned as it is.
 */
export function withClosingNoteRestored(markdown: string, writtenNote: string): string {
  if (!writtenNote) return markdown;
  const at = closingNoteAt(markdown);
  if (!at) return `${markdown.trimEnd()}\n\n## About this report\n${writtenNote}`;
  if (markdown.slice(at.body, at.end).trim() === writtenNote) return markdown;
  const rest = markdown.slice(at.end);
  return `${markdown.slice(0, at.body)}\n${writtenNote}${rest ? `\n\n${rest}` : ''}`;
}

const AUDIT_GAP = '\n\n[Part of the report is left out here for length.]\n\n';

/**
 * The report as the contract check is given it, inside a size limit. The
 * statement of what was searched is in the closing note, near the very end, so
 * a long report cut at the limit would lose exactly what the check looks for.
 * When there is a statement, the report is cut earlier and the closing note is
 * given after the cut. With none, the report is cut at the limit as before.
 */
export function boundedReportForAudit(markdown: string, limit: number, scopeNote: string): string {
  if (!scopeNote || markdown.length <= limit) return markdown.slice(0, limit);
  const at = closingNoteAt(markdown);
  const closing = at ? markdown.slice(at.heading, at.end).trimEnd() : '';
  if (!closing || closing.length + AUDIT_GAP.length >= limit / 2) return markdown.slice(0, limit);
  return `${markdown.slice(0, limit - closing.length - AUDIT_GAP.length)}${AUDIT_GAP}${closing}`;
}
