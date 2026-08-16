import { describe, it, expect } from 'vitest';

import {
  buildScopedQueries,
  deriveRetrievalTopic,
  formatScopedContext,
  hasScopedRetrieval,
  MAX_SCOPED_CONTEXT_CHARS,
} from '../services/reasoning/specialistRetrievalScopes';
import {
  CLAIM_CLASS_EVIDENCE_BURDEN,
  INTENT_OUTPUT_TEMPLATES,
} from '../services/formatting/templates/intentOutputTemplates';
import { buildLowEvidenceSynthesisDirective } from '../services/reasoning/evidenceSufficiencyGate';

const RESEARCH_QUERY = `# Research Objective: Identify and Rank the 20 Best Affiliate Comparison-Site Opportunities

Conduct a sourced Opportunity Discovery study.
${'Additional requirement line. '.repeat(500)}`;

describe('per-specialist scoped retrieval', () => {
  it('derives a compact topic instead of passing the whole request', () => {
    const topic = deriveRetrievalTopic(RESEARCH_QUERY);
    expect(topic.length).toBeLessThanOrEqual(180);
    expect(topic).toContain('Affiliate Comparison-Site Opportunities');
    expect(topic).not.toContain('\n');
  });

  it('gives different specialists genuinely different queries', () => {
    const topic = deriveRetrievalTopic(RESEARCH_QUERY);
    const scout = buildScopedQueries('market_scout', topic);
    const mapper = buildScopedQueries('competitor_mapper', topic);
    const demand = buildScopedQueries('demand_signal_analyst', topic);

    expect(scout.length).toBeGreaterThan(0);
    // The whole point: these agents previously read identical text.
    expect(scout).not.toEqual(mapper);
    expect(mapper).not.toEqual(demand);
    expect(mapper.join(' ')).toMatch(/competitor/i);
    expect(demand.join(' ')).toMatch(/demand|complaint/i);
  });

  it('embeds the topic, not the raw prompt, in every query', () => {
    const topic = deriveRetrievalTopic(RESEARCH_QUERY);
    for (const query of buildScopedQueries('market_scout', topic)) {
      expect(query.length).toBeLessThan(300);
      expect(query).not.toContain('Additional requirement line');
    }
  });

  it('returns nothing when there is no topic to scope on', () => {
    expect(buildScopedQueries('market_scout', '')).toEqual([]);
    expect(deriveRetrievalTopic('   ')).toBe('');
  });

  it('reports which agents have a defined scope', () => {
    expect(hasScopedRetrieval('market_scout')).toBe(true);
    expect(hasScopedRetrieval('competitor_mapper')).toBe(true);
  });
});

describe('scoped context formatting', () => {
  const chunk = (id: string, content = 'body text') => ({ id, content, source_title: `src-${id}` });

  it('skips chunks already present in the shared context', () => {
    const out = formatScopedContext(
      'market_scout',
      [chunk('a'), chunk('b')],
      new Set(['a', 'b'])
    );
    // Nothing new to add, so nothing is appended — no paying twice.
    expect(out).toBe('');
  });

  it('includes only the chunks the shared context lacks', () => {
    const out = formatScopedContext('market_scout', [chunk('a'), chunk('b')], new Set(['a']));
    expect(out).toContain('src-b');
    expect(out).not.toContain('src-a');
  });

  it('is bounded so scoped material cannot reintroduce prompt bloat', () => {
    const big = Array.from({ length: 50 }, (_, i) => chunk(String(i), 'x'.repeat(2000)));
    const out = formatScopedContext('market_scout', big, new Set());
    expect(out.length).toBeLessThanOrEqual(MAX_SCOPED_CONTEXT_CHARS + 500);
  });

  it('labels the block for the specific agent', () => {
    const out = formatScopedContext('competitor_mapper', [chunk('a')], new Set());
    expect(out).toContain('SCOPED_SOURCES_FOR_COMPETITOR_MAPPER');
  });
});

describe('vocabulary — adjudicative language stays out of non-adjudicative reports', () => {
  const NON_ADJUDICATIVE = [
    'opportunity_discovery',
    'comparative',
    'feasibility',
    'recommendation',
    'how_to',
    'exploratory',
  ] as const;

  it.each(NON_ADJUDICATIVE)('%s rubric contains no "evidence" wording', (intentId) => {
    const template = INTENT_OUTPUT_TEMPLATES[`intent_${intentId}`];
    expect(template, `missing template for ${intentId}`).toBeDefined();
    const text = `${template.verifierRubric}\n${template.requiredDeliverables.join('\n')}\n${template.narrativeHint}`;
    expect(text).not.toMatch(/evidence/i);
  });

  const ADJUDICATIVE = ['adjudication', 'investigation', 'story_verification'] as const;

  it.each(ADJUDICATIVE)('%s rubric KEEPS evidence vocabulary (PolicyOne)', (intentId) => {
    const template = INTENT_OUTPUT_TEMPLATES[`intent_${intentId}`];
    expect(template.verifierRubric).toMatch(/evidence/i);
  });

  it('the claim-class block tells the model not to call the report evidence-based', () => {
    expect(CLAIM_CLASS_EVIDENCE_BURDEN).toMatch(/Sourcing requirements by claim class/);
    // The directive wraps across lines, so normalise whitespace before matching.
    const flat = CLAIM_CLASS_EVIDENCE_BURDEN.replace(/\s+/g, ' ');
    expect(flat).toMatch(/do not\s+describe it as "evidence-based"/i);
    expect(flat).toMatch(/say "sources", "signals", or "findings"/i);
  });

  it('the limited-sourcing directive avoids adjudicative framing', () => {
    const directive = buildLowEvidenceSynthesisDirective({ gaps: [] });
    expect(directive).toMatch(/LIMITED-SOURCING SYNTHESIS MODE/);
    expect(directive).not.toMatch(/LOW-EVIDENCE/);
    expect(directive).toMatch(/do NOT describe this report as "evidence-based"/i);
  });
});
