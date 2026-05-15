import { describe, it, expect } from 'vitest';
import {
  buildOrchestrationHeadline,
  countRanStagesFromDurations,
  parseJsonStringArray,
  parseStageDurationsRecord,
  totalStagesFromAgentsLists,
} from './dossierOrchestrationSummary';
import type { DossierStats } from '../utils/api';

function baseStats(over: Partial<DossierStats> = {}): DossierStats {
  return {
    totalDurationMs: 12_000,
    tokensInput: null,
    tokensOutput: null,
    sourcesRetrievedCount: null,
    sourcesCitedCount: null,
    citationDensity: null,
    skepticAnnotationsCount: null,
    contradictionsCount: null,
    refinementRounds: null,
    agentsRan: ['a', 'b', 'c'],
    agentsSkipped: ['x', 'y', 'z', 'w', 'v', 'u', 't', 's'],
    stageDurations: {
      _profileDisplayName: 'Reference lookup',
      _intentId: 'reference_lookup',
      planning: 10,
      discovery: 0,
    },
    modelsUsed: null,
    estimatedCostCents: null,
    actualCostCents: null,
    reportEvidenceTierSummary: null,
    ...over,
  };
}

describe('dossierOrchestrationSummary', () => {
  it('parseJsonStringArray handles arrays and JSON strings', () => {
    expect(parseJsonStringArray(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(parseJsonStringArray('["x","y"]')).toEqual(['x', 'y']);
    expect(parseJsonStringArray(null)).toEqual([]);
  });

  it('totalStagesFromAgentsLists sums ran + skipped', () => {
    expect(totalStagesFromAgentsLists(['a'], ['b', 'c'])).toBe(3);
  });

  it('countRanStagesFromDurations ignores meta keys', () => {
    expect(
      countRanStagesFromDurations({
        _profileDisplayName: 'X',
        _intentId: 'y',
        planning: 1,
        retrieval: null,
        synthesis: 40,
      }),
    ).toBe(2);
  });

  it('buildOrchestrationHeadline uses profile name and timing', () => {
    const h = buildOrchestrationHeadline(baseStats());
    expect(h).toContain('Reference lookup');
    expect(h).toContain('3 of 11');
    expect(h).toContain('12 seconds');
  });

  it('buildOrchestrationHeadline returns null when no orchestration lists', () => {
    expect(
      buildOrchestrationHeadline(
        baseStats({
          agentsRan: null,
          agentsSkipped: null,
        }),
      ),
    ).toBeNull();
  });

  it('falls back to intent label when profile missing', () => {
    const h = buildOrchestrationHeadline(
      baseStats({
        stageDurations: {},
        agentsRan: ['p'],
        agentsSkipped: ['q'],
      }),
      'Literature review',
    );
    expect(h).toContain('Literature review');
    expect(h).toContain('1 of 2');
  });

  it('parseStageDurationsRecord parses JSON string from API', () => {
    const raw = JSON.stringify({ _profileDisplayName: 'Survey', foo: 1 });
    expect(parseStageDurationsRecord(raw)._profileDisplayName).toBe('Survey');
  });
});
