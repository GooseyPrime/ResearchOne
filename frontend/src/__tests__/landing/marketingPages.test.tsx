import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import MethodologyPage from '../../pages/MethodologyPage';
import BYOKPage from '../../pages/BYOKPage';
import SecurityPage from '../../pages/SecurityPage';

function inRouter(node: ReactElement) {
  return renderToString(<MemoryRouter>{node}</MemoryRouter>);
}

describe('marketing pages', () => {
  it('MethodologyPage — pipeline depth', () => {
    const html = inRouter(<MethodologyPage />);
    expect(html).toContain('How ResearchOne works');
    expect(html).toContain('A representative research flow');
    expect(html).toContain('DOUBLE-CHECK');
  });

  it('BYOKPage — provider routing', () => {
    const html = inRouter(<BYOKPage />);
    expect(html).toContain('Bring your own keys.');
    expect(html).toContain('OpenRouter');
  });

  it('SecurityPage — encryption posture', () => {
    const html = inRouter(<SecurityPage />);
    expect(html).toContain('Your research, your data.');
    expect(html).toContain('Encrypted');
  });
});
