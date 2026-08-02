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
});
