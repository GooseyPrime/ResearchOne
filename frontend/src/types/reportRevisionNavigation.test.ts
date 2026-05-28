import { describe, expect, it } from 'vitest';
import { isReportRevisionRequestState } from './reportRevisionNavigation';

describe('isReportRevisionRequestState', () => {
  it('accepts valid minimal state', () => {
    expect(isReportRevisionRequestState({ requestText: 'Expand section 2' })).toBe(true);
  });

  it('rejects empty requestText', () => {
    expect(isReportRevisionRequestState({ requestText: '   ' })).toBe(false);
  });

  it('rejects non-string rationale', () => {
    expect(
      isReportRevisionRequestState({ requestText: 'ok', rationale: 42 as unknown as string }),
    ).toBe(false);
  });

  it('rejects non-array revisionUrls', () => {
    expect(
      isReportRevisionRequestState({ requestText: 'ok', revisionUrls: 'https://x' as unknown as string[] }),
    ).toBe(false);
  });
});
