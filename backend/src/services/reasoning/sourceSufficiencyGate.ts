import type { IntentId } from '../planning/intentTaxonomy';
import { isAdjudicativeIntent } from '../retrieval/corpusCompetenceGate';
import { isCitableAsIndependent } from '../retrieval/sourceIndependence';

export interface EvidenceSufficiencyResult {
  action:
    | 'sufficient'
    | 'rediscover'
    | 'low_evidence_labeled_delivery'
    /** Adjudicative intent, no independent evidence, no passes left. Stop. */
    | 'insufficient_evidence_fail_closed';
  reason: 'sufficient' | 'insufficient_evidence';
  gaps: string[];
  /** Everything the run has, for reporting. NOT the sufficiency test. */
  usableSignalCount: number;
  /** Retrieved citable chunks the requester did not supply. */
  independentChunkCount: number;
  /** Items extracted by specialist models. Analysis, never evidence. */
  analyticalSignalCount: number;
}

/** The shape the gate needs from a retrieved chunk. */
export interface EvidenceChunk {
  source_origin?: string | null;
  owner_user_id?: string | null;
}

/**
 * Does this run have enough evidence to conclude anything?
 *
 * ## What was wrong
 *
 * This returned `sufficient` the moment `specialistSignalCount > 0`. That
 * count is the length of arrays a *model* produced — `corroborating`,
 * `competitors`, `signals`, `metrics`. The orchestrator hands those to
 * synthesis labelled "analysis only; not independent evidence", and this gate
 * accepted them as evidence anyway.
 *
 * So: retrieval returns nothing citable, a specialist writes a plausible
 * structured answer out of its own general knowledge, the count goes above
 * zero, and a story-verification run ships a verdict backed by nothing but
 * the model that wrote it. Circular verification, on a product whose entire
 * claim is verification. (GitHub #228 P1.)
 *
 * ## The rule now
 *
 * Analytical coverage and independent evidence are two different quantities
 * and only one of them can make a run sufficient:
 *
 *   - Specialist output enriches synthesis. It never counts as evidence.
 *   - Sources INGESTED are not evidence RETRIEVED. Discovery counts only once
 *     it has produced a retrievable citable chunk — a pass that fetched twelve
 *     papers and yielded no chunk has given synthesis nothing to cite. (Runs
 *     0eee6032 and 243995b4 took exactly that branch: discovery reported
 *     sources, retrieval returned zero chunks, this gate said `sufficient`,
 *     and synthesis spent twenty minutes writing a report with no citations
 *     which was then reported complete.)
 *   - An intent that delivers a verdict needs chunks the requester did not
 *     supply. Its own uploads are context, not corroboration.
 *   - Everything else may proceed on any citable chunk, and when there are
 *     none it still delivers the full artifact — honestly labelled — rather
 *     than refusing.
 *
 * The 0.55 retrieval-similarity floor is upstream and untouched
 * (`AGENTS.md:207` — do not lower it).
 *
 * ## Why this does not seal every run
 *
 * The previous behaviour was introduced because Rule 40 seals a small corpus
 * by design, so corpus chunks are legitimately zero on many runs. That is
 * still true and still handled: live discovery for the current run has its
 * owner cleared upstream, so a run's own discovered sources ARE independent
 * citable chunks. A sealed corpus means discovery is the evidence path, not
 * that there is no evidence path.
 */
