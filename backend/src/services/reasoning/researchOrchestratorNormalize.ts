/** Normalize planner-produced retrieval_queries into a non-empty string list. */
export function normalizeRetrievalQueries(raw: unknown, fallback: string): string[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t) out.push(t);
    } else if (typeof item === 'number' || typeof item === 'boolean') {
      out.push(String(item));
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const q = o.query ?? o.text ?? o.q;
      if (typeof q === 'string' && q.trim()) out.push(q.trim());
      else out.push(JSON.stringify(item));
    }
  }
  return out.length > 0 ? out : [fallback];
}
