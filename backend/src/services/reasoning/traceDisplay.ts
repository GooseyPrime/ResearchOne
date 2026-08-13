/**
 * Live-trace display helpers (WO-AB).
 *
 * These affect ONLY what a human sees in the run trace: the socket payload,
 * the log line, and the `progress_message` display column.
 *
 * They are deliberately NOT applied to anything an agent consumes. Retrieval
 * still runs against the full query text, specialists still receive the full
 * (separately budgeted) context, and the synthesizer still receives the full
 * research request. Truncation here cannot reduce the information load of any
 * LLM call — progress events have exactly one consumer, the UI.
 */

/** Headline trace line. Long enough to be useful, short enough to scan. */
export const TRACE_MESSAGE_MAX_CHARS = 240;

/** Collapsible detail field. Roomier, still bounded. */
export const TRACE_DETAIL_MAX_CHARS = 600;

/**
 * Collapse whitespace and hard-cap length for display.
 *
 * Newlines are flattened because a multi-line message renders as an unbounded
 * wall of text in the trace list — the original symptom was a retrieval query
 * containing the user's entire structured prompt.
 */
export function truncateForTrace(value: string, max: number): string {
  const flattened = (value ?? '').replace(/\s+/g, ' ').trim();
  if (flattened.length <= max) return flattened;
  return `${flattened.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build a scannable label for a retrieval pass.
 *
 * The previous form interpolated the raw retrieval query into the headline.
 * Planners routinely put the whole research request in `retrieval_queries`, so
 * the trace showed the entire prompt once per query — up to five times in a
 * row. The query text now belongs in `detail`, bounded.
 */
export function retrievalProgressLabel(args: {
  index: number;
  total: number;
  chunkCount: number;
  pass?: 'initial' | 'rediscovery';
}): string {
  const passLabel = args.pass === 'rediscovery' ? ' (re-discovery)' : '';
  const chunks = args.chunkCount === 1 ? '1 chunk' : `${args.chunkCount} chunks`;
  return `Retrieval ${args.index}/${args.total} complete${passLabel} — ${chunks} so far`;
}
