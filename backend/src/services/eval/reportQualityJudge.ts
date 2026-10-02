import { callRoleModel } from '../openrouter/openrouterService';
import { QUALITY_POINTS, REPORT_QUALITY_FALLBACK, REPORT_QUALITY_MODEL, REPORT_QUALITY_PROMPT, type QualityPoint } from './reportQualityPrompt';

type JudgeCall = typeof callRoleModel;

export interface QualityJudgment {
  mean: number;
  subScores: Record<QualityPoint, number>;
}

export function parseQualityScore(content: string): QualityJudgment | null {
  const stripped = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const subScores = {} as Record<QualityPoint, number>;
    for (const point of QUALITY_POINTS) {
      const value = parsed[point];
      if (typeof value !== 'number' || value < 1 || value > 5) return null;
      subScores[point] = value;
    }
    const mean = QUALITY_POINTS.reduce((sum, point) => sum + subScores[point], 0) / QUALITY_POINTS.length;
    return { mean, subScores };
  } catch {
    return null;
  }
}

/** Blind: the report is the only text. A null result fails the run gate. */
export async function judgeReportQuality(report: string, call: JudgeCall = callRoleModel): Promise<QualityJudgment | null> {
  try {
    const result = await call({
      role: 'verifier',
      baselineLayer: false,
      messages: [
        { role: 'system', content: REPORT_QUALITY_PROMPT },
        { role: 'user', content: report },
      ],
      temperature: 0,
      runtimeOverrides: { primary: REPORT_QUALITY_MODEL, fallback: REPORT_QUALITY_FALLBACK },
    });
    return parseQualityScore(result.content);
  } catch {
    return null;
  }
}
