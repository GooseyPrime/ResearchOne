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
  const specialistSignalCount = countUsableSignals(args.specialistOutputs);
  const usableSignalCount = specialistSignalCount + Math.max(0, args.citableChunkCount);
  const gaps = collectEvidenceGaps(args.specialistOutputs, args.citableChunkCount);

  if (specialistSignalCount > 0 && args.citableChunkCount > 0) {
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
  const gapBullets = args.gaps.map((gap) => `- ${gap}`).join('\n');
  const warningBlock = '> LOW-EVIDENCE DELIVERY — requested artifact produced with explicit uncertainty labels.\n> Independent evidence was insufficient; assertions below are unverified and should not be relied upon without further research.';

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
      warningBlock,
      '',
      ...rows,
    ].join('\n\n');
  }

  if (args.intentId === 'comparative') {
    return [
      '# Comparative Analysis',
      '',
      warningBlock,
      '',
      '## Comparison Dimensions',
      '',
      '| Dimension | Option A | Option B | Notes |',
      '|-----------|----------|----------|-------|',
      '| — | Evidence insufficient | Evidence insufficient | Verify independently |',
      '',
      '## Evidence Gaps',
      '',
      gapBullets,
      '',
      '## Provisional Assessment',
      '',
      'Insufficient independent evidence was retrieved to support a confident comparison. The dimensions table above is a placeholder; populate with sourced data before use.',
    ].join('\n');
  }

  if (args.intentId === 'feasibility') {
    return [
      '# Feasibility Assessment',
      '',
      warningBlock,
      '',
      '## Summary',
      '',
      '**Viability Rating: INDETERMINATE** — evidence was insufficient to assess technical, financial, or market feasibility with confidence.',
      '',
      '## Key Dimensions',
      '',
      '- **Technical feasibility:** Unverified — no independent sources confirmed.',
      '- **Financial feasibility:** Unverified — cost and revenue estimates unavailable.',
      '- **Market feasibility:** Unverified — demand and competitive landscape not confirmed.',
      '',
      '## Risks',
      '',
      '- Evidence gaps listed below represent primary research risks.',
      '',
      '## Evidence Gaps',
      '',
      gapBullets,
      '',
      '## Recommendation',
      '',
      '**Go/No-go: Indeterminate.** Conduct targeted evidence gathering to fill the gaps above before proceeding.',
    ].join('\n');
  }

  if (args.intentId === 'recommendation') {
    return [
      '# Recommendation',
      '',
      warningBlock,
      '',
      '## Constraints Considered',
      '',
      '- Evidence base was insufficient to fully evaluate constraints.',
      '',
      '## Options Evaluated',
      '',
      '- No independently-sourced options could be ranked with confidence.',
      '',
      '## Recommendation',
      '',
      '**Low-confidence recommendation:** Evidence was insufficient to support a definitive recommendation. Address the evidence gaps below before acting.',
      '',
      '## Trade-offs',
      '',
      '- Trade-off analysis requires additional verified evidence.',
      '',
      '## Evidence Gaps',
      '',
      gapBullets,
    ].join('\n');
  }

  if (args.intentId === 'implementation' || args.intentId === 'how_to') {
    return [
      `# ${args.intentId === 'how_to' ? 'How-To Guide' : 'Implementation Plan'}`,
      '',
      warningBlock,
      '',
      '## Prerequisites',
      '',
      '- Prerequisites could not be verified from available evidence.',
      '',
      '## Steps',
      '',
      '1. **[Step 1 — Unverified]** Conduct independent research to fill evidence gaps before following this guide.',
      '2. **[Step 2 — Placeholder]** Verify prerequisites against authoritative sources.',
      '3. **[Step 3 — Placeholder]** Validate each step with domain-specific evidence.',
      '',
      '## Evidence Gaps',
      '',
      gapBullets,
      '',
      '## Outcomes',
      '',
      'Expected outcomes could not be confirmed from available evidence. Treat this guide as a starting scaffold only.',
    ].join('\n');
  }

  return [
    '# Research Report',
    '',
    warningBlock,
    '',
    'Independent evidence was insufficient in this pass.',
    '',
    gapBullets,
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
