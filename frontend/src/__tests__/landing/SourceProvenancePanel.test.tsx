import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SourceProvenancePanel from '../../components/landing/SourceProvenancePanel';

describe('SourceProvenancePanel', () => {
  const html = renderToString(<SourceProvenancePanel />);

  it('renders all 3 evidence-tier badges', () => {
    expect(html).toContain('Strong evidence');
    expect(html).toContain('Contradiction');
    expect(html).toContain('Speculation');
  });

  it('renders the sample excerpt', () => {
    expect(html).toContain('Multi-modal LLMs trained on synthetic data');
    expect(html).toContain('three independent evaluations report contradictory findings');
    expect(html).toContain('mechanism remains under-characterized');
  });

  it('has accessible focus targets (buttons with aria-label)', () => {
    expect(html).toContain('aria-label="Claim 1');
    expect(html).toContain('aria-label="Claim 2');
    expect(html).toContain('aria-label="Claim 3');
  });
});
