import type { SpecialistAgentId } from './agentCapabilityRegistry';

/**
 * Per-specialist retrieval scopes.
 *
 * Today every specialist receives the SAME undifferentiated source blob —
 * `evidenceContext`, capped at 50k characters and identical for all of them.
 * `competitor_mapper` and `demand_signal_analyst` read the same text and are
 * asked entirely different questions of it, which is a likely reason
 * specialists keep returning zero extractions.
 *
 * Each specialist now gets a retrieval scoped to its own function, layered
 * ADDITIVELY on top of the shared context. This is deliberate:
 *
 *   - The corpus competence gate (Rule 40) still runs, because scoped
 *     retrieval goes through the same `retrieveChunksWithAudit` path.
 *   - Source-material sufficiency accounting is unchanged; scoped hits are a
 *     subset of the same corpus, not a new source of truth.
 *   - A specialist that finds nothing scoped still sees the shared context, so
 *     this can only add signal, never remove it.
 *
 * NOTE ON NAMING: "evidence" here refers to retrieved source material, not to
 * adjudication. The surrounding identifiers predate the vocabulary cleanup and
 * are renamed separately.
 */

/**
 * Query templates per specialist. `{topic}` is replaced with a short topic
 * string derived from the research request — NOT the full prompt, which would
 * reintroduce the token bloat fixed in WO-AA Phase 5.
 */
const SPECIALIST_QUERY_TEMPLATES: Record<SpecialistAgentId, readonly string[]> = {
  market_scout: [
    '{topic} market size growth trends',
    '{topic} emerging niches underserved segments',
  ],
  competitor_mapper: [
    '{topic} leading competitors market share',
    '{topic} competitor weaknesses gaps positioning',
  ],
  demand_signal_analyst: [
    '{topic} buyer demand search interest',
    '{topic} customer complaints unmet needs',
  ],
  feasibility_architect: [
    '{topic} implementation requirements technical constraints',
    '{topic} cost barriers to entry operational risk',
  ],
  data_analysis_specialist: [
    '{topic} statistics metrics benchmarks',
    '{topic} pricing revenue conversion rates',
  ],
  quantitative_quality_auditor: [
    '{topic} methodology sample size data quality',
    '{topic} conflicting figures disputed numbers',
  ],
  story_verifier: [
    '{topic} primary account corroboration',
    '{topic} timeline discrepancies conflicting reports',
  ],
  timeline_reconstructor: [
    '{topic} chronology dates sequence of events',
    '{topic} earliest reports subsequent developments',
  ],
};

/** Max characters of scoped material appended per specialist. */
export const MAX_SCOPED_CONTEXT_CHARS = 12_000;

/** Chunks requested per scoped query. Deliberately small — this is a top-up. */
export const SCOPED_RETRIEVAL_TOP_K = 6;

/**
 * Derive a compact topic string for query templating.
 *
 * Uses the leading heading or first sentence, capped hard. Passing the full
 * research request here would defeat the WO-AA prompt budgets and produce
 * useless embeddings — a 30k-character "query" retrieves nothing meaningful.
 */
export function deriveRetrievalTopic(researchQuery: string, maxChars = 180): string {
  const text = (researchQuery ?? '').trim();
  if (!text) return '';

  const heading = text.slice(0, 400).match(/^#{1,3}\s+(.+?)\s*$/m)?.[1];
  const candidate =
    heading ??
    text
      .replace(/^#{1,6}\s+.*$/gm, '')
      .split(/(?<=[.?!])\s+/)
      .find((sentence) => sentence.trim().length >= 20) ??
    text;

  const flattened = candidate
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return flattened.length > maxChars ? flattened.slice(0, maxChars).trimEnd() : flattened;
}

/** Build the scoped retrieval queries for one specialist. */
export function buildScopedQueries(agent: SpecialistAgentId, topic: string): string[] {
  const templates = SPECIALIST_QUERY_TEMPLATES[agent];
  if (!templates || !topic) return [];
  return templates.map((template) => template.replace('{topic}', topic).trim()).filter(Boolean);
}

/** Agents that have a defined scope. Others fall back to shared context only. */
export function hasScopedRetrieval(agent: SpecialistAgentId): boolean {
  return (SPECIALIST_QUERY_TEMPLATES[agent]?.length ?? 0) > 0;
}

export interface ScopedChunk {
  id: string;
  content: string;
  source_title?: string;
  source_url?: string;
}

/**
 * Format scoped material for a specialist prompt.
 *
 * Chunks already present in the shared context are skipped by id so the same
 * text is not paid for twice — the duplication class that cost 95k tokens per
 * specialist before WO-AA Phase 5.
 */
export function formatScopedContext(
  agent: SpecialistAgentId,
  chunks: readonly ScopedChunk[],
  alreadyIncludedIds: ReadonlySet<string>
): string {
  const fresh = chunks.filter((chunk) => !alreadyIncludedIds.has(chunk.id));
  if (fresh.length === 0) return '';

  const lines: string[] = [
    `SCOPED_SOURCES_FOR_${agent.toUpperCase()} (retrieved specifically for your task):`,
  ];
  let used = 0;
  for (const chunk of fresh) {
    const label = chunk.source_title || chunk.source_url || 'source';
    const entry = `\n[${label}]\n${chunk.content}`;
    if (used + entry.length > MAX_SCOPED_CONTEXT_CHARS) break;
    lines.push(entry);
    used += entry.length;
  }
  if (lines.length === 1) return '';
  return lines.join('\n');
}
