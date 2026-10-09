/**
 * The relevance check after retrieval, before any passage reaches the reasoner
 * or the report.
 *
 * The corpus is shared: every run's sources are stored in it and every later
 * run searches all of it. A passage can therefore come back for a question it
 * has nothing to do with, because it shares vocabulary with the retrieval
 * query. Discovery's check (`discovery/relevanceGate.ts`) only sees what this
 * run found; this one sees what retrieval actually returned.
 *
 * A document this run already judged with a model keeps its verdict. Any other
 * document is judged now, from its title, address and the start of its best
 * passage. Passages of a document judged off-topic for this run are left out.
 * The document stays in the corpus for the runs it does belong to.
 *
 * Files and links the person attached to this run are never left out: they
 * chose them for this question.
 */
import { logger } from '../../utils/logger';
import { recordDiscoveryEvent } from '../discovery/discoveryEvents';
import {
  documentKey,
  judgeRelevance,
  relevanceGateEnabled,
  rememberVerdict,
  verdictFor,
  type NotUsedReason,
  type RelevanceBasis,
  type RelevanceItem,
  type RelevanceModelArgs,
} from '../discovery/relevanceGate';
import type { RetrievedChunk } from './retrievalService';

export interface RetrievalRelevanceReport {
  /** Documents sent to the judge in this check. */
  documentsJudged: number;
  documentsExcluded: number;
  passagesExcluded: number;
  /** Documents no model could judge; shared vocabulary decided them. */
  decidedWithoutModel: number;
  failureKinds: string[];
  /** Every passage kept in this check, from every document. */
  passagesKept: number;
}

export interface RunRelevanceScope {
  runId: string;
  /** The question the run is answering. Not a retrieval query. */
  researchQuery: string;
  model: RelevanceModelArgs;
  /** Told when a check set something aside or could not use a model, so the run's trace can say so. */
  onChecked?: (report: RetrievalRelevanceReport) => void | Promise<void>;
}

/** Documents each run's retrieval check has set aside, by run. Bounded like the verdicts it sits beside. */
const SET_ASIDE_BY_RUN = new Map<string, Set<string>>();
const MAX_TRACKED_RUNS = 200;

function noteSetAside(runId: string, key: string): void {
  let keys = SET_ASIDE_BY_RUN.get(runId);
  if (!keys) {
    keys = new Set();
    SET_ASIDE_BY_RUN.set(runId, keys);
    if (SET_ASIDE_BY_RUN.size > MAX_TRACKED_RUNS) {
      const oldest = SET_ASIDE_BY_RUN.keys().next().value;
      if (oldest !== undefined) SET_ASIDE_BY_RUN.delete(oldest);
    }
  }
  keys.add(key);
}

/** How many stored documents this run's retrieval check has set aside so far. */
export function documentsSetAsideAtRetrieval(runId: string): number {
  return SET_ASIDE_BY_RUN.get(runId)?.size ?? 0;
}

/** Tests start each case clean. */
export function forgetRetrievalTally(runId?: string): void {
  if (runId === undefined) SET_ASIDE_BY_RUN.clear();
  else SET_ASIDE_BY_RUN.delete(runId);
}

/**
 * Did the relevance check, and nothing else, leave the run short of sources?
 *
 * True when the run has fewer sources than its plan asked for and would have
 * had enough had the set-aside documents counted. Then one more search is
 * worth its cost: the run found enough, but part of it was about something
 * else. A run that was short anyway is left to the checks that already decide
 * that case.
 */
export function relevanceCheckCausedShortfall(args: { usableSources: number; setAside: number; minimum: number | null | undefined }): boolean {
  const minimum = typeof args.minimum === 'number' && Number.isFinite(args.minimum) ? args.minimum : 0;
  if (minimum <= 0 || args.setAside <= 0) return false;
  return args.usableSources < minimum && args.usableSources + args.setAside >= minimum;
}

