import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LivingReportTimeline from '../../components/landing/LivingReportTimeline';

describe('LivingReportTimeline', () => {
  const html = renderToString(<LivingReportTimeline />);

  it('renders all 6 checkpoints', () => {
    expect(html).toContain('v1.0 generated');
    expect(html).toContain('Source flagged: retraction');
    expect(html).toContain('v1.1');
    expect(html).toContain('New primary source added');
    expect(html).toContain('v1.2');
    expect(html).toContain('Pinned by team');
  });

  it('has accessible aria-label on the SVG', () => {
    expect(html).toContain('aria-label');
    expect(html).toContain('Living Report timeline');
  });
});
