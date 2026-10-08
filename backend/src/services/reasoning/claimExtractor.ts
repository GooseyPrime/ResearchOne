/**
 * Claim extractor.
 * Extracts discrete, machine-queryable claim records from research outputs.
 * Claims are persisted to the claims table with evidence tier, confidence,
 * and chunk linkage for later querying without reparsing prose.
 */

import { query, withTransaction } from '../../db/pool';
import { callRoleModel } from '../openrouter/openrouterService';
import type { ResearchObjective } from './reasoningModelPolicy';
import { withPreamble } from '../../constants/prompts';
import { RetrievedChunk } from '../retrieval/retrievalService';
import { logger } from '../../utils/logger';
import { extractJsonArray } from '../../utils/jsonArrayExtractor';
import type { SourceClassMap } from '../planning/wave53EpistemicPolicy';
import { resolveSourceClassForChunk } from '../planning/wave53EpistemicPolicy';
import { normalizeClaimKeyForSteelman } from './steelmanService';

export interface ExtractedClaim {
  claim_text: string;
  evidence_tier: 'established_fact' | 'strong_evidence' | 'testimony' | 'inference' | 'speculation';
  confidence: number;
  supporting_chunk_ids: string[];
  source_ids: string[];
  tags: string[];
  is_conclusion_critical: boolean;
  stance_summary?: string;
}

/** Maximum characters of model output to include in claim extraction context */
const MAX_REASONER_CONTEXT_CHARS = 2000;
const MAX_SYNTHESIZER_CONTEXT_CHARS = 3000;

const CLAIM_EXTRACTOR_PROMPT = `You are a claim extraction agent for ResearchOne.
Extract discrete factual assertions from research outputs.

CRITICAL RULES:
- Extract only claims that are explicitly supported or discussed in the evidence
- Assign each claim an evidence tier: established_fact | strong_evidence | testimony | inference | speculation
- Do not fabricate claims not present in the source material
- Include supporting_chunk_ids referencing provided chunk IDs
- Mark conclusion-critical claims (claims the report's conclusion depends on)
- Confidence must be 0.0–1.0

Output a JSON array of claims:
[
  {
    "claim_text": "string",
    "evidence_tier": "established_fact|strong_evidence|testimony|inference|speculation",
    "confidence": 0.0-1.0,
    "supporting_chunk_ids": ["uuid", ...],
    "source_ids": ["uuid", ...],
    "tags": ["string", ...],
    "is_conclusion_critical": boolean,
    "stance_summary": "string"
  }
]`;

/** A passage a saved report cites: the source it belongs to and the sentences the report quoted from it. */
interface CitedPassage {
  sourceId: string | null;
  quotes: string[];
}

const idKey = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/**
 * The passages this report's saved citations point to.
 *
 * A report written with the citation lock has its citations saved with it,
 * before findings are extracted, and nothing else ties a finding to them: the
 * model-based mapper that used to set a citation's finding is skipped for such
 * a report. Without this, findings were drawn from the first passages retrieved
 * whether or not the report cited them, and a finding was filed under the first
 * passage id the model listed, so the reading page found no finding behind any
 * citation and listed bare passages instead.
 *
 * Any other report has no saved citations at this point and gets an empty map:
 * extraction is then exactly what it was. A failed read is treated the same way.
 */
async function loadCitedPassages(runId: string, reportId: string): Promise<Map<string, CitedPassage>> {
  const cited = new Map<string, CitedPassage>();
  try {
    const rows = await query<{ chunk_id: string | null; source_id: string | null; chunk_quote: string | null }>(
      `SELECT chunk_id, source_id, chunk_quote FROM report_citations WHERE report_id = $1 ORDER BY citation_order ASC NULLS LAST`,
      [reportId]
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = idKey(row.chunk_id);
      if (!key) continue;
      const entry = cited.get(key) ?? { sourceId: row.source_id ?? null, quotes: [] };
      const quote = row.chunk_quote?.trim();
      if (quote && !entry.quotes.includes(quote)) entry.quotes.push(quote);
      cited.set(key, entry);
    }
  } catch (err) {
    logger.warn(`[claims:${runId}] Saved citations could not be read; findings are extracted without them`, err);
    return new Map();
  }
  return cited;
}

/** Passages shown to the extraction when the report has no saved citations, and the share left for uncited ones when it has. */
const PASSAGES_SHOWN = 30;
/** Cited passages shown in one call. A report that cites more is read in further calls, so none is left out. */
const CITED_PASSAGES_PER_CALL = 60;

