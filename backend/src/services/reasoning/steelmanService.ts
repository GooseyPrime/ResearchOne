/**
 * Wave 5.3 — Steelman pass between reasoner output and skeptic challenge.
 */
import { callRoleModel, SYSTEM_PROMPTS, type ModelCallResult } from '../openrouter/openrouterService';
import type { ResearchObjective } from './reasoningModelPolicy';
import type { RetrievedChunk } from '../retrieval/retrievalService';
import type { SteelmanMode } from '../planning/orchestrationProfiles';
import type { SourceClassMap } from '../planning/wave53EpistemicPolicy';
import { logger } from '../../utils/logger';

export interface SteelmanPassResult {
  steelmanByClaimKey: Map<string, string>;
  passCount: number;
  modelResult: ModelCallResult | null;
}

export function normalizeClaimKeyForSteelman(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Heuristic extraction of candidate factual claims from reasoner prose. */
export function extractCandidateClaimsFromReasoner(reasonerMarkdown: string, maxClaims = 22): string[] {
  const lines = reasonerMarkdown.split(/\r?\n/);
  const claims: string[] = [];
  const bullet = /^\s*(?:[-*•]|\d+\.|[a-z]\))\s+(.{12,600})$/i;

  for (const line of lines) {
    const m = line.match(bullet);
    if (m?.[1]) {
      const t = m[1].trim();
      if (t.length >= 12 && !t.startsWith('http')) claims.push(t);
    }
    if (claims.length >= maxClaims) break;
  }

  if (claims.length < 3) {
    const fallback = reasonerMarkdown
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 40 && p.length <= 500);
    for (const p of fallback) {
      if (!claims.includes(p)) claims.push(p);
      if (claims.length >= maxClaims) break;
    }
  }

  return [...new Set(claims.map((c) => c.trim()))].slice(0, maxClaims);
}

function parseSteelmanJson(raw: string): Record<string, string> {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return {};
    const parsed = JSON.parse(m[0]) as {
      steelman_by_claim_id?: Record<string, string>;
    };
    const bag = parsed.steelman_by_claim_id ?? {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(bag)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function evidenceSnippet(chunks: RetrievedChunk[]): string {
  return chunks
    .slice(0, 12)
    .map((c) => `[${c.id}] ${c.source_title || c.source_url || 'source'}\n${c.content.slice(0, 280)}`)
    .join('\n---\n');
}

export async function runSteelmanPass(args: {
  reasonerOutput: string;
  chunks: RetrievedChunk[];
  steelmanMode: SteelmanMode;
  /** Reserved for future prompt shaping / telemetry — callers still thread corpus classification through for parity with orchestrator contracts. */
  sourceClassMap: SourceClassMap;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  byokApiKeyOverride?: string;
}): Promise<SteelmanPassResult> {
  void args.sourceClassMap;
  if (args.steelmanMode === 'off') {
    return { steelmanByClaimKey: new Map(), passCount: 0, modelResult: null };
  }

  const candidates = extractCandidateClaimsFromReasoner(args.reasonerOutput);
  if (candidates.length === 0) {
    return { steelmanByClaimKey: new Map(), passCount: 0, modelResult: null };
  }

  const payload = candidates.map((text, i) => ({
    id: `c${i}`,
    claim_text: text,
  }));

  let modeHint = '';
  if (args.steelmanMode === 'per_option') {
    modeHint =
      'MODE per_option: Group claims that correspond to distinct competing options and steelman each option independently.';
  } else if (args.steelmanMode === 'as_product') {
    modeHint =
      'MODE as_product: Produce the strongest overall affirmative brief — prioritize clarity and completeness as if this were the flagship deliverable.';
  } else if (args.steelmanMode === 'symmetric') {
    modeHint =
      'MODE symmetric: For each claim_id, include BOTH the strongest charitable case for and the strongest charitable case against in one paragraph (label AFFIRM / DENY inline).';
  } else {
    modeHint = 'MODE standard: One concise steelman paragraph per claim id.';
  }

  const userBody =
    `${modeHint}\n\n` +
    `Return strict JSON { "steelman_by_claim_id": { "<id>": "<paragraph>" } } using the ids provided.\n\n` +
    `Claims:\n${JSON.stringify(payload, null, 2)}\n\n` +
    `Evidence snippets:\n${evidenceSnippet(args.chunks)}`;

  try {
    const modelResult = await callRoleModel({
      role: 'steelman',
      engineVersion: args.engineVersion,
      researchObjective: args.researchObjective,
      allowFallbackByRole: args.allowFallbackByRole,
      byokApiKeyOverride: args.byokApiKeyOverride,
      messages: [
        { role: 'system', content: SYSTEM_PROMPTS.steelman },
        { role: 'user', content: userBody },
      ],
      maxTokens: 8192,
    });

    const parsed = parseSteelmanJson(modelResult.content);
    const steelmanByClaimKey = new Map<string, string>();
    for (let i = 0; i < candidates.length; i++) {
      const id = `c${i}`;
      const paragraph = parsed[id];
      if (paragraph) {
        steelmanByClaimKey.set(normalizeClaimKeyForSteelman(candidates[i]!), paragraph);
      }
    }

    const passCount = steelmanByClaimKey.size > 0 ? 1 : 0;
    return { steelmanByClaimKey, passCount, modelResult };
  } catch (e) {
    logger.warn('[steelman] pass failed', { error: e instanceof Error ? e.message : String(e) });
    return { steelmanByClaimKey: new Map(), passCount: 0, modelResult: null };
  }
}

export function formatSteelmanBlockForSkeptic(steelmanByClaimKey: Map<string, string>): string {
  if (steelmanByClaimKey.size === 0) return '';
  const lines: string[] = [
    '',
    'STEELMAN CONTEXT (attack these strengthened formulations, not a strawman):',
  ];
  let i = 1;
  for (const [claim, steel] of steelmanByClaimKey.entries()) {
    lines.push(`${i}. Claim: ${claim}`);
    lines.push(`   Steelman: ${steel}`);
    i++;
  }
  return lines.join('\n');
}
