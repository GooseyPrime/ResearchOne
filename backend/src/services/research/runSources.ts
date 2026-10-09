/**
 * The sources a run actually used, and the ones it did not.
 *
 * "Used" means the run worked from at least one passage of the source, or its
 * report cites it. A source that discovery fetched for the run and that no
 * passage was ever taken from is not one of the run's sources, and listing it
 * beside the report as if it were is how unrelated documents came to look like
 * the report's evidence.
 *
 * Every list a person sees (the dossier's Sources tab, a run's collected
 * sources) is built from `usedByRun`. What was left out is available only to
 * the diagnostics view, through `notUsedByRun`, with the reason in plain words.
 */
import { query, queryOne } from '../../db/pool';
import { NOT_USED_LABEL, notUsedLabel, type NotUsedReason } from '../discovery/relevanceGate';

export interface RunSourceRow {
  source_id: string;
  title: string | null;
  url: string | null;
  source_type: string | null;
  tags: string[] | null;
  ingested_at: string | null;
  discovered_by_run_id: string | null;
  fetch_method: string | null;
  ingestion_status: string | null;
  chunk_count: number | null;
  /** The run worked from at least one passage of this source. */
  used_passage: boolean;
  cited_in_report: boolean;
  /** A file or link the person attached to this run. */
  attached_by_user: boolean;
}

export interface RunSources {
  rows: RunSourceRow[];
  /** Whether the run has recorded the passages it worked from yet. */
  retrievalRecorded: boolean;
}

/**
 * Every source tied to the run in any way: fetched for it, attached to it, a
 * passage of it used, or cited by its report. Each row says which.
 */
export async function loadRunSources(runId: string, reportId: string | null): Promise<RunSources> {
  const run = await queryOne<{ recorded: boolean }>(
    `SELECT retrieval_ids IS NOT NULL AS recorded FROM research_runs WHERE id = $1::uuid`,
    [runId]
  );
  const rows = await query<RunSourceRow>(
    `WITH passages AS (
       SELECT DISTINCT c.source_id
         FROM research_runs r
         JOIN chunks c ON c.id = ANY(r.retrieval_ids)
        WHERE r.id = $1::uuid AND c.source_id IS NOT NULL
     ),
     cited AS (
       SELECT DISTINCT COALESCE(rc.source_id, c.source_id) AS source_id
         FROM report_citations rc
         LEFT JOIN chunks c ON c.id = rc.chunk_id
        WHERE $2::uuid IS NOT NULL AND rc.report_id = $2::uuid
     ),
     -- What the person attached to this run. An attachment whose content was
     -- already stored is tied to the older source only through its ingestion
     -- job, so the job is read as well as the source's own record.
     attached AS (
       SELECT s2.id AS source_id
         FROM sources s2
        WHERE s2.discovered_by_run_id = $1::uuid AND s2.imported_via IN ('manual_upload', 'manual_url')
       UNION
       SELECT ij.source_id
         FROM ingestion_jobs ij
        WHERE ij.source_id IS NOT NULL AND ij.metadata->>'research_run_id' = $1::text
     )
     SELECT s.id AS source_id,
            s.title,
            s.url,
            s.source_type::text AS source_type,
            COALESCE(s.tags, '{}'::text[]) AS tags,
            s.ingested_at,
            s.discovered_by_run_id,
            s.fetch_method,
            (
              SELECT ij.status::text
                FROM ingestion_jobs ij
               WHERE ij.source_id = s.id
               ORDER BY ij.created_at DESC
               LIMIT 1
            ) AS ingestion_status,
            (SELECT COUNT(*)::int FROM chunks c WHERE c.source_id = s.id) AS chunk_count,
            (s.id IN (SELECT source_id FROM passages)) AS used_passage,
            (s.id IN (SELECT source_id FROM cited WHERE source_id IS NOT NULL)) AS cited_in_report,
            (s.id IN (SELECT source_id FROM attached)) AS attached_by_user
       FROM sources s
      WHERE s.discovered_by_run_id = $1::uuid
         OR s.id IN (SELECT source_id FROM passages)
         OR s.id IN (SELECT source_id FROM cited WHERE source_id IS NOT NULL)
         OR s.id IN (SELECT source_id FROM attached)
      ORDER BY s.ingested_at DESC NULLS LAST`,
    [runId, reportId]
  );
  return { rows, retrievalRecorded: Boolean(run?.recorded) };
}

