import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HeroPipelineVisual from '../../components/landing/HeroPipelineVisual';

describe('HeroPipelineVisual', () => {
  const html = renderToString(<HeroPipelineVisual />);

  it('renders all 4 phase headers', () => {
    expect(html).toContain('PLAN');
    expect(html).toContain('RETRIEVE &amp; READ');
    expect(html).toContain('REASON &amp; CHALLENGE');
    expect(html).toContain('SYNTHESIZE &amp; CITE');
  });

  it('renders all 10 stage names', () => {
    const stages = [
      'Planner',
      'Discovery',
      'Retriever',
      'Retriever Analysis',
      'Reasoner',
      'Skeptic',
      'Synthesizer',
      'Verifier',
      'Report',
      'Epistemic Persistence',
    ];
    for (const stage of stages) {
      expect(html).toContain(stage);
    }
  });

  it('has accessible visually-hidden description', () => {
    expect(html).toContain('sr-only');
    expect(html).toContain('ResearchOne pipeline has four phases');
  });

  it('has aria-label on Skeptic chip', () => {
    expect(html).toContain('Dedicated skeptic agent');
  });
});
