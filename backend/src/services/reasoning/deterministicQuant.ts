export interface DeterministicMetricCheck {
  metric: string;
  parsedValue: number | null;
  unit: string | null;
  formula: string;
  assumptions: string[];
  sourceIds: string[];
}

function parseNumberFromText(value: string): number | null {
  const cleaned = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!cleaned) return null;
  const parsed = Number(cleaned[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUnitFromText(value: string): string | null {
  const unitMatch = value.match(/(?:\d|\.)\s*([a-zA-Z%\/]+)$/);
  if (!unitMatch) return null;
  return unitMatch[1] ?? null;
}

export function normalizeDeterministicMetricChecks(metrics: Array<{ metric: string; value: string }>): {
  checks: DeterministicMetricCheck[];
  summary: {
    numericMetricCount: number;
    minValue: number | null;
    maxValue: number | null;
    meanValue: number | null;
  };
} {
  const checks: DeterministicMetricCheck[] = metrics.map((item) => {
    const parsedValue = parseNumberFromText(item.value);
    return {
      metric: item.metric,
      parsedValue,
      unit: parseUnitFromText(item.value),
      formula: 'literal_extraction',
      assumptions: parsedValue == null ? ['non_numeric_metric_value'] : [],
      sourceIds: [],
    };
  });
  const numericValues = checks.map((item) => item.parsedValue).filter((value): value is number => value != null);
  const meanValue =
    numericValues.length > 0 ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length : null;
  return {
    checks,
    summary: {
      numericMetricCount: numericValues.length,
      minValue: numericValues.length > 0 ? Math.min(...numericValues) : null,
      maxValue: numericValues.length > 0 ? Math.max(...numericValues) : null,
      meanValue,
    },
  };
}
