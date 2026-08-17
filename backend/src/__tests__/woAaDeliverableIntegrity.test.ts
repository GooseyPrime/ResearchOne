import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { classifyIntent } from '../services/planning/intentClassifier';
import { buildVerifierPromptForIntent } from '../services/openrouter/openrouterService';
import {
  CLAIM_CLASS_SOURCING_BURDEN,
  INTENT_OUTPUT_TEMPLATES,
} from '../services/formatting/templates/intentOutputTemplates';
import {
  buildSpecialistContext,
  redactDuplicatedQuery,
} from '../services/reasoning/specialistExecutionService';
import {
  capForPlannerPrompt,
  redactQueryEcho,
  MAX_PLANNER_QUERY_CHARS,
} from '../services/discovery/deterministicDiscoveryQueries';
import { summarizeResearchRequest } from '../api/routes/reports';
import { stripPromptEchoFromReport } from '../services/reasoning/reportGenerator';

/**
 * WO-AA Phase 8 — end-to-end regression fixture built from the reference
 * incident prompt (runs 178fea66 and 6c59b711).
 *
 * These assert the contract at every boundary the two failures crossed:
 * classification, prompt budgeting, report hygiene, and verification rubric.
 */

const REFERENCE_PROMPT = `# Research Objective: Identify and Rank the 20 Best Affiliate Comparison-Site Opportunities for a Zero-Additional-Cost AI Publishing Business

Conduct an evidence-driven **Opportunity Discovery** study to identify, evaluate, score, and rank exactly **20 market verticals** suitable for building an AI-assisted comparison and affiliate-content business.

## Intent

Primary research intent: **opportunity_discovery**

If the system supports a secondary research intent, use:

**feasibility**

Do not reinterpret this request as a general factual report, generic affiliate-marketing guide, or critique of affiliate marketing.

# Competitive Analysis

Analyze the existing search and publishing landscape. Identify gaps rather than merely counting competitors.

# Final Decision Standard

Do not end with vague advice such as "do more research."

Deliver a ranked decision.`;

describe('WO-AA fixture — intent classification survives markdown', () => {
  it('resolves the declared intent, not the lexically dominant one', async () => {
    // The prompt is saturated with "comparison"/"compare"; the declaration is
    // markdown-bold. Run 178fea66 classified this as `comparative`.
    const brief = await classifyIntent(REFERENCE_PROMPT, undefined, {
      allowFallbackByRole: {},
    });
    expect(brief.primaryIntent).toBe('opportunity_discovery');
    expect(brief.confidence).toBeGreaterThanOrEqual(0.95);
  });
});

describe('WO-AA fixture — verification rubric matches the speech act', () => {
  const ADJUDICATIVE_VOCAB = /established_fact|falsification|contradiction analysis/i;

  it('keeps adjudicative vocabulary out of the opportunity-discovery verifier', () => {
    const prompt = buildVerifierPromptForIntent('opportunity_discovery', false);
    expect(prompt).not.toMatch(ADJUDICATIVE_VOCAB);
  });

  it('treats refusal-to-deliver as a failure for non-adjudicative intents', () => {
    for (const intentId of ['opportunity_discovery', 'comparative', 'feasibility', 'how_to'] as const) {
      const template = INTENT_OUTPUT_TEMPLATES[`intent_${intentId}`];
      expect(template, `missing template for ${intentId}`).toBeDefined();
      expect(template.verifierRubric.toLowerCase()).toMatch(/refus|abort/);
    }
  });

  it('applies the claim-class evidence burden to non-adjudicative intents only', () => {
    expect(buildVerifierPromptForIntent('opportunity_discovery', false)).toContain(
      CLAIM_CLASS_SOURCING_BURDEN
    );
    // PolicyOne intents keep their stricter, unmodified requirements.
    expect(buildVerifierPromptForIntent('adjudication', true)).not.toContain(
      CLAIM_CLASS_SOURCING_BURDEN
    );
  });

  it('still requires evidence tiers and falsification for adjudication', () => {
    const prompt = buildVerifierPromptForIntent('adjudication', true);
    expect(prompt).toMatch(/evidence tier/i);
    expect(prompt).toMatch(/falsification/i);
  });

  it('does not fail analysis for missing citations, only specific factual claims', () => {
    expect(CLAIM_CLASS_SOURCING_BURDEN).toMatch(/do NOT require a citation/i);
    expect(CLAIM_CLASS_SOURCING_BURDEN).toMatch(/named prices|commission rates/i);
    expect(CLAIM_CLASS_SOURCING_BURDEN).toMatch(/unverified estimate/i);
  });
});

