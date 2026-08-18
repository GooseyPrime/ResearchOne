import { describe, expect, it } from 'vitest';

import { deriveGeneratedReportTitle, stripPromptEchoFromReport } from '../services/reasoning/reportGenerator';

describe('report hygiene helpers', () => {
  it('derives a concise generated title for long queries', () => {
    const longQuery = 'Build me a report about affiliate market opportunities '.repeat(12);
    const markdown = '# Ranked Opportunity Brief\n\n## Overview\n\nA concise report body.';

    const title = deriveGeneratedReportTitle(longQuery, markdown, 'opportunity_discovery');

    expect(title.length).toBeGreaterThan(10);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title).not.toBe(longQuery.slice(0, 200));
  });

  it('strips a verbatim prepended prompt from the report body', () => {
    const prompt = 'Primary research intent: opportunity_discovery\nDeliver exactly 20 opportunities.';
    const markdown = `${prompt}\n\n# Opportunity Discovery Report\n\nActual synthesized content begins here.`;

    const cleaned = stripPromptEchoFromReport(markdown, prompt);

    expect(cleaned).not.toContain(prompt);
    expect(cleaned).toContain('Actual synthesized content begins here.');
  });

  it('strips an emphasised label the model wrapped around the echo', () => {
    // The exported .md from run c50162a9 opened with `**Research query:**`.
    const prompt = 'Deliver exactly 20 opportunities with ranking rationale.';
    const markdown = `**Research query:** ${prompt}\n\n# Opportunity Brief\n\nBody text.`;

    const cleaned = stripPromptEchoFromReport(markdown, prompt);

    expect(cleaned.startsWith('# Opportunity Brief')).toBe(true);
    expect(cleaned).not.toContain('Research query');
  });

  it('strips an echo that sits underneath the report title', () => {
    const prompt = 'Deliver exactly 20 opportunities with ranking rationale.';
    const markdown = `# Opportunity Brief\n\n**Research query:**\n${prompt}\n\nBody text.`;

    const cleaned = stripPromptEchoFromReport(markdown, prompt);

    expect(cleaned).toContain('# Opportunity Brief');
    expect(cleaned).toContain('Body text.');
    expect(cleaned).not.toContain('Research query');
    expect(cleaned).not.toContain('Deliver exactly 20 opportunities');
  });

  it('matches an echo the model re-wrapped onto different lines', () => {
    const prompt = 'Deliver exactly 20 opportunities with ranking rationale.';
    const rewrapped = 'Deliver exactly 20 opportunities\nwith ranking rationale.';
    const markdown = `Research query: ${rewrapped}\n\n# Brief\n\nBody.`;

    expect(stripPromptEchoFromReport(markdown, prompt).startsWith('# Brief')).toBe(true);
  });

  it('leaves a legitimate section that merely starts with a label', () => {
    const prompt = 'Deliver exactly 20 opportunities.';
    const markdown = '# Brief\n\nRequest: the client wants a shortlist by Friday.\n';

    const cleaned = stripPromptEchoFromReport(markdown, prompt);

    expect(cleaned).toContain('Request: the client wants a shortlist by Friday.');
  });
});
