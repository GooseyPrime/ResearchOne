/**
 * One model per role. There is no backup model: a step always uses the model
 * chosen for it, and if that model's provider refuses, the same model is asked
 * on another provider that serves it (RJ-025). The server refuses a request
 * that names a backup model.
 */
export type RoleModelChoice = { primary?: string };

/**
 * Each role's model from a stored run (flat, or nested under `overrides`),
 * without any backup model an older run saved.
 */
export function modelRowsFromStoredOverrides(raw: unknown): Record<string, RoleModelChoice> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const nested = record.overrides;
  const byRole =
    nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : record;
  const out: Record<string, RoleModelChoice> = {};
  for (const [role, entry] of Object.entries(byRole)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const primary = (entry as { primary?: unknown }).primary;
    if (typeof primary === 'string' && primary.trim()) out[role] = { primary };
  }
  return out;
}

/** The per-run choice to send: each role's model, trimmed; roles left empty are left out. */
export function modelOverridesForRequest(
  rows: Record<string, RoleModelChoice>
): Record<string, { primary: string }> | undefined {
  const out: Record<string, { primary: string }> = {};
  for (const [role, row] of Object.entries(rows)) {
    const primary = row.primary?.trim();
    if (primary) out[role] = { primary };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
