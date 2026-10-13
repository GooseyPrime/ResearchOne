/**
 * Fixed judge for quote_supports. One model. If its provider refuses, the same
 * model is asked on another provider that serves it; no other model is used (RJ-025).
 * The deterministic scorers do not call this.
 */
export const QUOTE_SUPPORTS_PROMPT = `You judge whether a cited sentence is supported by its quoted passage.
Reply with JSON only: {"supports": true} or {"supports": false}.
Supports means a careful reader of the quote alone would accept the sentence.
Do not add facts from memory. A quote that is silent on the sentence does not support it.`;

export const QUOTE_SUPPORTS_MODEL = 'deepseek/deepseek-v3.2';
