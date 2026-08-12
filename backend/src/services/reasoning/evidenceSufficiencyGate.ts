import type { IntentId } from '../planning/intentTaxonomy';

export interface EvidenceSufficiencyResult {
  action: 'sufficient' | 'rediscover' | 'low_evidence_labeled_delivery';
  reason: 'sufficient' | 'insufficient_evidence';
  gaps: string[];
  usableSignalCount: number;
}

export function assessEvidenceSufficiency(args: {
  intentId?: IntentId;
  citableChunkCount: number;
  specialistOutputs: Record<string, unknown>;
  rediscoveryPassesRemaining: number;
  requestedArtifactCount?: number;
}): EvidenceSufficiencyResult {
  const usableSignalCount = countUsableSignals(args.specialistOutputs) + Math.max(0, args.citableChunkCount);
  const gaps = collectEvidenceGaps(args.specialistOutputs, args.citableChunkCount);

  if (usableSignalCount > 0 && args.citableChunkCount > 0) {
    return {
      action: 'sufficient',
      reason: 'sufficient',
      gaps: [],
      usableSignalCount,
    };
  }

  const nonAdjudicative =
    args.intentId !== 'adjudication'
    && args.intentId !== 'investigation'
    && args.intentId !== 'story_verification'
    && args.intentId !== 'position_brief';

  if (args.rediscoveryPassesRemaining > 0) {
    return {
      action: 'rediscover',
      reason: 'insufficient_evidence',
      gaps,
      usableSignalCount,
    };
  }

  return {
    action: nonAdjudicative ? 'low_evidence_labeled_delivery' : 'rediscover',
    reason: 'insufficient_evidence',
    gaps,
    usableSignalCount,
  };
}

export function buildLowEvidenceLabeledDelivery(args: {
  intentId?: IntentId;
  requestedArtifactCount?: number;
  gaps: string[];
}): string {
  if (args.intentId === 'opportunity_discovery') {
    const count = Math.max(1, args.requestedArtifactCount ?? 10);
    const rows = Array.from({ length: count }, (_, index) => (
      `## Opportunity ${index + 1}\n` +
      `- Status: LOW-EVIDENCE DELIVERY\n` +
      `- Confidence: Low\n` +
      `- What is known: External evidence was insufficient in this pass.\n` +
      `- What remains unknown: ${args.gaps[index % Math.max(1, args.gaps.length)] ?? 'Independent market validation is still needed.'}\n` +
      `- Next evidence to seek: Independent sources on demand, competition, pricing, and regulatory constraints.`
    ));
    return [
      '# Opportunity Discovery Report',
      '',
      '> LOW-EVIDENCE DELIVERY — requested artifact produced with explicit uncertainty labels.',
      '',
      ...rows,
    ].join('\n\n');
  }

  return [
    '# Research Report',
    '',
    '> LOW-EVIDENCE DELIVERY — requested artifact produced with explicit uncertainty labels.',
    '',
    'Independent evidence was insufficient in this pass.',
    '',
    ...args.gaps.map((gap) => `- ${gap}`),
  ].join('\n');
}

export function shouldBypassRepairLoopForEvidence(reason?: string | null): boolean {
  return reason === 'insufficient_evidence';
}

function countUsableSignals(outputs: Record<string, unknown>): number {
  let count = 0;
  for (const output of Object.values(outputs)) {
    if (!output || typeof output !== 'object') continue;
    const record = output as Record<string, unknown>;
    for (const key of ['opportunities', 'competitors', 'signals', 'buildable_paths', 'metrics', 'events', 'corroborating']) {
      if (Array.isArray(record[key])) {
        count += record[key].length;
      }
    }
  }
  return count;
}

function collectEvidenceGaps(outputs: Record<string, unknown>, citableChunkCount: number): string[] {
  const gaps: string[] = [];
  if (citableChunkCount === 0) {
    gaps.push('No citable corpus evidence cleared the competence gate.');
  }
  for (const [agent, output] of Object.entries(outputs)) {
    if (!output || typeof output !== 'object') {
      gaps.push(`${agent}: no structured output`);
      continue;
    }
    const record = output as Record<string, unknown>;
    if (Array.isArray(record.opportunities) && record.opportunities.length === 0) {
      gaps.push(`${agent}: zero relevant opportunities extracted`);
    }
    if (Array.isArray(record.competitors) && record.competitors.length === 0) {
      gaps.push(`${agent}: no competitor landscape recovered`);
    }
    if (Array.isArray(record.signals) && record.signals.length === 0) {
      gaps.push(`${agent}: no demand signals recovered`);
    }
    if (Array.isArray(record.metrics) && record.metrics.length === 0) {
      gaps.push(`${agent}: zero quantitative data points extracted`);
    }
  }
  return gaps.length > 0 ? gaps : ['Specialists reported insufficient independent evidence.'];
}