/**
 * The passages the extraction is shown, one list per model call. With no saved
 * citations: one call with the first thirty, as always. With saved citations:
 * every passage the report cites, sixty to a call, so no citation is left
 * without its passage however many the report cites. Uncited passages fill the
 * first call only, and only while it holds fewer than thirty. The limit is on
 * uncited context, never on what was cited.
 */
export function passagesForExtraction<T extends { id: string }>(chunks: T[], cited: ReadonlySet<string>): T[][] {
  if (cited.size === 0) return [chunks.slice(0, PASSAGES_SHOWN)];
  const citedPassages = chunks.filter((chunk) => cited.has(idKey(chunk.id)));
  const batches: T[][] = [];
  for (let at = 0; at < citedPassages.length; at += CITED_PASSAGES_PER_CALL) batches.push(citedPassages.slice(at, at + CITED_PASSAGES_PER_CALL));
  if (batches.length === 0) batches.push([]);
  const uncited = chunks.filter((chunk) => !cited.has(idKey(chunk.id))).slice(0, Math.max(0, PASSAGES_SHOWN - batches[0].length));
  batches[0] = [...batches[0], ...uncited];
  return batches;
}

/**
 * The passage a finding is filed under and the passages that support it, for a
 * report with saved citations. Only ids of passages the run holds are kept: an
 * id the model invented would be refused by the database and take every other
 * finding of the run with it. A passage the report cites is preferred, so the
 * finding is found behind that citation.
 */
export function resolveFindingPassages(
  supporting: unknown,
  known: ReadonlyMap<string, string>,
  cited: ReadonlyMap<string, { sourceId: string | null }>
): { chunkId: string | null; sourceId: string | null; supporting: string[] } {
  const kept: string[] = [];
  for (const raw of Array.isArray(supporting) ? supporting : []) {
    const id = known.get(idKey(raw));
    if (id && !kept.includes(id)) kept.push(id);
  }
  const chunkId = kept.find((id) => cited.has(idKey(id))) ?? kept[0] ?? null;
  return { chunkId, sourceId: chunkId ? cited.get(idKey(chunkId))?.sourceId ?? null : null, supporting: kept };
}

/** Told to a call after the first, which is shown further cited passages of the same report. */
const LATER_CALL_NOTE = 'These are further chunks the same report cites. Extract only claims these chunks support.\n\n';

const CITED_PASSAGES_NOTE =
  'The report cites the chunks marked "Cited in the report". Extract what the report states with those citations first, and for each claim list in supporting_chunk_ids the id of every chunk that supports it, copied exactly from the chunk header.\n\n';

