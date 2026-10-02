import { logger } from '../../utils/logger';
import { callRoleModel } from '../openrouter/openrouterService';
import { stripGradeLines } from './baselineReport';
import type { EvidenceSufficiencyResult } from './sourceSufficiencyGate';

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

export function readerInsufficientMessage(missing: string[], discoveryWasPartOfRun: boolean): string {
  const gaps = missing
    .map((item) => item.replace(/\s+/g, ' ').trim().replace(/[.]+$/, ''))
    .filter(Boolean)
    .map((item) => `${item.charAt(0).toUpperCase()}${item.slice(1)}.`);
  const gapText = gaps.length > 0 ? ` ${gaps.join(' ')}` : '';
  const searchLine = discoveryWasPartOfRun
    ? 'Run it again with outside search so the right sources can be found.'
    : 'Outside search was not part of this run. Run it again with outside search so the right sources can be found.';
  return `The supplied information is not enough to properly fulfil this request.${gapText} ${searchLine}`;
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
  corpusSealedByDesign: boolean;
}): MaterialStep {
  if (args.corpusSealedByDesign && !args.judgeFailed) return 'proceed';
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
  const material = stripGradeLines(args.material).slice(0, 8000);
  const prompt = `Request:\n${args.request}\n\nPlan:\n${JSON.stringify(args.plan).slice(0, 2000)}\n\nRetrieved material:\n${material}\n\nIs this material of suitable quality and content to answer the request? A corpus sealed by design is a designed state, not a lack of material. Return strict JSON only: {"sufficient":boolean,"reason":string,"missing":string[]}`;
  const roles = ['verifier', 'internal_challenger'] as const;
  for (const role of roles) {
    try {
      const result = await caller({
        role,
        engineVersion: args.engineVersion,
        allowFallbackByRole: args.allowFallbackByRole,
        byokApiKeyOverride: args.byokApiKeyOverride,
        baselineLayer: false,
        messages: [
          { role: 'system', content: 'Judge whether the retrieved material can answer the request. Return JSON only.' },
          { role: 'user', content: prompt },
        ],
      });
      const judgement = parseMaterialJudgement(result.content);
      if (judgement) return { judgement, failed: false, attempts: roles.indexOf(role) + 1 };
      logger.warn('material_judgement_unparseable', { role });
    } catch (err) {
      logger.warn('material_judgement_failed', { role, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { judgement: null, failed: true, attempts: roles.length };
}

export function logGateFallback(runId: string, gate: Pick<EvidenceSufficiencyResult, 'action' | 'reason'>): void {
  logger.warn('material_judgement_fell_back_to_source_gate', { runId, action: gate.action, reason: gate.reason });
}
