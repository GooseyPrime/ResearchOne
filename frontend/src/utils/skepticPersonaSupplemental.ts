export const SKEPTIC_PERSONA_OPTIONS = [
  { id: 'fda', label: 'FDA Compliance Officer', description: 'Regulatory scrutiny focus' },
  { id: 'peer', label: 'Hostile Peer Reviewer', description: 'Academic rigor challenge' },
  { id: 'defense', label: 'Defense Attorney', description: 'Adversarial cross-examination' },
  { id: 'investor', label: 'Due-diligence Investor', description: 'Due diligence perspective' },
  { id: 'journalist', label: 'Investigative Journalist', description: 'Source verification focus' },
  { id: 'custom', label: 'Custom Persona', description: 'Define your own adversary' },
] as const;

const PRESET_SKEPTIC_LABELS: Set<string> = new Set(
  SKEPTIC_PERSONA_OPTIONS.filter((p) => p.id !== 'custom').map((p) => p.label)
);

export function isPresetSkepticPersonaLabel(value: string): boolean {
  return PRESET_SKEPTIC_LABELS.has(value.trim());
}

/** Split stored supplemental that may end with a preset adversarial persona label. */
export function splitSupplementalAndSkepticPersona(supplemental: string): {
  supplemental: string;
  skepticPersona: string;
} {
  const trimmed = supplemental.trim();
  if (!trimmed) return { supplemental: '', skepticPersona: '' };

  const parts = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { supplemental: '', skepticPersona: '' };

  const last = parts[parts.length - 1]!;
  if (PRESET_SKEPTIC_LABELS.has(last)) {
    return {
      supplemental: parts.slice(0, -1).join('\n\n').trim(),
      skepticPersona: last,
    };
  }

  return { supplemental: trimmed, skepticPersona: '' };
}

export function mergeSupplementalWithSkepticPersona(
  supplemental: string,
  skepticPersona: string
): string | undefined {
  const merged = [supplemental.trim(), skepticPersona.trim()].filter(Boolean).join('\n\n');
  return merged || undefined;
}
