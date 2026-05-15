/**
 * Wave 5.3 — orthogonal source-class dimension (not evidence tier identifiers).
 */

export const SOURCE_CLASS_IDS = [
  'suppressed_and_recovered',
  'actively_contested',
  'consensus_held',
  'consensus_collapsed',
] as const;

export type SourceClassId = (typeof SOURCE_CLASS_IDS)[number];

export function isSourceClassId(value: string | null | undefined): value is SourceClassId {
  return value != null && (SOURCE_CLASS_IDS as readonly string[]).includes(value);
}

export const SOURCE_CLASS_CONFIDENCE_FLOOR = 0.72;