describe('WO-AA fixture — prompt budgeting (Phase 5)', () => {
  const bigQuery = `${REFERENCE_PROMPT}\n${'filler requirement line. '.repeat(2000)}`;

  it('does not send the research request three times to every specialist', () => {
    // Run 6c59b711: ~95k prompt tokens per specialist because the query
    // appeared as QUERY, inside PLAN, and inside RESEARCH_BRIEF.
    const plan = { retrieval_queries: [bigQuery], objective: 'x' };
    const brief = { primaryIntent: 'opportunity_discovery', rawQuery: bigQuery };

    const context = buildSpecialistContext({
      query: bigQuery,
      plan,
      researchBrief: brief,
      sourceContext: '',
    });

    const occurrences = context.split(REFERENCE_PROMPT.slice(0, 120)).length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
    expect(context).toContain('[see QUERY above]');
  });

  it('caps total specialist context well below the observed blowup', () => {
    const context = buildSpecialistContext({
      query: bigQuery,
      plan: { retrieval_queries: [bigQuery] },
      researchBrief: { rawQuery: bigQuery },
      sourceContext: 'x'.repeat(200_000),
    });
    // Query + plan + brief budgets plus the evidence cap.
    expect(context.length).toBeLessThan(100_000);
  });

  it('leaves short queries untouched so small runs are unaffected', () => {
    const short = 'Compare Postgres and MySQL for OLTP workloads.';
    const context = buildSpecialistContext({
      query: short,
      plan: { retrieval_queries: [short] },
      sourceContext: '',
    });
    expect(context).toContain(short);
    expect(context).not.toContain('[see QUERY above]');
  });

  it('redaction only triggers for substantial queries', () => {
    expect(redactDuplicatedQuery('{"q":"short"}', 'short')).toBe('{"q":"short"}');
    const long = 'y'.repeat(500);
    expect(redactDuplicatedQuery(`{"q":"${long}"}`, long)).toContain('[see QUERY above]');
  });

  it('budgets the discovery planner prompt that previously failed', () => {
    const capped = capForPlannerPrompt(bigQuery, MAX_PLANNER_QUERY_CHARS);
    expect(capped.length).toBeLessThanOrEqual(MAX_PLANNER_QUERY_CHARS + 80);
    expect(capped).toContain('[truncated');

    const planJson = JSON.stringify({ retrieval_queries: [bigQuery] });
    expect(redactQueryEcho(planJson, bigQuery)).toContain('[see Research Query above]');
  });
});

describe('WO-AA fixture — report hygiene (Phase 5 / Rule 37 R-K)', () => {
  it('does not re-embed the raw prompt in the exported report body', () => {
    const label = summarizeResearchRequest(REFERENCE_PROMPT);
    expect(label.length).toBeLessThanOrEqual(200);
    expect(label).not.toContain('\n');
    expect(label).toContain('Affiliate Comparison-Site Opportunities');
    // The instruction tail must not survive into the report header.
    expect(label).not.toContain('Do not end with vague advice');
  });

  it('returns an empty label rather than a stray heading for blank input', () => {
    expect(summarizeResearchRequest('   ')).toBe('');
  });

  it('strips a leading prompt echo from generated markdown', () => {
    const echoed = `${REFERENCE_PROMPT}\n\n# Opportunity Discovery Report\n\nBody.`;
    const cleaned = stripPromptEchoFromReport(echoed, REFERENCE_PROMPT);
    expect(cleaned.startsWith('# Opportunity Discovery Report')).toBe(true);
  });

  it('does not label a request with a later section heading', () => {
    // Copilot review, #203: a prompt starting with prose and containing
    // "## Intent" further down produced the label "Intent".
    const prompt = [
      'I need a ranked shortlist of managed Postgres providers for a small SaaS team.',
      '',
      '## Intent',
      '',
      'comparative',
    ].join('\n');
    const label = summarizeResearchRequest(prompt);
    expect(label).not.toBe('Intent');
    expect(label).toContain('managed Postgres providers');
  });

  it('still prefers a genuine title heading at the top of the prompt', () => {
    expect(summarizeResearchRequest(REFERENCE_PROMPT)).toContain('Research Objective');
  });
});

describe('WO-AA fixture — review hardening (PR #203)', () => {
  it('keeps the declared secondary intent when the classifier call fails', async () => {
    // No OpenRouter credential is configured in tests, and the call 401s; the
    // explicit-declaration fallback must still carry the secondary intent
    // because buildCanonicalExecutionPlan selects specialists from it.
    const brief = await classifyIntent(REFERENCE_PROMPT, undefined, {
      allowFallbackByRole: {},
    });
    expect(brief.primaryIntent).toBe('opportunity_discovery');
    expect(brief.secondaryIntent).toBe('feasibility');
  });

  it('applies the claim-class burden to every non-adjudicative synthesis path', () => {
    // Rule 42 R42-9. The iterative drafter and the reference_lookup light path
    // both assign `generatedReport`; both must carry the burden. The light path
    // sits deep inside runResearchJobInner, so guard it at the source level.
    const source = readFileSync(
      resolve(process.cwd(), 'src/services/reasoning/researchOrchestrator.ts'),
      'utf8'
    );
    const lightPathStart = source.indexOf('reference lookup');
    expect(lightPathStart).toBeGreaterThan(-1);
    const lightPath = source.slice(lightPathStart, lightPathStart + 2000);
    expect(lightPath).toContain('CLAIM_CLASS_SOURCING_BURDEN');
  });
});
