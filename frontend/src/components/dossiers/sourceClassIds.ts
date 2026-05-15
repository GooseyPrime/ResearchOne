/**
 * Canonical Wave 5.3 source-class ids (must stay aligned with backend `SOURCE_CLASS_IDS`).
 */
export const SOURCE_CLASS_IDS = [
  'suppressed_and_recovered',
  'actively_contested',
  'consensus_held',
  'consensus_collapsed',
] as const;

export type SourceClassId = (typeof SOURCE_CLASS_IDS)[number];

export function isSourceClassId(value: string): value is SourceClassId {
  return (SOURCE_CLASS_IDS as readonly string[]).includes(value);
}

const SHORT_LABELS: Record<SourceClassId, string> = {
  suppressed_and_recovered: 'Suppressed / recovered',
  actively_contested: 'Actively contested',
  consensus_held: 'Broad-agreement sources',
  consensus_collapsed: 'Agreement trajectory shifted',
};

export function sourceClassLabel(id: string): string {
  return isSourceClassId(id) ? SHORT_LABELS[id] : id.replace(/_/g, ' ');
}

export function sourceClassBadgeShortLabel(id: SourceClassId): string {
  return SHORT_LABELS[id];
}
