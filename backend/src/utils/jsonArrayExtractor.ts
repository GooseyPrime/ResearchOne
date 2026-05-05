import { logger } from './logger';

/**
 * Robust extractor for "the model was asked to return a JSON array".
 *
 * The previous greedy regex approach (`/\[[\s\S]*\]/`) was the silent
 * cause of empty `claims` and `contradictions` tables on otherwise
 * successful research runs:
 *
 *   - Reasoning-style models often wrap output in ```json fences,
 *     <thinking>…</thinking> blocks, or commentary before/after the array.
 *   - The regex matched from the FIRST `[` (often inside a markdown bullet
 *     before the actual array) to the LAST `]` (often a closing bracket
 *     of a nested object), producing an unparseable substring.
 *   - `JSON.parse` then threw, the catch returned `[]`, and the
 *     orchestrator's outer "do not fail the run on epistemic persistence"
 *     swallowed the failure entirely.
 *
 * Strategy here, in order:
 *   1. Strip ``` fences and `<thinking>…</thinking>` blocks.
 *   2. Try `JSON.parse(stripped)` directly.
 *   3. Walk the string with a bracket-depth counter to find the LAST
 *      balanced top-level array `[...]`. Strings (including escaped
 *      quotes) are skipped so brackets inside string literals don't
 *      throw the counter off.
 *   4. If everything fails, log a head-of-content diagnostic and return
 *      `null` so the caller can decide whether `[]` or a hard fail is
 *      the right behaviour.
 */
export function extractJsonArray<T>(rawContent: string, opts?: { context?: string }): T[] | null {
  if (!rawContent) return null;

  const stripped = rawContent
    .replace(/```(?:json|javascript|js)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
    .trim();

  // Direct parse — covers the well-behaved case and is the cheapest path.
  try {
    const direct = JSON.parse(stripped);
    if (Array.isArray(direct)) return direct as T[];
  } catch {
    // fall through
  }

  // Scan for the LAST balanced `[...]` in the stripped text. We walk
  // from the end backwards looking for `]`, then count brackets forward
  // until we balance. This intentionally takes the last array since
  // models often emit illustrative `[example]` snippets before the real
  // payload.
  const lastClose = stripped.lastIndexOf(']');
  if (lastClose >= 0) {
    for (let start = stripped.lastIndexOf('[', lastClose); start >= 0; start = stripped.lastIndexOf('[', start - 1)) {
      const candidate = sliceBalanced(stripped, start, lastClose);
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed as T[];
      } catch {
        // try the next earlier `[`
      }
    }
  }

  const head = stripped.slice(0, 240).replace(/\s+/g, ' ');
  logger.warn(`[jsonArrayExtractor${opts?.context ? `:${opts.context}` : ''}] Could not parse JSON array; head="${head}…"`);
  return null;
}

/**
 * Returns the substring `[start..end]` IFF brackets balance with nothing
 * extra after the closing bracket. Honours JSON string literals so
 * brackets inside `"…"` don't affect the count.
 */
function sliceBalanced(s: string, start: number, end: number): string | null {
  if (s[start] !== '[' || s[end] !== ']') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i <= end; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && i === end) return s.slice(start, end + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}
