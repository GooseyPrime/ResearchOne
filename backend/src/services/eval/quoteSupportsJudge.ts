import { callRoleModel } from '../openrouter/openrouterService';
import { QUOTE_SUPPORTS_FALLBACK, QUOTE_SUPPORTS_MODEL, QUOTE_SUPPORTS_PROMPT } from './quoteSupportsPrompt';

export const QUOTE_SUPPORTS_PAIR_CAP = 25;

export interface QuotePair {
  sentence: string;
  quote: string;
}

export interface QuoteJudgeResult {
  score: number | null;
  judged: number;
  notJudged: number;
  skipped: number;
}

type JudgeCall = typeof callRoleModel;

export function selectQuotePairs(pairs: QuotePair[]): { selected: QuotePair[]; skipped: number } {
  const usable = pairs.filter((pair) => pair.sentence.trim().length > 0 && pair.quote.trim().length > 0);
  const selected = usable.slice(0, QUOTE_SUPPORTS_PAIR_CAP);
  return {
    selected,
    skipped: pairs.length - selected.length,
  };
}

export async function judgeQuoteSupports(pairs: QuotePair[], call: JudgeCall = callRoleModel): Promise<QuoteJudgeResult> {
  const { selected, skipped } = selectQuotePairs(pairs);
  if (selected.length === 0) return { score: null, judged: 0, notJudged: 0, skipped };
  let supported = 0;
  let judged = 0;
  let notJudged = 0;
  for (const pair of selected) {
    try {
      const result = await call({
        role: 'verifier',
        messages: [
          { role: 'system', content: QUOTE_SUPPORTS_PROMPT },
          { role: 'user', content: `Sentence: ${pair.sentence}\nQuote: ${pair.quote}` },
        ],
        temperature: 0,
        runtimeOverrides: {
          primary: QUOTE_SUPPORTS_MODEL,
          fallback: QUOTE_SUPPORTS_FALLBACK,
        },
      });
      const parsed = parseSupports(result.content);
      if (parsed === null) {
        notJudged += 1;
        continue;
      }
      judged += 1;
      if (parsed) supported += 1;
    } catch {
      notJudged += 1;
    }
  }
  return {
    score: judged === 0 ? null : supported / judged,
    judged,
    notJudged,
    skipped,
  };
}

export function parseSupports(content: string): boolean | null {
  const stripped = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(stripped) as { supports?: unknown };
    if (typeof parsed.supports !== 'boolean') return null;
    return parsed.supports;
  } catch {
    return null;
  }
}
