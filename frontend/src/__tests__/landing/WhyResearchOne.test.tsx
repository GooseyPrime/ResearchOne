import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WhyResearchOne from '../../components/landing/WhyResearchOne';

describe('WhyResearchOne', () => {
  const html = renderToString(<WhyResearchOne />);

  it('renders all 3 card H3s', () => {
    expect(html).toContain('Reasoning, not recall.');
    expect(html).toContain('Contradictions stay visible.');
    expect(html).toContain('The report is the product.');
  });
});
