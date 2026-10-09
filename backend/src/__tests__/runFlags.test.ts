import { afterEach, describe, expect, it } from 'vitest';
import { runWithFlags, switchEnabled } from '../config/runFlags';
import * as configModule from '../config';
import { doiResolveEnabled, providerRoutingEnabled } from '../config';

const NAME = 'DOI_RESOLVE_ENABLED';
const OTHER = 'PROVIDER_ROUTING_ENABLED';
/** Names that used to switch the report layout. Nothing reads them. */
const REMOVED = ['BASELINE_LAYER_ENABLED', 'CITATION_LOCK_ENABLED', 'READER_VIEW_ENABLED'] as const;

describe('switches recorded for one run', () => {
  const NAMES = [NAME, OTHER, ...REMOVED];
  const before = NAMES.map((name) => process.env[name]);

  afterEach(() => {
    NAMES.forEach((name, at) => {
      if (before[at] === undefined) delete process.env[name];
      else process.env[name] = before[at];
    });
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
    delete process.env[OTHER];
    const inside = await runWithFlags({ [NAME]: true, [OTHER]: true }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [doiResolveEnabled(), providerRoutingEnabled()];
    });
    expect(inside).toEqual([true, true]);
    expect(doiResolveEnabled()).toBe(false);
    expect(providerRoutingEnabled()).toBe(false);
  });

  it('gives no meaning to a removed layout switch, recorded for the run or set for the process', () => {
    delete process.env[NAME];
    // No reader of the removed names is left to call.
    for (const reader of ['baselineLayerEnabled', 'citationLockEnabled', 'readerViewEnabled']) expect(reader in configModule).toBe(false);
    // Set to 'false' they hold nothing off; set to 'true' they turn nothing on.
    for (const value of ['false', 'true']) {
      for (const name of REMOVED) process.env[name] = value;
      const recorded = Object.fromEntries(REMOVED.map((name) => [name, value === 'true']));
      expect(runWithFlags({ ...recorded, [NAME]: true }, () => doiResolveEnabled())).toBe(true);
      expect(runWithFlags(recorded, () => doiResolveEnabled())).toBe(false);
      expect(doiResolveEnabled()).toBe(false);
    }
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
