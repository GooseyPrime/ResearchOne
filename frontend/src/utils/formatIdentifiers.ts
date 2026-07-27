/**
 * Converts a snake_case or kebab-case identifier into a human-readable title.
 * Example: "comparative_analysis" → "Comparative Analysis"
 */
export function humanizeIdentifier(text: string): string {
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