export function assessSourceSufficiency(args: {
  intentId?: IntentId;
  /**
   * Citable chunks retrieved this run. Passed as records rather than a count
   * because the gate has to be able to tell independent evidence from the
   * requester's own material itself — a count computed by the caller is a
   * check this gate cannot enforce.
   */
  citableChunks: readonly EvidenceChunk[];
  /** Who is asking, so their own unclassified sources are not "independent". */
  requesterUserId?: string | null;
  specialistOutputs: Record<string, unknown>;
  rediscoveryPassesRemaining: number;
  requestedArtifactCount?: number;
  /** Sources ingested by live discovery this run. Independent of the corpus. */
  discoverySourceCount?: number;
  /**
   * True when the corpus competence gate (Rule 40) deliberately sealed the
   * partition. A sealed corpus is a designed state, NOT an evidence failure —
   * it means live discovery is the evidence path for this run.
   */
  corpusIntentionallySealed?: boolean;
}): EvidenceSufficiencyResult {
  const analyticalSignalCount = countUsableSignals(args.specialistOutputs);
  const citableChunkCount = args.citableChunks.length;
  const independentChunkCount = args.citableChunks.filter((chunk) =>
    isCitableAsIndependent(chunk, args.requesterUserId)
  ).length;
  const discoverySourceCount = Math.max(0, args.discoverySourceCount ?? 0);
  const usableSignalCount = analyticalSignalCount + citableChunkCount + discoverySourceCount;
  const gaps = collectEvidenceGaps(
    args.specialistOutputs,
    citableChunkCount,
    args.corpusIntentionallySealed ?? false
  );

  const adjudicative = isAdjudicativeIntent(args.intentId);
  const evidenceCount = adjudicative ? independentChunkCount : citableChunkCount;

  // Evidence is necessary. It is not on its own enough.
  //
  // Specialists reporting zero usable data points against a corpus that DID
  // return chunks is the original reference failure mode: retrieval found
  // text, nothing could be extracted from it, and the run proceeded as though
  // it had evidence. That earns a rediscovery pass, because chunks that yield
  // nothing may simply be off-topic.
  //
  // The condition is "specialists ran and found nothing", not "no signals" —
  // an intent whose profile skips the specialist stage has no signals to
  // report and must not be starved by a test aimed at a different failure.
  const specialistsRan = Object.keys(args.specialistOutputs).length > 0;
  const analysisIsUsable = !specialistsRan || analyticalSignalCount > 0;

  const base = { usableSignalCount, independentChunkCount, analyticalSignalCount };

  if (evidenceCount > 0 && analysisIsUsable) {
    return { action: 'sufficient', reason: 'sufficient', gaps: [], ...base };
  }

  if (args.rediscoveryPassesRemaining > 0) {
    return { action: 'rediscover', reason: 'insufficient_evidence', gaps, ...base };
  }

  return {
    action: adjudicative ? 'insufficient_evidence_fail_closed' : 'low_evidence_labeled_delivery',
    reason: 'insufficient_evidence',
    gaps,
    ...base,
  };
}

/**
 * Low-evidence mode is a SYNTHESIS MODIFIER, never a synthesis replacement.
 *
 * This returns a directive injected into the section drafter's prompt. The
 * synthesizer still runs and still produces the full requested artifact — it
 * simply labels confidence honestly and states its assumptions.
 *
 * DO NOT reintroduce a deterministic markdown generator here. A previous
 * implementation emitted N identical "LOW-EVIDENCE DELIVERY" placeholder
 * blocks with no model call at all, bypassed synthesis entirely (synthesis
 * stage ran 0ms), and shipped a report containing twenty identical stubs.
 * That satisfies a deliverable-count check while delivering nothing. See
 * Rule 37 R-L.
 */
export function buildLimitedSourcingDirective(args: {
  intentId?: IntentId;
  requestedArtifactCount?: number;
  gaps: string[];
}): string {
  const gapBullets = args.gaps.length > 0
    ? args.gaps.map((gap) => `- ${gap}`).join('\n')
    : '- Independent corroboration was limited in this pass.';
  const countClause =
    typeof args.requestedArtifactCount === 'number' && args.requestedArtifactCount > 0
      ? `You MUST still produce all ${args.requestedArtifactCount} requested items in full.`
      : 'You MUST still produce the complete requested deliverable.';

  return [
    'LIMITED-SOURCING SYNTHESIS MODE (MANDATORY):',
    'Independent retrieval returned little or no corroborating material this run.',
    'This does NOT reduce the deliverable. It changes only how confidence is expressed.',
    '',
    countClause,
    'Write the real deliverable using well-established domain knowledge and',
    'transparent reasoning. Substantive, specific, decision-useful content is required.',
    '',
    'Rules for this mode:',
    '- Produce every requested field with real content. A field\'s value must never be',
    '  a placeholder standing in for content — e.g. "insufficient sourcing", "unknown",',
    '  "TBD", "N/A", or "[placeholder]" as the whole value.',
    '  (This does not restrict the "(unverified estimate)" marker described below,',
    '  which annotates real content rather than replacing it.)',
    '- Distinguish clearly between: (a) well-established domain knowledge,',
    '  (b) modeled estimates with stated assumptions, and (c) specific factual claims',
    '  that could not be independently verified this run.',
    '- Any specific quantitative or named-entity claim that could not be verified must',
    '  carry a brief inline marker such as "(unverified estimate)" — but the surrounding',
    '  analysis must still be complete and useful.',
    '- Show the formulas and assumptions behind any modeled number so the reader can',
    '  recalculate it.',
    '- Do NOT fabricate precise figures, citations, URLs, or source titles.',
    '- Do NOT write meta-commentary about the research process, the corpus, or why',
    '  sources were unavailable. Deliver the artifact.',
    '- Do NOT describe this report as "evidence-based", "evidence-driven", or frame it',
    '  as adjudicating a claim. It is an analysis built on sources and reasoning.',
    '- Do NOT refuse, abort, or substitute an explanation of why the artifact cannot',
    '  be produced. Refusal is a verification failure.',
    '',
    'Known gaps to acknowledge briefly in a single caveats section (not per item):',
    gapBullets,
  ].join('\n');
}

