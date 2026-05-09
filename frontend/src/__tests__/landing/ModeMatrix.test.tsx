import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ModeMatrix from '../../components/landing/ModeMatrix';

describe('ModeMatrix', () => {
  const html = renderToString(<ModeMatrix />);

  it('renders all 5 mode names', () => {
    expect(html).toContain('General Epistemic');
    expect(html).toContain('Investigative');
    expect(html).toContain('Patent / Technical Gap');
    expect(html).toContain('Novel Application Discovery');
    expect(html).toContain('Anomaly Correlation');
  });

  it('renders all 6 column headers', () => {
    expect(html).toContain('Mode');
    expect(html).toContain('Best for');
    expect(html).toContain('Typical run time');
    expect(html).toContain('Mode-specific overlay');
    expect(html).toContain('Skeptic intensity');
    expect(html).toContain('Output emphasis');
  });
});
