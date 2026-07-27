import { describe, expect, it } from 'vitest';
import {
  buildClarifyingQuestions,
  CLARIFY_MIN_WORDS,
  OUTPUT_FORMAT_PATTERN,
  SCOPE_BOUNDARY_PATTERN,
} from './clarifyingQuestions';

describe('buildClarifyingQuestions', () => {
  it('returns empty array for empty input', () => {
    expect(buildClarifyingQuestions('')).toEqual([]);
    expect(buildClarifyingQuestions('   ')).toEqual([]);
  });

  it(`asks output-type question for prompts shorter than ${CLARIFY_MIN_WORDS} words with no scope`, () => {
    const questions = buildClarifyingQuestions('compare two frameworks');
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatch(/output/i);
    expect(questions[1]).toMatch(/scope/i);
  });

  it('asks output-type question (short path) and omits second output question (mutual exclusivity)', () => {
    // A short prompt that also matches OUTPUT_FORMAT_PATTERN — only the short-path question fires.
    const shortPrompt = 'compare two things';
    const words = shortPrompt.trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThan(CLARIFY_MIN_WORDS);
    expect(OUTPUT_FORMAT_PATTERN.test(shortPrompt)).toBe(true);

    const questions = buildClarifyingQuestions(shortPrompt);
    // Only one output-shape question, never two.
    const outputQuestions = questions.filter((q) => /output|organized/i.test(q));
    expect(outputQuestions.length).toBeLessThanOrEqual(1);
    expect(questions[0]).toMatch(/output/i);
  });

  it('asks organization question for long prompts without an output-format keyword', () => {
    // Build a prompt that exceeds CLARIFY_MIN_WORDS but contains no OUTPUT_FORMAT_PATTERN keyword
    // and no SCOPE_BOUNDARY_PATTERN keyword.
    const longPrompt = Array.from({ length: CLARIFY_MIN_WORDS + 2 }, (_, i) => `word${i}`).join(' ');
    expect(OUTPUT_FORMAT_PATTERN.test(longPrompt)).toBe(false);
    expect(SCOPE_BOUNDARY_PATTERN.test(longPrompt)).toBe(false);

    const questions = buildClarifyingQuestions(longPrompt);
    expect(questions[0]).toMatch(/organized/i);
    expect(questions[1]).toMatch(/scope/i);
  });

  it('asks only scope question for long prompts that contain an output-format keyword', () => {
    const prompt = `Please compare the top SaaS platforms available to teams in the enterprise sector including security features`;
    const words = prompt.trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThanOrEqual(CLARIFY_MIN_WORDS);
    expect(OUTPUT_FORMAT_PATTERN.test(prompt)).toBe(true);
    expect(SCOPE_BOUNDARY_PATTERN.test(prompt)).toBe(false);

    const questions = buildClarifyingQuestions(prompt);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatch(/scope/i);
  });

  it('returns no questions when prompt is long, has output-format keyword, and has scope keyword', () => {
    const prompt = `Please compare the top SaaS platforms available to enterprise teams within the US market for 2024 and beyond`;
    const words = prompt.trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThanOrEqual(CLARIFY_MIN_WORDS);
    expect(OUTPUT_FORMAT_PATTERN.test(prompt)).toBe(true);
    expect(SCOPE_BOUNDARY_PATTERN.test(prompt)).toBe(true);

    expect(buildClarifyingQuestions(prompt)).toEqual([]);
  });

  it('caps result at 2 questions regardless of how underspecified the prompt is', () => {
    // A very short single-word prompt: both output-shape and scope fire.
    const questions = buildClarifyingQuestions('research');
    expect(questions.length).toBeLessThanOrEqual(2);
  });

  it('returns only output question when short prompt already contains a scope keyword', () => {
    // Prompt: short (< CLARIFY_MIN_WORDS) and contains a SCOPE_BOUNDARY_PATTERN word.
    const prompt = 'research within EU';
    const words = prompt.trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThan(CLARIFY_MIN_WORDS);
    expect(SCOPE_BOUNDARY_PATTERN.test(prompt)).toBe(true);

    const questions = buildClarifyingQuestions(prompt);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatch(/output/i);
  });

  it('is case-insensitive for keyword matching', () => {
    const promptWithUpperCase = `Please COMPARE the top platforms available to enterprise teams WITHIN the US market for the coming year`;
    expect(buildClarifyingQuestions(promptWithUpperCase)).toEqual([]);
  });
});
