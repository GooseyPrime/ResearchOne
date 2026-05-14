import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LivingReportTimeline from '../../components/landing/LivingReportTimeline';
import { LIVING_REPORT_VERSIONS } from '../../components/landing/livingReportTimelineData';

describe('LivingReportTimeline', () => {
  const html = renderToString(<LivingReportTimeline />);

  it('renders every version node label in the scrubber rail', () => {
    for (const v of LIVING_REPORT_VERSIONS) {
      expect(html).toContain(v.label);
    }
    expect(html).toContain('v0.1');
    expect(html).toContain('v1.0');
  });

  it('exposes an accessible version scrubber (group + labelled instructions)', () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('Report version scrubber');
    expect(html).toContain('data-testid="living-report-timeline"');
  });
});
