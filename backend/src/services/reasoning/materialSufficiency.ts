import { logger } from '../../utils/logger';
import { callRoleModel } from '../openrouter/openrouterService';
import { stripGradeLines } from './baselineReport';
import type { EvidenceSufficiencyResult } from './sourceSufficiencyGate';
import { REPORT_QUALITY_FALLBACK, REPORT_QUALITY_MODEL } from '../eval/reportQualityPrompt';

export interface MaterialJudgement {
  sufficient: boolean;
  reason: string;
  missing: string[];
}

export type MaterialStep = 'proceed' | 'discover_once' | 'stop' | 'use_gate';

export function parseMaterialJudgement(raw: string): MaterialJudgement | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { sufficient?: unknown; reason?: unknown; missing?: unknown };
    if (typeof parsed.sufficient !== 'boolean') return null;
    return {
      sufficient: parsed.sufficient,
      reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
      missing: Array.isArray(parsed.missing) ? parsed.missing.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [],
    };
  } catch {
    return null;
  }
}

export type ReaderSearchSituation = 'search_ran' | 'search_unavailable' | 'search_off_by_request';

export function readerInsufficientMessage(missing: string[], situation: ReaderSearchSituation): string {
  const gaps = missing
    .map((item) => item.replace(/\s+/g, ' ').trim().replace(/[.]+$/, ''))
    .filter(Boolean)
    .map((item) => `${item.charAt(0).toUpperCase()}${item.slice(1)}.`);
  const gapText = gaps.length > 0 ? ` ${gaps.join(' ')}` : '';
  if (situation === 'search_ran') {
    return `The supplied information is not enough to properly fulfil this request.${gapText} Outside search ran and did not find enough. Add sources, or narrow the request.`;
  }
  if (situation === 'search_off_by_request') {
    return `The supplied information is not enough to properly fulfil this request.${gapText} Outside search was not used for this request. Add sources, or run it again with outside search.`;
  }
  return `The supplied information is not enough to properly fulfil this request.${gapText} Add sources that cover what is missing.`;
}

/**
 * The material judge decides whether a non-adjudicative switched-on run can be written.
 * A sealed corpus is a designed state and is not itself a reason to stop.
 * A failed judge does not pass and does not skip a search; the count gate is used and logged.
 */
export function materialStep(args: {
  judgement: MaterialJudgement | null;
  judgeFailed: boolean;
  discoveryAvailable: boolean;
  extraPassUsed: boolean;
}): MaterialStep {
  if (args.judgeFailed || !args.judgement) return 'use_gate';
  if (args.judgement.sufficient) return 'proceed';
  if (args.discoveryAvailable && !args.extraPassUsed) return 'discover_once';
  return 'stop';
}

export function gateFallbackStep(action: string, discoveryAvailable: boolean, extraPassUsed: boolean): MaterialStep {
  if (action === 'sufficient' || action === 'low_evidence_labeled_delivery') return 'proceed';
  if (action === 'rediscover' && discoveryAvailable && !extraPassUsed) return 'discover_once';
  return 'stop';
}

export function digestRetrievedMaterial(chunks: Array<{ label: string; text: string }>): string {
  return chunks
    .map((chunk, index) => `[CHUNK ${index + 1}] ${chunk.label}\n${stripGradeLines(chunk.text).slice(0, 500)}`)
    .join('\n\n');
}

export async function judgeRetrievedMaterial(args: {
  request: string;
  plan: unknown;
  material: string;
  engineVersion?: string;
  allowFallbackByRole?: Record<string, boolean> | null;
  byokApiKeyOverride?: string;
  callModel?: typeof callRoleModel;
}): Promise<{ judgement: MaterialJudgement | null; failed: boolean; attempts: number }> {
  const caller = args.callModel ?? callRoleModel;
  const material = stripGradeLines(args.material);
  const prompt = `Request:\n${args.request}\n\nPlan:\n${JSON.stringify(args.plan).slice(0, 2000)}\n\nRetrieved material:\n${material}\n\nA sealed shared corpus is not missing material. Judge only the material above. Is it of suitable quality and content to answer the request? Return strict JSON only: {"sufficient":boolean,"reason":string,"missing":string[]}`;
  const attempts = [
    { primary: REPORT_QUALITY_MODEL, fallback: REPORT_QUALITY_FALLBACK },
    { primary: REPORT_QUALITY_FALLBACK, fallback: REPORT_QUALITY_MODEL },
  ];
  for (const [index, overrides] of attempts.entries()) {
    try {
      const result = await caller({
        role: 'verifier',
        engineVersion: args.engineVersion,
        allowFallbackByRole: args.allowFallbackByRole,
        byokApiKeyOverride: args.byokApiKeyOverride,
        baselineLayer: false,
        runtimeOverrides: overrides,
        messages: [
          { role: 'system', content: 'Judge whether the retrieved material can answer the request. Return JSON only.' },
          { role: 'user', content: prompt },
        ],
      });
      const judgement = parseMaterialJudgement(result.content);
      if (judgement) return { judgement, failed: false, attempts: index + 1 };
      logger.warn('material_judgement_unparseable', { attempt: index + 1 });
    } catch (err) {
      logger.warn('material_judgement_failed', { attempt: index + 1, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { judgement: null, failed: true, attempts: attempts.length };
}

export function logGateFallback(runId: string, gate: Pick<EvidenceSufficiencyResult, 'action' | 'reason'>): void {
  logger.warn('material_judgement_fell_back_to_source_gate', { runId, action: gate.action, reason: gate.reason });
}
