/**
 * Wave 5.3 — epistemic policy helpers (orthogonal to Rule 20 preamble; reasoner/skeptic
 * operational constraints live alongside openrouter SYSTEM_PROMPTS).
 */
import { SYSTEM_PROMPTS } from '../openrouter/openrouterService';
import {
  appendReasonerPolicyConstraint,
  REASONER_CONSENSUS_CONSTRAINT,
} from '../reasoning/reasoningModelPolicy';
import type { SourceClassId } from './sourceClassTypes';
import { SOURCE_CLASS_IDS } from './sourceClassTypes';

/** Canonical constraint body lives in `reasoningModelPolicy` (avoid circular imports). */
export { REASONER_CONSENSUS_CONSTRAINT, appendReasonerPolicyConstraint };

export function buildReasonerSystemPrompt(): string {
  return appendReasonerPolicyConstraint(SYSTEM_PROMPTS.reasoner);
}

const SKEPTIC_OVERLAYS: Record<SourceClassId, string> = {
  consensus_held:
    'SOURCE-CLASS OVERLAY (consensus_held): Challenge whether institutional framing adequately grounds each major claim; scrutinize mechanisms and measurement, not popularity.',
  actively_contested:
    'SOURCE-CLASS OVERLAY (actively_contested): Challenge BOTH official denial narratives and advocacy narratives symmetrically; separate what documents actually say from rhetorical posture.',
  suppressed_and_recovered:
    'SOURCE-CLASS OVERLAY (suppressed_and_recovered): Acknowledge suppression history without treating secrecy or stigma as substitute evidence either for or against the claim; focus on primary-document substance.',
  consensus_collapsed:
    'SOURCE-CLASS OVERLAY (consensus_collapsed): Flag how expert consensus shifted over time; evaluate present claims against current evidence, noting outdated "settled" framings.',
};

/** Static skeptic instructions shared across dossiers (editable in openrouterService). */
export const SKEPTIC_SOURCE_CLASS_CONDITIONAL_SECTION = `
SOURCE-CLASS CONDITIONAL BEHAVIOR (Wave 5.3):
The orchestrator may append per-class overlays below. When multiple classes appear in the corpus, apply each relevant overlay — prioritizing contested/suppressed/collapsed classes over pure consensus-held material when they conflict.
`.trim();

export function buildSkepticSystemPrompt(dominantSourceClasses: readonly SourceClassId[]): string {
  const base = SYSTEM_PROMPTS.skeptic.trim();
  const section = SKEPTIC_SOURCE_CLASS_CONDITIONAL_SECTION;
  if (dominantSourceClasses.length === 0) {
    return `${base}\n\n${section}\n(No dominant source-class overlays — treat corpus as unclassified for this dimension.)`;
  }
  const overlays = dominantSourceClasses.map((c) => SKEPTIC_OVERLAYS[c] ?? '').filter(Boolean);
  return `${base}\n\n${section}\n${overlays.join('\n')}`;
}

export interface SourceClassMap {
  byChunkId: Map<string, SourceClassId | null>;
  bySourceUrl: Map<string, SourceClassId | null>;
}

export function aggregateSourceClassBreakdown(
  byChunkId: Map<string, SourceClassId | null>,
): Record<SourceClassId, number> {
  const out = {} as Record<SourceClassId, number>;
  for (const id of SOURCE_CLASS_IDS) out[id] = 0;
  for (const v of byChunkId.values()) {
    if (v) out[v] += 1;
  }
  return out;
}

/** Resolve class for a chunk using chunk-level map first, then canonical source URL. */
export function resolveSourceClassForChunk(
  chunkId: string,
  maps: SourceClassMap,
  sourceUrl: string | null | undefined,
): SourceClassId | null {
  const direct = maps.byChunkId.get(chunkId);
  if (direct !== undefined) return direct;
  const key = (sourceUrl ?? '').trim();
  if (!key) return null;
  const viaUrl = maps.bySourceUrl.get(key);
  return viaUrl ?? null;
}

/** Ordered dominant classes (non-zero counts) for skeptic overlays. */
export function dominantSourceClassesFromBreakdown(
  breakdown: Record<string, number>,
  limit = 4,
): SourceClassId[] {
  const ranked = (SOURCE_CLASS_IDS as readonly SourceClassId[])
    .map((id) => ({ id, n: breakdown[id] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return ranked.slice(0, limit).map((x) => x.id);
}