function isUsed(row: RunSourceRow): boolean {
  return Boolean(row.used_passage) || Boolean(row.cited_in_report) || Boolean(row.attached_by_user);
}

/**
 * The sources to show a person for this run.
 *
 * Until the run has recorded the passages it worked from (it is still
 * searching), nothing can be called unused yet and every source fetched for it
 * is shown. Once the record exists, even an empty one, only
 * the sources they came from, the sources the report cites, and what the
 * person attached are shown.
 */
export function usedByRun(sources: RunSources): RunSourceRow[] {
  if (!sources.retrievalRecorded) return sources.rows;
  return sources.rows.filter(isUsed);
}

export interface NotUsedSource {
  title: string | null;
  url: string | null;
  /** Where it was left out: before it was fetched, after it was stored, or fetched and never drawn on. */
  stage: 'search_result' | 'stored_document' | 'fetched';
  /** Plain words for the diagnostics view. */
  label: string;
  /** The judge's own short explanation, when there is one. */
  why: string;
}

export const NOT_DRAWN_ON_LABEL = 'Not used — fetched for this question, but no passage was taken from it';

interface DiscoveryEventRow {
  phase: string;
  payload: Record<string, unknown> | null;
}

/**
 * What the run found and did not use, for the diagnostics view only: search
 * results and stored documents the relevance check set aside, and sources that
 * were fetched but never drawn on.
 */
export function notUsedByRun(sources: RunSources, events: readonly DiscoveryEventRow[]): NotUsedSource[] {
  const out: NotUsedSource[] = [];
  const seen = new Set<string>();
  const add = (entry: NotUsedSource) => {
    const key = `${entry.stage}|${entry.url ?? ''}|${entry.title ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  for (const event of events) {
    if (event.phase !== 'relevance_gate' && event.phase !== 'relevance_retrieval') continue;
    const listed = event.payload?.not_used;
    if (!Array.isArray(listed)) continue;
    for (const raw of listed) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as { url?: unknown; title?: unknown; reason?: unknown; why?: unknown };
      const reason: NotUsedReason | null = item.reason === 'vendor_sales' ? 'vendor_sales' : item.reason === 'off_topic' ? 'off_topic' : null;
      add({
        title: typeof item.title === 'string' ? item.title : null,
        url: typeof item.url === 'string' ? item.url : null,
        stage: event.phase === 'relevance_gate' ? 'search_result' : 'stored_document',
        label: reason ? notUsedLabel(reason) : NOT_USED_LABEL,
        why: typeof item.why === 'string' ? item.why : '',
      });
    }
  }
  if (sources.retrievalRecorded) {
    for (const row of sources.rows) {
      if (isUsed(row)) continue;
      add({ title: row.title, url: row.url, stage: 'fetched', label: NOT_DRAWN_ON_LABEL, why: '' });
    }
  }
  return out;
}

/**
 * A run's stored discovery summary as a person may see it: the counts, and
 * only the sources the run went on to read. The full list of search results,
 * including those set aside, stays in the diagnostics view.
 */
export function discoverySummaryForReader(summary: unknown): unknown {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return summary ?? null;
  const record = summary as Record<string, unknown>;
  if (!Array.isArray(record.sources)) return record;
  return {
    ...record,
    sources: record.sources.filter((entry) => Boolean(entry) && typeof entry === 'object' && (entry as { ingested?: unknown }).ingested === true),
  };
}

/** A discovery event as a person may see it: what was done, without the list of what was set aside. */
export function discoveryEventForReader<T extends { phase: string; payload: Record<string, unknown> | null }>(event: T): T {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object') return event;
  if (!('not_used' in payload) && !('skipped' in payload)) return event;
  const { not_used: _notUsed, skipped: _skipped, ...rest } = payload as Record<string, unknown>;
  return { ...event, payload: rest };
}
