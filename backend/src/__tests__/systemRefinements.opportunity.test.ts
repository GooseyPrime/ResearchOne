import { describe, expect, it } from 'vitest';

function parseOpportunityTitleLine(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:[-*]\s*)?(opportunity\s*#?\s*\d+(?::\s*.+)?)$/i);
  const headerMatch = trimmed.match(/^opportunity\s*#?\s*\d+(?::\s*.+)?$/i);
  return match?.[1]?.trim() ?? headerMatch?.[0]?.trim() ?? null;
}

function parseOpportunityRowsFromMarkdownTable(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.split('\n');
  const headerIndex = lines.findIndex((line) => /\|/.test(line) && /rank/i.test(line) && /title/i.test(line));
  if (headerIndex < 0 || headerIndex + 1 >= lines.length) return [];
  const headers = lines[headerIndex]
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
  const rankIndex = headers.findIndex((header) => /^rank$/i.test(header));
  const titleIndex = headers.findIndex((header) => /^title$/i.test(header));
  const separatorRegex = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
  const out: Array<{ title: string; body: string }> = [];

  for (let rowIndex = headerIndex + 1; rowIndex < lines.length; rowIndex += 1) {
    const rowLine = lines[rowIndex];
    if (separatorRegex.test(rowLine)) continue;
    const values = rowLine
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (values.length === 0 || values.length < Math.min(headers.length, 2)) continue;
    const rankToken = rankIndex >= 0 ? values[rankIndex] : '';
    const titleToken = titleIndex >= 0 ? values[titleIndex] : values[Math.min(1, values.length - 1)];
    const isOpportunityRow = /^#?\d+$/.test(rankToken) || /^opportunity\s*#?\d+/i.test(titleToken) || Boolean(titleToken);
    if (!isOpportunityRow) continue;
    const title = /^opportunity/i.test(titleToken)
      ? titleToken
      : `${/^#?\d+$/.test(rankToken) ? `Opportunity ${rankToken}` : 'Opportunity'}: ${titleToken}`;
    const body = headers
      .map((header, idx) => `${header}: ${values[idx] ?? ''}`)
      .join('\n')
      .trim();
    out.push({ title: title.trim(), body });
  }

  return out;
}

function extractOpportunityObjectsFromMarkdown(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.split('\n');
  const out: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const header = line.match(/^#{1,4}\s+(.+)$/);
    const headerTitle = header?.[1]?.trim() ?? '';
    const listTitle = parseOpportunityTitleLine(line) ?? (header ? parseOpportunityTitleLine(headerTitle) : null);
    if (listTitle || (/^opportunity\s*#?\s*\d+/i.test(headerTitle))) {
      if (current) {
        out.push({ title: current.title, body: current.body.join('\n').trim() });
      }
      const title = listTitle ?? headerTitle;
      if (/^opportunity\s*#?\s*\d+/i.test(title)) {
        current = { title, body: [] };
      } else {
        current = null;
      }
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) {
    out.push({ title: current.title, body: current.body.join('\n').trim() });
  }
  if (out.length > 0) return out;
  return parseOpportunityRowsFromMarkdownTable(markdown);
}

function fieldCompletenessForOpportunities(opportunities: Array<{ title: string; body: string }>): number {
  const requiredMarkers = [
    'target customer',
    'problem',
    'demand',
    'competitor',
    'differentiation',
    'mvp',
    'stack',
    'monetization',
    'acquisition',
    'risk',
    'validation',
    'narrative briefing',
    'basic project needs',
    'build prompt',
    'test prompt',
    'deployment prompt',
    'acceptance criteria',
    'confidence',
    'evidence',
  ];
  let complete = 0;
  for (const opportunity of opportunities) {
    const text = `${opportunity.title}\n${opportunity.body}`.toLowerCase();
    const missing = requiredMarkers.some((marker) => !text.includes(marker));
    if (!missing) complete += 1;
  }
  return complete;
}

function buildOpportunity(index: number) {
  return `## Opportunity #${index}: SaaS Billing Integration ${index}

#### Narrative Briefing
Brief narrative here about the opportunity ${index}.

#### Basic Project Needs
Stack, services, timeline.

#### Build Prompt
Build this product by implementing onboarding, billing, and metrics ${index}.

#### Test Prompt
Test this product by validating billing flows, retries, and edge cases ${index}.

#### Deployment Prompt
Deploy this product by configuring hosting, secrets, and monitoring ${index}.

**Target Customer:** SMBs
**Problem:** Payment integration complexity
**Demand Evidence:** 45% of SMBs cite payment setup as a blocker
**Competitor Analysis:** Stripe, Paddle, Lemon Squeezy
**Differentiation:** One-click SaaS billing
**MVP Scope:** 24-hour build
**Stack:** Next.js, Postgres, Stripe
**Monetization:** $49/mo SaaS
**Acquisition:** Product Hunt + indie hacker communities
**Risk:** Stripe API changes
**Validation Experiment:** Build and launch in 24 hours
**Acceptance Criteria:** Users can create plans and process subscription checkout
**Validation:** Validate demand, pricing, and implementation assumptions
**Confidence:** High
**Evidence:** [1][2][3]`;
}

const goldenFixture = Array.from({ length: 10 }, (_, index) => buildOpportunity(index + 1)).join('\n\n');

describe('opportunity extraction', () => {
  it('extracts exactly 10 opportunities from golden fixture', () => {
    expect(extractOpportunityObjectsFromMarkdown(goldenFixture)).toHaveLength(10);
  });

  it('counts opportunitiesWithAllRequiredFields correctly', () => {
    const opportunities = extractOpportunityObjectsFromMarkdown(goldenFixture);
    expect(fieldCompletenessForOpportunities(opportunities)).toBe(10);
  });

  it('fails fieldCompleteness when narrative briefing heading is missing', () => {
    const damaged = goldenFixture.replace('#### Narrative Briefing', '#### Narrative Summary');
    expect(fieldCompletenessForOpportunities(extractOpportunityObjectsFromMarkdown(damaged))).toBe(9);
  });

  it('fails fieldCompleteness when build prompt heading is missing', () => {
    const damaged = goldenFixture.replace('#### Build Prompt', '#### Build Plan');
    expect(fieldCompletenessForOpportunities(extractOpportunityObjectsFromMarkdown(damaged))).toBe(9);
  });

  it('fails fieldCompleteness when test prompt heading is missing', () => {
    const damaged = goldenFixture.replace('#### Test Prompt', '#### QA Prompt');
    expect(fieldCompletenessForOpportunities(extractOpportunityObjectsFromMarkdown(damaged))).toBe(9);
  });

  it('fails fieldCompleteness when deployment prompt heading is missing', () => {
    const damaged = goldenFixture.replace('#### Deployment Prompt', '#### Launch Prompt');
    expect(fieldCompletenessForOpportunities(extractOpportunityObjectsFromMarkdown(damaged))).toBe(9);
  });

  it('passes fieldCompleteness when all required fields present', () => {
    expect(fieldCompletenessForOpportunities(extractOpportunityObjectsFromMarkdown(goldenFixture))).toBe(10);
  });

  it('combined build/test/deploy prompt fails as missing separate prompts', () => {
    const damaged = goldenFixture
      .replace(/#### Build Prompt[\s\S]*?#### Deployment Prompt\n/, '#### Build/Test/Deploy Prompts\nCombined prompt text\n\n')
      .replace('Build this product by implementing onboarding, billing, and metrics 1.\n\n#### Test Prompt\nTest this product by validating billing flows, retries, and edge cases 1.\n\n#### Deployment Prompt\nDeploy this product by configuring hosting, secrets, and monitoring 1.\n\n', '');
    expect(fieldCompletenessForOpportunities(extractOpportunityObjectsFromMarkdown(damaged))).toBeLessThan(10);
  });
});