export async function extractAndPersistClaims(args: {
  runId: string;
  reportId: string;
  researchQuery: string;
  chunks: RetrievedChunk[];
  reasonerOutput: string;
  synthesizerOutput: string;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  byokApiKeyOverride?: string;
  wave53?: {
    /** Full classifier maps (chunk + canonical URL). */
    sourceClassMap?: SourceClassMap;
    /** Alias for `sourceClassMap` (the source-class pass task naming). */
    sourceClassByChunkId?: SourceClassMap;
    steelmanByClaimText?: Map<string, string>;
  };
}): Promise<ExtractedClaim[]> {
  const { runId, reportId, researchQuery, chunks, reasonerOutput, synthesizerOutput } = args;

  logger.info(`[claims:${runId}] Extracting claims from research output`);

  const cited = await loadCitedPassages(runId, reportId);
  const citedIds = new Set(cited.keys());
  const batches = passagesForExtraction(chunks, citedIds);

  const claims: ExtractedClaim[] = [];
  const seenClaims = new Map<string, ExtractedClaim>();

  for (const [index, batch] of batches.entries()) {
    const chunkContext = batch
      .map(c => {
        const quotes = cited.get(idKey(c.id))?.quotes ?? [];
        const citedLine = cited.has(idKey(c.id)) ? `\nCited in the report${quotes.length > 0 ? `, which quotes: ${quotes.map((quote) => `"${quote}"`).join(' ')}` : ''}` : '';
        return `[CHUNK ${c.id}] Source: ${c.source_url || c.source_title || 'unknown'}\n${c.content.slice(0, 300)}${citedLine}`;
      })
      .join('\n---\n');

    try {
      const result = await callRoleModel({
        role: 'verifier', // Use verifier role for structured extraction
        engineVersion: args.engineVersion,
        researchObjective: args.researchObjective,
        allowFallbackByRole: args.allowFallbackByRole,
        byokApiKeyOverride: args.byokApiKeyOverride,
        messages: [
          { role: 'system', content: withPreamble(CLAIM_EXTRACTOR_PROMPT) },
          {
            role: 'user',
            content: `Research Query: ${researchQuery}\n\nEvidence Chunks:\n${chunkContext}\n\nReasoner Output:\n${reasonerOutput.slice(0, MAX_REASONER_CONTEXT_CHARS)}\n\nSynthesizer Output:\n${synthesizerOutput.slice(0, MAX_SYNTHESIZER_CONTEXT_CHARS)}\n\n${cited.size > 0 ? CITED_PASSAGES_NOTE : ''}${index > 0 ? LATER_CALL_NOTE : ''}Extract all discrete claims. Output JSON array only.`,
          },
        ],
        maxTokens: 4096,
      });

      const parsed = extractJsonArray<ExtractedClaim>(result.content, { context: `claims:${runId}` });
      for (const claim of parsed ?? []) {
        if (!(claim.claim_text && claim.evidence_tier && typeof claim.confidence === 'number')) continue;
        // A later call reads further passages of the same report and may restate a finding already taken.
        // It is kept once, and the passages the later call names for it are added to it:
        // they are that finding's too, and the reading page lists a finding's passages from them.
        const key = batches.length > 1 ? claim.claim_text.trim().toLowerCase() : '';
        const earlier = key ? seenClaims.get(key) : undefined;
        if (earlier) {
          const merged = Array.isArray(earlier.supporting_chunk_ids) ? [...earlier.supporting_chunk_ids] : [];
          for (const id of Array.isArray(claim.supporting_chunk_ids) ? claim.supporting_chunk_ids : []) {
            if (!merged.includes(id)) merged.push(id);
          }
          earlier.supporting_chunk_ids = merged;
          continue;
        }
        if (key) seenClaims.set(key, claim);
        claims.push(claim);
      }
    } catch (err) {
      logger.warn(`[claims:${runId}] Claim extraction failed${batches.length > 1 ? ` (call ${index + 1} of ${batches.length})` : ''}:`, err);
      // The first call failing is what it always was: no findings. A later call
      // failing costs the findings of its own passages and keeps the rest.
      if (index === 0) return [];
    }
  }

  if (claims.length === 0) {
    logger.info(`[claims:${runId}] No claims extracted`);
    return [];
  }

  const wave53Maps = args.wave53?.sourceClassMap ?? args.wave53?.sourceClassByChunkId;
  const wave53Steelman = args.wave53?.steelmanByClaimText;
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const knownIds = new Map(chunks.map((c) => [idKey(c.id), c.id]));

  // Persist claims
  await withTransaction(async (client) => {
    for (const claim of claims) {
      // With saved citations the finding is tied to them; without, it is filed as it always was.
      const tied = cited.size > 0 ? resolveFindingPassages(claim.supporting_chunk_ids, knownIds, cited) : null;
      const chunkId = tied ? tied.chunkId : claim.supporting_chunk_ids?.[0] ?? null;
      const sourceId = tied ? tied.sourceId : claim.source_ids?.[0] ?? null;
      const supportingChunkIds = tied ? tied.supporting : claim.supporting_chunk_ids ?? [];
      const sourceUrl = chunkId ? chunkById.get(chunkId)?.source_url : undefined;
      const sourceClass =
        wave53Maps && chunkId
          ? resolveSourceClassForChunk(chunkId, wave53Maps, sourceUrl)
          : null;
      const steelmanSummary =
        wave53Steelman?.get(normalizeClaimKeyForSteelman(claim.claim_text)) ?? null;

      try {
        await client.query(
          `INSERT INTO claims (
             chunk_id, source_id, claim_text, evidence_tier, confidence,
             tags, run_id, report_id, stance_summary,
             supporting_chunk_ids, contradicting_chunk_ids,
             source_class, steelman_summary
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT DO NOTHING`,
          [
            chunkId,
            sourceId,
            claim.claim_text,
            claim.evidence_tier,
            Math.min(1, Math.max(0, claim.confidence)),
            claim.tags ?? [],
            runId,
            reportId,
            claim.stance_summary ?? null,
            supportingChunkIds,
            [], // contradicting_chunk_ids populated by contradiction extractor
            sourceClass,
            steelmanSummary,
          ]
        );
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === '42703') {
          await client.query(
            `INSERT INTO claims (
               chunk_id, source_id, claim_text, evidence_tier, confidence,
               tags, run_id, report_id, stance_summary,
               supporting_chunk_ids, contradicting_chunk_ids
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT DO NOTHING`,
            [
              chunkId,
              sourceId,
              claim.claim_text,
              claim.evidence_tier,
              Math.min(1, Math.max(0, claim.confidence)),
              claim.tags ?? [],
              runId,
              reportId,
              claim.stance_summary ?? null,
              supportingChunkIds,
              [],
            ]
          );
        } else {
          throw err;
        }
      }
    }
  });

  logger.info(`[claims:${runId}] Persisted ${claims.length} claims`);
  return claims;
}
