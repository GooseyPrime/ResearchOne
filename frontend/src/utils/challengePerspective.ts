/**
 * The optional perspective the challenge pass argues from.
 *
 * Every report is challenged before it concludes; this only steers *whose*
 * objections get raised. It travels as supplemental context on the run rather
 * than as its own API field, which is why the split/merge helpers exist: the
 * run row stores one supplemental string and the form has to be able to take
 * it apart again when restoring a cancelled request.
 *
 * Renamed from `skepticPersonaSupplemental` in WO-AH — the operator's
 * instruction is that "skeptic" is not a word the product says.
 */
export const CHALLENGE_PERSPECTIVE_OPTIONS = [
  { id: 'fda', label: 'FDA Compliance Officer', description: 'Regulatory scrutiny focus' },
  { id: 'peer', label: 'Hostile Peer Reviewer', description: 'Academic rigor challenge' },
  { id: 'defense', label: 'Defense Attorney', description: 'Cross-examination of every claim' },
  { id: 'investor', label: 'Due-diligence Investor', description: 'Due diligence perspective' },
  { id: 'journalist', label: 'Investigative Journalist', description: 'Source verification focus' },
  { id: 'custom', label: 'Custom perspective', description: 'Describe your own' },
] as const;

const PRESET_LABELS: Set<string> = new Set(
  CHALLENGE_PERSPECTIVE_OPTIONS.filter((p) => p.id !== 'custom').map((p) => p.label)
);

export function isPresetChallengePerspective(value: string): boolean {
  return PRESET_LABELS.has(value.trim());
}

/** Split stored supplemental that may end with a preset perspective label. */
export function splitSupplementalAndPerspective(supplemental: string): {
  supplemental: string;
  challengePerspective: string;
} {
  const trimmed = supplemental.trim();
  if (!trimmed) return { supplemental: '', challengePerspective: '' };

  const parts = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { supplemental: '', challengePerspective: '' };

  const last = parts[parts.length - 1]!;
  if (PRESET_LABELS.has(last)) {
    return {
      supplemental: parts.slice(0, -1).join('\n\n').trim(),
      challengePerspective: last,
    };
  }

  return { supplemental: trimmed, challengePerspective: '' };
}

export function mergeSupplementalWithPerspective(
  supplemental: string,
  challengePerspective: string
): string | undefined {
  const merged = [supplemental.trim(), challengePerspective.trim()].filter(Boolean).join('\n\n');
  return merged || undefined;
}
