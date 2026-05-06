/**
 * Restrict post-login redirects to same-origin relative paths to avoid open redirects.
 * Allows `/app/...` style paths; rejects schemes, `//evil`, backslashes, etc.
 */
export function safeInternalPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const t = raw.trim();
  if (!t.startsWith('/') || t.startsWith('//') || t.includes('\\')) return fallback;
  return t;
}
