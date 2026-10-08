import { readFileSync } from 'fs';
import { resolve } from 'path';
import { percentile, type EvalScores } from './scoreReport';

export interface FixtureDocument {
  name: string;
  role: 'side_a' | 'side_b' | 'anomaly';
  text: string;
}

export interface EvalTask {
  id: string;
  kind: 'factual' | 'survey' | 'challenge';
  intent: string;
  prompt: string;
  keyFacts?: string[];
  primarySource?: string;
  fixtureConflict?: string;
  anomalyPhrase?: string;
  fixtureDocuments?: FixtureDocument[];
}

export function loadEvalTasks(): EvalTask[] {
  const path = resolve(__dirname, '../../../../eval/tasks.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { tasks: EvalTask[] };
  return parsed.tasks;
}

export function summarizeScores(rows: Array<{ taskId: string; scores: EvalScores }>): Record<string, number | null> {
  const mean = (values: Array<number | null>): number | null => {
    const present = values.filter((value): value is number => value !== null);
    if (present.length === 0) return null;
    return present.reduce((sum, value) => sum + value, 0) / present.length;
  };
  const times = rows.map((row) => row.scores.time_to_report).filter((value): value is number => value !== null);
  const tokens = rows.map((row) => row.scores.tokens).filter((value): value is number => value !== null);
  return {
    answer_correct: mean(rows.map((row) => row.scores.answer_correct)),
    citation_bound: mean(rows.map((row) => row.scores.citation_bound)),
    quote_verbatim: mean(rows.map((row) => row.scores.quote_verbatim)),
    quote_supports: mean(rows.map((row) => row.scores.quote_supports)),
    quote_supports_not_judged: mean(rows.map((row) => row.scores.quote_supports_not_judged)),
    authority_share: mean(rows.map((row) => row.scores.authority_share)),
    doi_resolution: mean(rows.map((row) => row.scores.doi_resolution)),
    contradiction_retention: mean(rows.map((row) => row.scores.contradiction_retention)),
    anomaly_retained: mean(rows.map((row) => row.scores.anomaly_retained)),
    time_to_report_p50: percentile(times, 50),
    time_to_report_p90: percentile(times, 90),
    tokens_p50: percentile(tokens, 50),
  };
}
