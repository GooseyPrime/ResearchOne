import { describe, it, expect } from 'vitest';
import { runNeedsShellModeSwitch } from './researchShellRunHandoff';
import type { ResearchRun } from './api';

const baseRun = { id: 'r1', status: 'completed' } as ResearchRun;

describe('runNeedsShellModeSwitch', () => {
  it('returns true when V2 run opened from standard shell', () => {
    expect(runNeedsShellModeSwitch({ ...baseRun, engine_version: 'v2' }, 'standard')).toBe(true);
  });

  it('returns false when engine matches shell mode', () => {
    expect(runNeedsShellModeSwitch({ ...baseRun, engine_version: 'v2' }, 'deep')).toBe(false);
    expect(runNeedsShellModeSwitch({ ...baseRun, engine_version: 'v1' }, 'standard')).toBe(false);
  });
});
