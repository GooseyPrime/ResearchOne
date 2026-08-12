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
});