function attachedToThisRun(chunk: RetrievedChunk, runId: string): boolean {
  return (
    chunk.source_discovered_by_run_id === runId &&
    (chunk.source_origin === 'user_upload' || chunk.source_origin === 'user_supplied_url')
  );
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The passages that belong in this run, in the order given. Never throws: a
 * failure inside the check leaves out only what no verdict supports and is
 * logged, so retrieval itself still returns.
 */
export async function keepRelevantForRun(scope: RunRelevanceScope, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  if (!relevanceGateEnabled() || chunks.length === 0) return chunks;

  const keyOf = (chunk: RetrievedChunk) => documentKey(chunk.source_url, chunk.source_title);
  // The best passage of each document that still needs a verdict from a model.
  const toJudge = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) {
    if (attachedToThisRun(chunk, scope.runId)) continue;
    const key = keyOf(chunk);
    if (verdictFor(scope.runId, key)?.basis === 'model') continue;
    const best = toJudge.get(key);
    if (!best || chunk.similarity > best.similarity) toJudge.set(key, chunk);
  }

  let decidedWithoutModel = 0;
  let failureKinds: string[] = [];
  if (toJudge.size > 0) {
    const items: RelevanceItem[] = [...toJudge.entries()].map(([key, chunk]) => ({
      key,
      title: chunk.source_title || chunk.source_url || 'Untitled source',
      url: chunk.source_url || '',
      source: chunk.source_publisher || siteOf(chunk.source_url || ''),
      excerpt: chunk.content,
    }));
    const judged = await judgeRelevance({ runId: scope.runId, researchQuery: scope.researchQuery, items, model: scope.model });
    for (const [key, verdict] of judged.verdicts) rememberVerdict(scope.runId, key, verdict);
    decidedWithoutModel = judged.decidedWithoutModel;
    failureKinds = judged.failureKinds;
  }

  const kept: RetrievedChunk[] = [];
  const excluded = new Map<string, { url: string; title: string; reason: NotUsedReason | null; basis: RelevanceBasis; why: string; passages: number }>();
  for (const chunk of chunks) {
    if (attachedToThisRun(chunk, scope.runId)) {
      kept.push(chunk);
      continue;
    }
    const key = keyOf(chunk);
    const verdict = verdictFor(scope.runId, key);
    // No verdict cannot happen: every document without one was just judged, and
    // the judge returns a verdict for every item. If it ever does, the passage
    // is left out rather than passed through unchecked.
    if (verdict?.relevant) {
      kept.push(chunk);
      continue;
    }
    const entry = excluded.get(key) ?? {
      url: chunk.source_url || '',
      title: chunk.source_title || '',
      reason: verdict?.reason ?? 'off_topic',
      basis: verdict?.basis ?? 'word_overlap',
      why: verdict?.note ?? '',
      passages: 0,
    };
    entry.passages += 1;
    excluded.set(key, entry);
    noteSetAside(scope.runId, key);
  }

  // Only what this check decided is recorded and announced. A document set
  // aside earlier in the run is already on the record; listing it again for
  // every retrieval query would bury the record in repeats.
  const newlyExcluded = [...excluded.entries()].filter(([key]) => toJudge.has(key)).map(([, entry]) => entry);
  const report: RetrievalRelevanceReport = {
    documentsJudged: toJudge.size,
    documentsExcluded: newlyExcluded.length,
    passagesExcluded: chunks.length - kept.length,
    decidedWithoutModel,
    failureKinds,
    passagesKept: kept.length,
  };
  if (newlyExcluded.length > 0 || decidedWithoutModel > 0) {
    logger.info(
      `[relevance:${scope.runId}] retrieval check: ${report.documentsJudged} document(s) judged, ` +
        `${report.documentsExcluded} set aside` +
        (decidedWithoutModel > 0 ? `, ${decidedWithoutModel} decided without a model` : '')
    );
    await recordDiscoveryEvent(scope.runId, 'relevance_retrieval', 'judge', scope.researchQuery, toJudge.size, toJudge.size - newlyExcluded.length, {
      judged: report.documentsJudged,
      not_used: newlyExcluded.map((entry) => ({
        url: entry.url,
        title: entry.title,
        reason: entry.reason,
        decided_by: entry.basis,
        why: entry.why,
        passages: entry.passages,
      })),
      ...(decidedWithoutModel > 0 ? { decided_without_model: decidedWithoutModel, failure_kinds: failureKinds } : {}),
    });
    try {
      await scope.onChecked?.(report);
    } catch {
      /* the trace line is an addition; the check has already been applied and recorded */
    }
  }
  return kept;
}
