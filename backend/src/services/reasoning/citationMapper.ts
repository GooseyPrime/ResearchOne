/**
 * Citation mapper.
 * Maps report sections to supporting chunks, sources, and claims.
 * Persists section-level citations without hallucinating them.
 *
 * If no direct citation mapping confidence is high enough, the section
 * is left partially uncited and the gap is noted in verifier metadata.
 */

import { query, withTransaction } from '../../db/pool';
import { callRoleModel } from '../openrouter/openrouterService';
import type { ResearchObjective } from './reasoningModelPolicy';
import { withPreamble } from '../../constants/prompts';
import { RetrievedChunk } from '../retrieval/retrievalService';
import { ExtractedClaim } from './claimExtractor';
import { logger } from '../../utils/logger';
import type { SourceClassMap } from '../planning/wave53EpistemicPolicy';
import { resolveSourceClassForChunk } from '../planning/wave53EpistemicPolicy';

export interface SectionCitation {
  section_type: string;
  chunk_id: string;
  source_id?: string;
  claim_id?: string;
  chunk_quote?: string;
  citation_order: number;
  confidence: number;
  discovery_origin?: Record<string, unknown>;
}

export interface CitationMapResult {
  citations: SectionCitation[];
  uncitedSections: string[];
  notes: string;
}

const CITATION_MAPPER_PROMPT = `You are a citation mapping agent for ResearchOne.
Map report sections to specific evidence chunks, source IDs, and claim IDs where applicable.

CRITICAL RULES:
- Do not hallucinate citations — only map chunks that genuinely support the section text
- If no chunk adequately supports a section, omit it and note it as uncited
- Provide a short chunk_quote (max 100 chars) showing which part of the chunk is cited
- Confidence must be 0.0–1.0; only include citations with confidence >= 0.3
- Each citation maps one section_type to one chunk_id, with optional source_id and claim_id
- Chunks are listed as "[CHUNK N] ID: <uuid>" — use the exact UUID as the chunk_id value
- Report sections reference chunks by their 1-based number (e.g. "Chunk 3") — find the chunk
  with that number and return its UUID as chunk_id

Output JSON with this exact schema:
{
  "citations": [
    {
      "section_type": "string",
      "chunk_id": "uuid",
      "source_id": "uuid or null",
      "claim_id": "uuid or null",
      "chunk_quote": "string",
      "citation_order": integer,
      "confidence": 0.0-1.0
    }
  ],
  "uncited_sections": ["string", ...],
  "notes": "string"
}`;

