/**
 * Claim extractor.
 * Extracts discrete, machine-queryable claim records from research outputs.
 * Claims are persisted to the claims table with evidence tier, confidence,
 * and chunk linkage for later querying without reparsing prose.
 */

import { withTransaction } from '../../db/pool';
import { callRoleModel } from '../openrouter/openrouterService';
import type { ResearchObjective } from './reasoningModelPolicy';
import { withPreamble } from '../../constants/prompts';
import { RetrievedChunk } from '../retrieval/retrievalService';
import { logger } from '../../utils/logger';

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

export async function extractAndPersistClaims(args: {
  runId: string;
  reportId: string;
  researchQuery: string;
  chunks: RetrievedChunk[];
  reasonerOutput: string;
  synthesizerOutput: string;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbacks?: boolean;
}): Promise<ExtractedClaim[]> {
  const { runId, reportId, researchQuery, chunks, reasonerOutput, synthesizerOutput } = args;

  logger.info(`[claims:${runId}] Extracting claims from research output`);

  const chunkContext = chunks
    .slice(0, 30) // limit context size
    .map(c => `[CHUNK ${c.id}] Source: ${c.source_url || c.source_title || 'unknown'}\n${c.content.slice(0, 300)}`)
    .join('\n---\n');

  let claims: ExtractedClaim[] = [];

  try {
    const result = await callRoleModel({
      role: 'verifier', // Use verifier role for structured extraction
      engineVersion: args.engineVersion,
      researchObjective: args.researchObjective,
      allowFallbacks: args.allowFallbacks === true ? true : undefined,
      messages: [
        { role: 'system', content: withPreamble(CLAIM_EXTRACTOR_PROMPT) },
        {
          role: 'user',
          content: `Research Query: ${researchQuery}\n\nEvidence Chunks:\n${chunkContext}\n\nReasoner Output:\n${reasonerOutput.slice(0, MAX_REASONER_CONTEXT_CHARS)}\n\nSynthesizer Output:\n${synthesizerOutput.slice(0, MAX_SYNTHESIZER_CONTEXT_CHARS)}\n\nExtract all discrete claims. Output JSON array only.`,
        },
      ],
      maxTokens: 4096,
    });

    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as ExtractedClaim[];
      claims = parsed.filter(c => c.claim_text && c.evidence_tier && typeof c.confidence === 'number');
    }
  } catch (err) {
    logger.warn(`[claims:${runId}] Claim extraction failed:`, err);
    return [];
  }

  if (claims.length === 0) {
    logger.info(`[claims:${runId}] No claims extracted`);
    return [];
  }

  // Persist claims
  await withTransaction(async (client) => {
    for (const claim of claims) {
      const chunkId = claim.supporting_chunk_ids?.[0] ?? null;
      const sourceId = claim.source_ids?.[0] ?? null;

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
          claim.supporting_chunk_ids ?? [],
          [], // contradicting_chunk_ids populated by contradiction extractor
        ]
      );
    }
  });

  logger.info(`[claims:${runId}] Persisted ${claims.length} claims`);
  return claims;
}
