import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../../App';

describe('App routing structure', () => {
  it('renders the landing page route under SSR', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Reasoning, not recall.');
  });
});
