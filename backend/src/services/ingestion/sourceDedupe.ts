import crypto from 'crypto';
import { queryOne } from '../../db/pool';
import { PUBLIC_IMPORTED_VIA, ownSourceSql, publicSourceSql } from '../../db/libraryScope';

export interface StoredSourceMatch {
  /** Value to store in `sources.content_hash` when a new row is written. */
  contentHash: string;
  /** A stored source this ingest may reuse, or null when a new row is needed. */
  existing: { id: string; url?: string | null } | null;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Duplicate check for an incoming document.
 *
 * Identical content is stored once per owner, not once for everyone. A stored
 * source is reused only when it is public (fetched from the open web by
 * discovery) or already belongs to the user or run that is ingesting now.
 * When the only stored copy is another user's private document, this ingest
 * gets its own row — under a hash scoped to its owner — so neither user is
 * linked to, or can see anything recorded on, the other's copy.
 */
export async function findStoredSourceForContent(args: {
  rawContent: string;
  importedVia?: string | null;
  ownerUserId?: string | null;
  runId?: string | null;
}): Promise<StoredSourceMatch> {
  const plainHash = sha256(args.rawContent);
  const owner = args.ownerUserId ?? null;
  const run = args.runId ?? null;

  const stored = await queryOne<{
    id: string;
    url: string | null;
    is_public: boolean | null;
    is_own: boolean | null;
  }>(
    `SELECT s.id, s.url,
            (${publicSourceSql('s')}) AS is_public,
            (${ownSourceSql('s', 2)} OR ($3::text IS NOT NULL AND s.discovered_by_run_id::text = $3::text)) AS is_own
       FROM sources s
      WHERE s.content_hash = $1`,
    [plainHash, owner, run],
  );

  if (!stored) return { contentHash: plainHash, existing: null };
  if (stored.is_public === true || stored.is_own === true) {
    return { contentHash: plainHash, existing: { id: stored.id, url: stored.url } };
  }

  // The stored copy is someone else's private document.
  const scope =
    args.importedVia === PUBLIC_IMPORTED_VIA
      ? 'public'
      : owner
        ? `user:${owner}`
        : run
          ? `run:${run}`
          : 'unowned';
  const scopedHash = sha256(`${scope}:${plainHash}`);
  const scoped = await queryOne<{ id: string; url: string | null }>(
    'SELECT id, url FROM sources WHERE content_hash = $1',
    [scopedHash],
  );
  return { contentHash: scopedHash, existing: scoped ?? null };
}
