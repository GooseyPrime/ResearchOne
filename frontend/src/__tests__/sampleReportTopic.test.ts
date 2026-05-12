import { describe, it, expect } from 'vitest';
import { resolveSampleReportTopic } from '../pages/SampleReportPage';

describe('resolveSampleReportTopic', () => {
  it('prefers topic= over mode=', () => {
    const p = new URLSearchParams('topic=general-epistemic&mode=investigative');
    expect(resolveSampleReportTopic(p)).toBe('general-epistemic');
  });

  it('maps legacy mode=investigative to investigative slug', () => {
    const p = new URLSearchParams('mode=investigative');
    expect(resolveSampleReportTopic(p)).toBe('investigative');
  });

  it('maps legacy mode=patent to patent-gap', () => {
    const p = new URLSearchParams('mode=patent');
    expect(resolveSampleReportTopic(p)).toBe('patent-gap');
  });

  it('accepts topic=patent-gap directly', () => {
    const p = new URLSearchParams('topic=patent-gap');
    expect(resolveSampleReportTopic(p)).toBe('patent-gap');
  });
});
