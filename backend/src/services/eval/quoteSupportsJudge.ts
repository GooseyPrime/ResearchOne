import { callRoleModel } from '../openrouter/openrouterService';
import { QUOTE_SUPPORTS_FALLBACK, QUOTE_SUPPORTS_MODEL, QUOTE_SUPPORTS_PROMPT } from './quoteSupportsPrompt';

export interface QuotePair {
  sentence: string;
  quote: string;
}

type JudgeCall = typeof callRoleModel;

export async function judgeQuoteSupports(pairs: QuotePair[], call: JudgeCall = callRoleModel): Promise<number | null> {
  if (pairs.length === 0) return null;
  let supported = 0;
  for (const pair of pairs) {
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
    if (parseSupports(result.content)) supported += 1;
  }
  return supported / pairs.length;
}

function parseSupports(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { supports?: unknown };
    return parsed.supports === true;
  } catch {
    return false;
  }
}
