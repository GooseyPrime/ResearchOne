export interface DeterministicMetricCheck {
  metric: string;
  parsedValue: number | null;
  unit: string | null;
  formula: string;
  assumptions: string[];
  sourceIds: string[];
}

interface UnitSummary {
  count: number;
  minValue: number;
  maxValue: number;
  meanValue: number;
}

const MAGNITUDE_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  mm: 1_000_000,
  mn: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
  t: 1_000_000_000_000,
  trillion: 1_000_000_000_000,
};

function parseNumberFromText(value: string): number | null {
  const normalized = value.replace(/,/g, '');
  const compactMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*(k|m|mm|mn|b|bn|t)\b(?!\s*\/)/i);
  const wordMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b/i);
  const plainMatch = normalized.match(/-?\d+(\.\d+)?/);

  const matched = compactMatch ?? wordMatch;
  if (matched) {
    const magnitude = matched[2]?.toLowerCase();
    const base = Number(matched[1]);
    const multiplier = magnitude ? MAGNITUDE_MULTIPLIERS[magnitude] : undefined;
    if (!Number.isFinite(base) || multiplier == null) return null;
    const scaled = base * multiplier;
    return Number.isFinite(scaled) ? scaled : null;
  }

  if (!plainMatch) return null;
  const parsed = Number(plainMatch[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUnitFromText(value: string): string | null {
  if (/%/.test(value)) return '%';
  if (/\$|usd|dollar/i.test(value)) return 'USD';
  const unitMatch = value.match(/(?:\d|\.)\s*([a-zA-Z]+(?:\/[a-zA-Z]+)?)$/);
  if (!unitMatch?.[1]) return null;
  return unitMatch[1].toLowerCase();
}

export function normalizeDeterministicMetricChecks(metrics: Array<{ metric: string; value: string }>): {
  checks: DeterministicMetricCheck[];
  summary: {
    numericMetricCount: number;
    unitSummaries: Record<string, UnitSummary>;
    crossUnitAggregationBlocked: boolean;
  };
} {
  const checks: DeterministicMetricCheck[] = metrics.map((item) => {
    const parsedValue = parseNumberFromText(item.value);
    const unit = parseUnitFromText(item.value);
    return {
      metric: item.metric,
      parsedValue,
      unit,
      formula: parsedValue == null ? 'literal_extraction_unavailable' : 'literal_extraction',
      assumptions: [
        ...(parsedValue == null ? ['non_numeric_metric_value'] : []),
        ...(parsedValue != null && unit == null ? ['unit_missing'] : []),
      ],
      sourceIds: ['unspecified'],
    };
  });
  const numericChecks = checks.filter((item) => item.parsedValue != null);
  const byUnit = new Map<string, number[]>();
  for (const check of numericChecks) {
    const key = check.unit ?? 'unitless';
    const values = byUnit.get(key) ?? [];
    values.push(check.parsedValue as number);
    byUnit.set(key, values);
  }
  const unitSummaries: Record<string, UnitSummary> = {};
  for (const [unit, values] of byUnit.entries()) {
    const sum = values.reduce((acc, value) => acc + value, 0);
    unitSummaries[unit] = {
      count: values.length,
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      meanValue: sum / values.length,
    };
  }

  return {
    checks,
    summary: {
      numericMetricCount: numericChecks.length,
      unitSummaries,
      crossUnitAggregationBlocked: byUnit.size > 1,
    },
  };
}
