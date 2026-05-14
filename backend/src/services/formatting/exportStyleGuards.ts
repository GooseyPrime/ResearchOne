/** Server-side allow-list for export / run citation styles (must match pandocRunner). */
export const VALID_EXPORT_STYLES: ReadonlySet<string> = new Set([
  'mla',
  'apa',
  'chicago-author-date',
  'chicago-note',
  'ieee',
  'harvard',
]);

/** Validated style slug for Pandoc / report export (matches `ExportStyle` in pandocRunner). */
export function parseExportStyleInput(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase();
  if (!VALID_EXPORT_STYLES.has(s)) return undefined;
  return s;
}
