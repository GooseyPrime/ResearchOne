import { describe, it, expect } from 'vitest';
import {
  isPresetSkepticPersonaLabel,
  mergeSupplementalWithSkepticPersona,
  splitSupplementalAndSkepticPersona,
} from './skepticPersonaSupplemental';

describe('skepticPersonaSupplemental', () => {
  it('splits a preset persona from the end of supplemental', () => {
    expect(
      splitSupplementalAndSkepticPersona('Notes here\n\nHostile Peer Reviewer')
    ).toEqual({
      supplemental: 'Notes here',
      skepticPersona: 'Hostile Peer Reviewer',
    });
  });

  it('merges supplemental and persona for submit', () => {
    expect(mergeSupplementalWithSkepticPersona('Notes', 'Defense Attorney')).toBe(
      'Notes\n\nDefense Attorney'
    );
  });

  it('recognizes preset labels', () => {
    expect(isPresetSkepticPersonaLabel('FDA Compliance Officer')).toBe(true);
    expect(isPresetSkepticPersonaLabel('My own critic')).toBe(false);
  });
});
