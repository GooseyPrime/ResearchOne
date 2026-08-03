import { describe, expect, it } from 'vitest';

import { normalizeDeterministicMetricChecks } from '../services/reasoning/deterministicQuant';

describe('deterministicQuant', () => {
  it('parses numeric values and blocks cross-unit aggregation', () => {
    const result = normalizeDeterministicMetricChecks([
      { metric: 'Growth', value: '12.5%' },
      { metric: 'ARR', value: '$240000' },
      { metric: 'Qualitative confidence', value: 'high' },
    ]);

    expect(result.summary.numericMetricCount).toBe(2);
    expect(result.summary.unitSummaries['%']?.meanValue).toBe(12.5);
    expect(result.summary.unitSummaries['USD']?.meanValue).toBe(240000);
    expect(result.summary.crossUnitAggregationBlocked).toBe(true);
    expect(result.checks[2]?.parsedValue).toBeNull();
  });

  it('normalizes magnitude suffixes and words', () => {
    const result = normalizeDeterministicMetricChecks([
      { metric: 'TAM', value: '$1.2M' },
      { metric: 'Users', value: '500k users' },
      { metric: 'Market', value: '3 billion USD' },
    ]);

    expect(result.checks[0]?.parsedValue).toBe(1_200_000);
    expect(result.checks[1]?.parsedValue).toBe(500_000);
    expect(result.checks[2]?.parsedValue).toBe(3_000_000_000);
    expect(result.summary.unitSummaries.USD?.count).toBe(2);
  });
});
