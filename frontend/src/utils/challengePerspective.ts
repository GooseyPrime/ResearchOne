/**
 * The optional viewpoint Double-check asks its questions from.
 *
 * Every report is double-checked before it concludes; this only steers *whose*
 * questions get asked. It travels as supplemental context on the run rather
 * than as its own API field, which is why the split/merge helpers exist: the
 * run row stores one supplemental string and the form has to be able to take
 * it apart again when restoring a cancelled request.
 *
 * The names, descriptions and examples are written once, in the registry of
 * customer-facing names (`content/customerOptions.ts`).
 */
import { customerOption, customerOptionsIn } from '../content/customerOptions';

const VIEWPOINT_IDS = ['fda', 'peer', 'defense', 'investor', 'journalist', 'custom'] as const;

export const CHALLENGE_PERSPECTIVE_OPTIONS = VIEWPOINT_IDS.map((id) => {
  const words = customerOption('check_viewpoint', id);
  return { id, label: words.name, description: words.description, example: words.example };
});

/** What the control shows when no viewpoint is chosen. */
export const NO_VIEWPOINT = customerOptionsIn('check_viewpoint').find((option) => option.id === 'none')!;

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
