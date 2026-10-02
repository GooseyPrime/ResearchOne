import { afterEach, describe, expect, it } from 'vitest';
import { runWithFlags, switchEnabled } from '../config/runFlags';
import { baselineLayerEnabled, citationLockEnabled } from '../config';

const NAME = 'CITATION_LOCK_ENABLED';

describe('switches recorded for one run', () => {
  const before = { lock: process.env[NAME], baseline: process.env.BASELINE_LAYER_ENABLED };

  afterEach(() => {
    if (before.lock === undefined) delete process.env[NAME];
    else process.env[NAME] = before.lock;
    if (before.baseline === undefined) delete process.env.BASELINE_LAYER_ENABLED;
    else process.env.BASELINE_LAYER_ENABLED = before.baseline;
  });

  it('uses the process setting when nothing is recorded', () => {
    delete process.env[NAME];
    expect(switchEnabled(NAME)).toBe(false);
    expect(runWithFlags(null, () => switchEnabled(NAME))).toBe(false);
    process.env[NAME] = 'true';
    expect(runWithFlags({}, () => switchEnabled(NAME))).toBe(true);
  });

  it('turns a switch on for the run only, and off again outside it', async () => {
    delete process.env[NAME];
    delete process.env.BASELINE_LAYER_ENABLED;
    const inside = await runWithFlags({ [NAME]: true, BASELINE_LAYER_ENABLED: true }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [citationLockEnabled(), baselineLayerEnabled()];
    });
    expect(inside).toEqual([true, true]);
    expect(citationLockEnabled()).toBe(false);
    expect(baselineLayerEnabled()).toBe(false);
  });

  it('lets a run turn off a switch the process has on', () => {
    process.env[NAME] = 'true';
    expect(runWithFlags({ [NAME]: false }, () => switchEnabled(NAME))).toBe(false);
  });

  it('keeps two runs at the same time apart', async () => {
    delete process.env[NAME];
    const [first, second] = await Promise.all([
      runWithFlags({ [NAME]: true }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return switchEnabled(NAME);
      }),
      runWithFlags(null, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return switchEnabled(NAME);
      }),
    ]);
    expect([first, second]).toEqual([true, false]);
  });
});