/**
 * True when the run's evidence base was thin enough that the finished report
 * should be labelled `completed_degraded`.
 *
 * This does NOT skip the repair loop. It used to — under the old design the
 * low-evidence path emitted a deterministic stub, so repair was pointless.
 * Now that low-evidence runs produce a real model-generated report, a missing
 * item or required field is repairable by re-drafting, and skipping repair
 * shipped incomplete deliverables under a passing-looking status
 * (Codex P1 review, PR #202).
 *
 * Deliverable-contract and verifier failures are therefore evaluated first;
 * this downgrade applies only when neither gate failed.
 */
export function sourceShortfallDegradesStatus(reason?: string | null): boolean {
  return reason === 'insufficient_evidence';
}

function countUsableSignals(outputs: Record<string, unknown>): number {
  let count = 0;
  for (const output of Object.values(outputs)) {
    if (!output || typeof output !== 'object') continue;
    const record = output as Record<string, unknown>;
    for (const key of ['opportunities', 'competitors', 'signals', 'buildable_paths', 'metrics', 'events', 'corroborating']) {
      if (Array.isArray(record[key])) {
        count += record[key].length;
      }
    }
  }
  return count;
}

function collectEvidenceGaps(
  outputs: Record<string, unknown>,
  citableChunkCount: number,
  corpusIntentionallySealed: boolean
): string[] {
  const gaps: string[] = [];
  // A sealed corpus is a deliberate Rule 40 state, not a gap worth reporting to
  // the reader — surfacing it produced twenty copies of "No citable corpus
  // evidence cleared the competence gate" in a customer-facing report.
  if (citableChunkCount === 0 && !corpusIntentionallySealed) {
    gaps.push('Independent corroborating sources were limited for this topic.');
  }
  // Reader-facing wording only. Internal agent ids ("market_scout: zero
  // relevant opportunities extracted") previously reached the customer report.
  const seen = new Set<string>();
  const add = (gap: string) => {
    if (!seen.has(gap)) {
      seen.add(gap);
      gaps.push(gap);
    }
  };
  for (const output of Object.values(outputs)) {
    if (!output || typeof output !== 'object') continue;
    const record = output as Record<string, unknown>;
    if (Array.isArray(record.opportunities) && record.opportunities.length === 0) {
      add('Market scan returned no externally corroborated candidates; rankings rely on domain reasoning.');
    }
    if (Array.isArray(record.competitors) && record.competitors.length === 0) {
      add('Competitive landscape was not independently mapped this run.');
    }
    if (Array.isArray(record.signals) && record.signals.length === 0) {
      add('Demand signals were not independently measured; treat demand statements as qualitative.');
    }
    if (Array.isArray(record.metrics) && record.metrics.length === 0) {
      add('No quantitative datapoints were independently retrieved; figures are modeled estimates.');
    }
  }
  return gaps.length > 0
    ? gaps
    : ['Independent corroboration was limited; treat specific figures as modeled estimates.'];
}
