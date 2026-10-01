import { callRoleModel } from '../openrouter/openrouterService';
import { REPORT_QUALITY_FALLBACK, REPORT_QUALITY_MODEL, REPORT_QUALITY_PROMPT } from './reportQualityPrompt';

type JudgeCall = typeof callRoleModel;

export function parseQualityScore(content: string): number | null {
  const stripped = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(stripped) as { score?: unknown };
    if (typeof parsed.score !== 'number' || parsed.score < 1 || parsed.score > 5) return null;
    return parsed.score;
  } catch {
    return null;
  }
}

/** Blind: the report is the only text. A failed call is null and never stops scoring. */
export async function judgeReportQuality(report: string, call: JudgeCall = callRoleModel): Promise<number | null> {
  try {
    const result = await call({
      role: 'verifier',
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