export async function mapAndPersistCitations(args: {
  runId: string;
  reportId: string;
  chunks: RetrievedChunk[];
  claims: ExtractedClaim[];
  reportSections: Array<{ type: string; title: string; content: string }>;
  discoverySummary?: Record<string, unknown>;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  byokApiKeyOverride?: string;
  sourceClassMap?: SourceClassMap;
  /** Alias for `sourceClassMap`. */
  sourceClassByChunkId?: SourceClassMap;
  /** Max chunks in LLM context (smart_citations add-on can raise this). */
  chunkContextLimit?: number;
}): Promise<CitationMapResult> {
  const { runId, reportId, chunks, claims, reportSections, discoverySummary } = args;
  const wave53Maps = args.sourceClassMap ?? args.sourceClassByChunkId;
  const chunkLimit = args.chunkContextLimit ?? Math.min(chunks.length, 40);

  // Build an ordered list of chunks for the context window, and an index→uuid
  // lookup so the model can cite by 1-based number (matching the synthesizer
  // format) and we resolve it to a real UUID on the way back.
  const contextChunks = chunks.slice(0, chunkLimit);
  const chunkByIndex = new Map<number, RetrievedChunk>(contextChunks.map((c, i) => [i + 1, c]));

  logger.info(`[citations:${runId}] Mapping citations for ${reportSections.length} sections`);

  const chunkContext = contextChunks
    .map((c, i) => [
      `[CHUNK ${i + 1}] ID: ${c.id}`,
      `Source URL: ${c.source_url || 'unknown'}`,
      `Title: ${c.source_title || 'unknown'}`,
      c.content.slice(0, 250),
      '---',
    ].join('\n'))
    .join('\n');

  const sectionContext = reportSections
    .map(s => `[SECTION: ${s.type}] ${s.title}\n${s.content.slice(0, 400)}`)
    .join('\n===\n');

  const claimContext = claims
    .slice(0, chunkLimit)
    .map((c, i) => `[CLAIM ${i + 1}] ${c.claim_text}`)
    .join('\n');

  let result: CitationMapResult = { citations: [], uncitedSections: [], notes: '' };
  const chunkById = new Map(chunks.map((c) => [c.id, c]));

  try {
    const modelResult = await callRoleModel({
      role: 'verifier',
      engineVersion: args.engineVersion,
      researchObjective: args.researchObjective,
      allowFallbackByRole: args.allowFallbackByRole,
      byokApiKeyOverride: args.byokApiKeyOverride,
      messages: [
        { role: 'system', content: withPreamble(CITATION_MAPPER_PROMPT) },
        {
          role: 'user',
          content: `Report Sections:\n${sectionContext}\n\nEvidence Chunks:\n${chunkContext}\n\nExtracted Claims:\n${claimContext}\n\nMap each section to supporting chunk IDs. Output JSON only.`,
        },
      ],
      maxTokens: 4096,
    });

    const jsonMatch = modelResult.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        citations: SectionCitation[];
        uncited_sections: string[];
        notes: string;
      };

      // Resolve chunk_id: the model may return a 1-based index number (matching
      // the "[CHUNK N]" format we sent) or a UUID. Normalise to UUID, then drop
      // any citation whose chunk_id is not a known chunk — a fabricated ID
      // produces a dangling FK that the dossier query can never resolve.
      const resolvedCitations = (parsed.citations ?? [])
        .map((c) => {
          const asIndex = Number(c.chunk_id);
          if (!Number.isNaN(asIndex) && Number.isInteger(asIndex) && asIndex >= 1) {
            const resolved = chunkByIndex.get(asIndex);
            if (resolved) return { ...c, chunk_id: resolved.id };
          }
          return c;
        })
        .filter((c) => c.section_type && c.chunk_id && c.confidence >= 0.3 && chunkById.has(c.chunk_id));

      result = {
        citations: resolvedCitations,
        uncitedSections: parsed.uncited_sections ?? [],
        notes: parsed.notes ?? '',
      };
    }
  } catch (err) {
    logger.warn(`[citations:${runId}] Citation mapping failed:`, err);
    return result;
  }

  if (result.citations.length === 0) {
    // If the report references chunks by number but none resolved, that is a
    // deliverable failure — the reader cannot follow any citation back to a
    // source. Log a specific, actionable message so it is never silently swallowed.
    const reportText = reportSections.map((s) => s.content).join('\n');
    const hasChunkRefs = /\bChunk\s+\d+\b/i.test(reportText);
    if (hasChunkRefs && chunks.length > 0) {
      logger.error(
        `[citations:${runId}] CITATION FAILURE: report contains chunk references but no citations resolved to a source. ` +
        `chunks_available=${chunks.length} chunks_in_context=${contextChunks.length} ` +
        `sections=${reportSections.length}`,
      );
    } else {
      logger.info(`[citations:${runId}] No citations mapped`);
    }
    return result;
  }

  // Look up claim IDs for cross-linking
  const claimRows = await query<{ id: string; claim_text: string }>(
    `SELECT id, claim_text FROM claims WHERE run_id=$1`,
    [runId]
  );
  const claimIdByText = new Map<string, string>(claimRows.map(r => [r.claim_text.trim(), r.id]));

  // Look up report_section IDs
  const sectionRows = await query<{ id: string; section_type: string }>(
    `SELECT id, section_type FROM report_sections WHERE report_id=$1`,
    [reportId]
  );
  const sectionIdByType = new Map<string, string>(sectionRows.map(r => [r.section_type, r.id]));

  await withTransaction(async (client) => {
    for (const citation of result.citations) {
      const sectionId = sectionIdByType.get(citation.section_type) ?? null;
      const claimId = citation.claim_id
        ? (claimIdByText.get(citation.claim_id) ?? citation.claim_id)
        : null;

      const origin = discoverySummary
        ? { ...discoverySummary, section_type: citation.section_type }
        : { section_type: citation.section_type };

      const srcUrl = chunkById.get(citation.chunk_id)?.source_url;
      const sourceClass =
        wave53Maps != null
          ? resolveSourceClassForChunk(citation.chunk_id, wave53Maps, srcUrl)
          : null;

      try {
        await client.query(
          `INSERT INTO report_citations (
             report_id, section_id, chunk_id, source_id, claim_id,
             chunk_quote, citation_order, discovery_origin, source_class
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [
            reportId,
            sectionId,
            citation.chunk_id,
            citation.source_id ?? null,
            claimId,
            citation.chunk_quote ?? null,
            citation.citation_order ?? 0,
            JSON.stringify(origin),
            sourceClass,
          ]
        );
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === '42703') {
          await client.query(
            `INSERT INTO report_citations (
               report_id, section_id, chunk_id, source_id, claim_id,
               chunk_quote, citation_order, discovery_origin
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING`,
            [
              reportId,
              sectionId,
              citation.chunk_id,
              citation.source_id ?? null,
              claimId,
              citation.chunk_quote ?? null,
              citation.citation_order ?? 0,
              JSON.stringify(origin),
            ]
          );
        } else {
          throw err;
        }
      }
    }
  });

  logger.info(`[citations:${runId}] Persisted ${result.citations.length} citations, ${result.uncitedSections.length} uncited sections`);
  return result;
}
