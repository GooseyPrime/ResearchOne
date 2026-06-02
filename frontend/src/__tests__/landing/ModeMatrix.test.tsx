import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ModeMatrix from '../../components/landing/ModeMatrix';

describe('ModeMatrix', () => {
  const html = renderToString(<ModeMatrix />);

  it('lists all five research types with plain-language names', () => {
    expect(html).toContain('General Research');
    expect(html).toContain('Investigative Research');
    expect(html).toContain('Patent Research and Whitespace Mapping');
    expect(html).toContain('Application Discovery');
    expect(html).toContain('Convergence Analysis');
  });

  it('includes skeptic intensity column', () => {
    expect(html).toContain('Skeptic intensity');
  });
});
