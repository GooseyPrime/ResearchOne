import { describe, expect, it } from 'vitest';
import {
  allowFallbackByRoleFromModelEnsembleSnapshot,
  allowFallbackByRoleFromOverrides,
} from '../services/reasoning/v2FallbackResolution';

describe('v2FallbackResolution', () => {
  it('allowFallbackByRoleFromOverrides reads fallbackEnabled', () => {
    expect(
      allowFallbackByRoleFromOverrides({
        overrides: {
          planner: { primary: 'a', fallback: 'b', fallbackEnabled: true },
          reasoner: { primary: 'c', fallback: 'd' },
        },
      })
    ).toEqual({ planner: true });
  });

  it('allowFallbackByRoleFromModelEnsembleSnapshot reads fallback_enabled', () => {
    expect(
      allowFallbackByRoleFromModelEnsembleSnapshot({
        planner: { primary_override: null, fallback_override: null, fallback_enabled: true },
        skeptic: { primary_override: null, fallback_override: null, fallback_enabled: false },
      })
    ).toEqual({ planner: true });
  });
});
