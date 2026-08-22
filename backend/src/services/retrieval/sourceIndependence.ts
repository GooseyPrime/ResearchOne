/**
 * One definition of "independent evidence", shared by the corpus competence
 * gate and the retrieval citability filter.
 *
 * These two answer the same question -- is this source independent of the
 * person asking? -- and they used to answer it differently. The gate counted
 * any source with an `owner_user_id` as self-sourced, which is every source a
 * signed-in user ever caused to be ingested, including externally discovered
 * arXiv and PubMed papers. That sealed healthy partitions. The fix replaced
 * the ownership test with `sourceOrigin === 'researchone_generated'` in BOTH
 * places, which opened the opposite hole: a user's own uploads and their own
 * supplied URLs became citable as independent external evidence, and a
 * partition made entirely of private uploads reported `selfSourceShare === 0`
 * and unsealed. (Codex flagged both on PR #217 and #218.)
 *
 * Ownership and origin are different questions. "Who caused this to be
 * ingested" is not "where did it come from". The rule that actually holds is
 * about ORIGIN:
 *
 *   external_discovery    the system went and found it   -> independent
 *   user_upload           the requester supplied a file  -> NOT independent
 *   user_supplied_url     the requester supplied a link  -> NOT independent
 *   researchone_generated ResearchOne's own output       -> NOT independent
 *
 * Ownership survives only as the fallback for an UNCLASSIFIED source: a null
 * origin means an `imported_via` nobody has mapped, and material the requester
 * owns should not be presented back to them as independent corroboration just
 * because its provenance is unrecorded. Externally discovered sources now
 * classify correctly, so this fallback can no longer swallow them.
 */

export type SourceOrigin =
  | 'external_discovery'
  | 'user_upload'
  | 'researchone_generated'
  | 'user_supplied_url';

/**
 * Whether a source's origin makes it independent external evidence.
 *
 * A null origin is UNKNOWN, not independent — callers decide what to do with
 * it, because the gate and the retrieval filter have different information
 * available (the gate has no requester).
 */
export function isIndependentOrigin(origin: SourceOrigin | string | null | undefined): boolean {
  return origin === 'external_discovery';
}

/**
 * Whether a source counts against a partition's independence ceiling.
 *
 * Used by the corpus gate, which has no requester to compare ownership
 * against. An unclassified source counts as self-sourced when somebody owns
 * it, and does not when it is unowned global corpus material.
 */
export function countsAgainstIndependence(record: {
  sourceOrigin?: SourceOrigin | string | null;
  ownerUserId?: string | null;
}): boolean {
  const origin = record.sourceOrigin ?? null;
  if (origin === null || origin === '') {
    return Boolean(record.ownerUserId);
  }
  return !isIndependentOrigin(origin);
}

/**
 * Whether a retrieved chunk may be cited when the intent requires independent
 * external evidence.
 *
 * Unlike the gate, retrieval knows who is asking, so an unclassified source is
 * excluded only when the requester owns it. Sources discovered during the
 * CURRENT run already have their owner cleared upstream, so a run's own
 * discoveries stay citable.
 */
export function isCitableAsIndependent(
  chunk: { source_origin?: SourceOrigin | string | null; owner_user_id?: string | null },
  requesterUserId?: string | null
): boolean {
  const origin = chunk.source_origin ?? null;
  if (origin === null || origin === '') {
    return !(requesterUserId && chunk.owner_user_id === requesterUserId);
  }
  return isIndependentOrigin(origin);
}
