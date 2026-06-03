import { normalizeRunAddonKeys, type RunAddonKey } from './runAddons';

/** Parse `addons` from JSON or multipart research start bodies. */
export function parseAddonsFromStartRequest(
  body: Record<string, unknown>,
  isMultipart: boolean
): RunAddonKey[] {
  let raw: unknown;
  if (isMultipart) {
    const field = body.addons;
    if (typeof field === 'string' && field.trim()) {
      try {
        raw = JSON.parse(field) as unknown;
      } catch {
        raw = field.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else {
      raw = field;
    }
  } else {
    raw = body.addons;
  }
  return normalizeRunAddonKeys(raw);
}
