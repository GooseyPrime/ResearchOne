import { describe, it, expect } from 'vitest';
import {
  isPresetChallengePerspective,
  mergeSupplementalWithPerspective,
  splitSupplementalAndPerspective,
} from './challengePerspective';

describe('challengePerspective', () => {
  it('splits a preset persona from the end of supplemental', () => {
    expect(
      splitSupplementalAndPerspective('Notes here\n\nHostile Peer Reviewer')
    ).toEqual({
      supplemental: 'Notes here',
      challengePerspective: 'Hostile Peer Reviewer',
    });
  });

  it('merges supplemental and persona for submit', () => {
    expect(mergeSupplementalWithPerspective('Notes', 'Defense Attorney')).toBe(
      'Notes\n\nDefense Attorney'
    );
  });

  it('recognizes preset labels', () => {
    expect(isPresetChallengePerspective('FDA Compliance Officer')).toBe(true);
    expect(isPresetChallengePerspective('My own critic')).toBe(false);
  });
});
