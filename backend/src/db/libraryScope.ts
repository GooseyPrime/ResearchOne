import type { Request } from 'express';
import { isAllowlistedAdminUserId } from '../services/auth/adminAllowlist';

/**
 * Who may see which library (corpus) rows.
 *
 * The library tables (`sources`, `documents`, `chunks`, `embeddings`,
 * `claims`, `contradictions`) carry no owner column and no row-level
 * security, so every read of them must say whose rows it wants. These
 * helpers are the single definition of that rule:
 *
 *  - A source is a user's OWN when one of their ingestion jobs points at it,
 *    when it was recorded as ingested by them, or when one of their research
 *    runs discovered or attached it.
 *  - A source is PUBLIC only when discovery fetched it from the open web
 *    (`imported_via = 'autonomous_discovery'`). Uploads, pasted text,
 *    user-supplied URLs and anything of unknown origin are private.
 *  - A claim or contradiction belongs to the user whose run produced it.
 *
 * Browsing (lists, search, graph, atlas, statistics) shows a user their own
 * rows. Retrieval for a research run may also read public sources, which
 * carry no other user's notes, findings or report text.
 */

export const PUBLIC_IMPORTED_VIA = 'autonomous_discovery';

export interface LibraryViewer {
  userId: string;
  /** Listed in the existing admin configuration; sees the whole library. */
  isAdmin: boolean;
}

export function libraryViewerFromRequest(req: Request): LibraryViewer | null {
  const userId = req.auth?.userId;
  if (!userId) return null;
  return { userId, isAdmin: isAllowlistedAdminUserId(userId) };
}

function prefix(alias: string): string {
  return alias ? `${alias}.` : '';
}

/** True for sources this user added themselves. `userParam` is a text parameter index. */
export function ownSourceSql(alias: string, userParam: number): string {
  const s = prefix(alias);
  return `(
    EXISTS (SELECT 1 FROM ingestion_jobs lib_j WHERE lib_j.source_id = ${s}id AND lib_j.user_id = $${userParam}::text)
    OR NULLIF(${s}metadata->>'ingested_by_user_id', '') = $${userParam}::text
    OR EXISTS (SELECT 1 FROM research_runs lib_r WHERE lib_r.id = ${s}discovered_by_run_id AND lib_r.user_id = $${userParam}::text)
  )`;
}

/** True for sources fetched from the open web by discovery. */
export function publicSourceSql(alias: string): string {
  return `${prefix(alias)}imported_via = '${PUBLIC_IMPORTED_VIA}'`;
}

/**
 * True for sources a research run may read: public sources, the run's own
 * discoveries and attachments, and its owner's own sources. With neither a
 * user nor a run, only public sources qualify.
 */
export function retrievableSourceSql(
  alias: string,
  params: { userParam?: number; runParam?: number; sharedOwnersParam?: number },
): string {
  const s = prefix(alias);
  const parts = [publicSourceSql(alias)];
  if (params.runParam) parts.push(`${s}discovered_by_run_id::text = $${params.runParam}::text`);
  if (params.userParam) parts.push(ownSourceSql(alias, params.userParam));
  if (params.sharedOwnersParam) {
    parts.push(
      `EXISTS (SELECT 1 FROM ingestion_jobs lib_sj WHERE lib_sj.source_id = ${s}id AND lib_sj.user_id = ANY($${params.sharedOwnersParam}::text[]))`,
      `NULLIF(${s}metadata->>'ingested_by_user_id', '') = ANY($${params.sharedOwnersParam}::text[])`,
    );
  }
  return `(${parts.join(' OR ')})`;
}

/** True for claims produced by this user's runs (or, with no run, drawn from their own sources). */
export function ownClaimSql(alias: string, userParam: number): string {
  const c = prefix(alias);
  return `(
    EXISTS (SELECT 1 FROM research_runs lib_cr WHERE lib_cr.id = ${c}run_id AND lib_cr.user_id = $${userParam}::text)
    OR (${c}run_id IS NULL AND EXISTS (
      SELECT 1 FROM sources lib_cs WHERE lib_cs.id = ${c}source_id AND ${ownSourceSql('lib_cs', userParam)}
    ))
  )`;
}

/**
 * Accounts whose own library documents are deliberately offered to every
 * user's research as a shared library. Empty unless the operator sets
 * SHARED_LIBRARY_OWNER_USER_IDS (comma-separated Clerk user ids); with it
 * empty no uploaded document is ever read by another user's run.
 */
export function sharedLibraryOwnerUserIds(): string[] {
  return (process.env.SHARED_LIBRARY_OWNER_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
