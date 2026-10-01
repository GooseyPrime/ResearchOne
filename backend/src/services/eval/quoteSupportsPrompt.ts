/**
 * Fixed judge for quote_supports. One model, one fallback on another provider.
 * The deterministic scorers do not call this.
 */
export const QUOTE_SUPPORTS_PROMPT = `You judge whether a cited sentence is supported by its quoted passage.
Reply with JSON only: {"supports": true} or {"supports": false}.
Supports means a careful reader of the quote alone would accept the sentence.
Do not add facts from memory. A quote that is silent on the sentence does not support it.`;

export const QUOTE_SUPPORTS_MODEL = 'deepseek/deepseek-v3.2';
export const QUOTE_SUPPORTS_FALLBACK = 'nousresearch/hermes-4-70b';
