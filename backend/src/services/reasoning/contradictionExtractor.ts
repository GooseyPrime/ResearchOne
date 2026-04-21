/**
 * Contradiction extractor.
 * Identifies contradictions between claims and persists them as first-class records.
 * Contradictions are never suppressed — they are investigation targets.
 */

import { query, withTransaction } from '../../db/pool';
import { callRoleModel } from '../openrouter/openrouterService';
import type { ResearchObjective } from './reasoningModelPolicy';
import { withPreamble } from '../../constants/prompts';
import { RetrievedChunk } from '../retrieval/retrievalService';
import { ExtractedClaim } from './claimExtractor';
import { logger } from '../../utils/logger';

export interface ExtractedContradiction {
  claim_a_text: string;
  claim_b_text: string;
  description: string;
  contradiction_type: string;
  severity_score: number; // 0.0–1.0
  severity: 'low' | 'medium' | 'high' | 'critical';
  supporting_chunk_ids_a: string[];
  supporting_chunk_ids_b: string[];
}

const CONTRADICTION_EXTRACTOR_PROMPT = `You are a contradiction analysis agent for ResearchOne.
Identify contradictions between claims and between evidence chunks.

CRITICAL RULES:
- Contradictions are first-class data — never suppress them
- Distinguish types: empirical_conflict, methodological_conflict, definitional_conflict, temporal_conflict, scope_conflict
- Score severity 0.0–1.0 (1.0 = direct logical contradiction, 0.1 = minor terminological tension)
- Do not invent contradictions not evidenced in the material
- Reference actual claim texts

Output a JSON array:
[
  {
    "claim_a_text": "string",
    "claim_b_text": "string",
    "description": "string",
    "contradiction_type": "empirical_conflict|methodological_conflict|definitional_conflict|temporal_conflict|scope_conflict",
    "severity_score": 0.0-1.0,
    "severity": "low|medium|high|critical",
    "supporting_chunk_ids_a": ["uuid", ...],
    "supporting_chunk_ids_b": ["uuid", ...]
  }
]`;

export async function extractAndPersistContradictions(args: {
  runId: string;
  reportId: string;
  chunks: RetrievedChunk[];
  claims: ExtractedClaim[];
  skepticOutput: string;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
}): Promise<ExtractedContradiction[]> {
  const { runId, reportId, chunks, claims, skepticOutput } = args;

  logger.info(`[contradictions:${runId}] Extracting contradictions`);

  if (claims.length === 0) {
    logger.info(`[contradictions:${runId}] No claims to analyse — skipping`);
    return [];
  }

  const claimsContext = claims
    .slice(0, 30)
    .map((c, i) => `[CLAIM ${i + 1}] (${c.evidence_tier}) ${c.claim_text}`)
    .join('\n');

  const chunkContext = chunks
    .slice(0, 15)
    .map(c => `[CHUNK ${c.id}]\n${c.content.slice(0, 200)}`)
    .join('\n---\n');

  let contradictions: ExtractedContradiction[] = [];

  try {
    const result = await callRoleModel({
      role: 'skeptic',
      engineVersion: args.engineVersion,
      researchObjective: args.researchObjective,
      callPurpose: 'contradiction_extraction',
      messages: [
        { role: 'system', content: withPreamble(CONTRADICTION_EXTRACTOR_PROMPT) },
        {
          role: 'user',
          content: `Claims:\n${claimsContext}\n\nSkeptic Analysis:\n${skepticOutput.slice(0, 2000)}\n\nEvidence Chunks:\n${chunkContext}\n\nIdentify all contradictions. Output JSON array only.`,
        },
      ],
      maxTokens: 4096,
    });

    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as ExtractedContradiction[];
      contradictions = parsed.filter(c => c.claim_a_text && c.claim_b_text && c.description);
    }
  } catch (err) {
    logger.warn(`[contradictions:${runId}] Contradiction extraction failed:`, err);
    return [];
  }

  if (contradictions.length === 0) {
    logger.info(`[contradictions:${runId}] No contradictions extracted`);
    return [];
  }

  // Look up claim IDs by text for FK linkage
  const claimRows = await query<{ id: string; claim_text: string }>(
    `SELECT id, claim_text FROM claims WHERE run_id=$1`,
    [runId]
  );
  const claimIdByText = new Map<string, string>(claimRows.map(r => [r.claim_text.trim(), r.id]));

  await withTransaction(async (client) => {
    for (const c of contradictions) {
      const claimAId = claimIdByText.get(c.claim_a_text.trim()) ?? null;
      const claimBId = claimIdByText.get(c.claim_b_text.trim()) ?? null;

      // Both claims must be findable for a proper FK link — insert with null if not found
      await client.query(
        `INSERT INTO contradictions (
           claim_a_id, claim_b_id, description, severity, resolved,
           run_id, report_id, contradiction_type, severity_score
         )
         VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8)`,
        [
          claimAId,
          claimBId,
          c.description,
          c.severity,
          runId,
          reportId,
          c.contradiction_type ?? 'empirical_conflict',
          Math.min(1, Math.max(0, c.severity_score ?? 0.5)),
        ]
      );
    }
  });

  logger.info(`[contradictions:${runId}] Persisted ${contradictions.length} contradictions`);
  return contradictions;
}
