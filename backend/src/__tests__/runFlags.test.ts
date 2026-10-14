import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { runWithFlags, switchEnabled } from '../config/runFlags';
import * as configModule from '../config';
import { doiResolveEnabled, providerRoutingEnabled } from '../config';

// These tests read the three finished-feature switches as switched off for the
// process, as they were before 14 Oct 2026; since then unset is on. A test that
// wants one on sets it, or records it for the run.
const FINISHED_FEATURES_OFF = ['AUTHORITY_TIERS_ENABLED', 'DOI_RESOLVE_ENABLED', 'PROVIDER_ROUTING_ENABLED'] as const;
const finishedFeaturesBefore = Object.fromEntries(FINISHED_FEATURES_OFF.map((name) => [name, process.env[name]]));
beforeEach(() => {
  for (const name of FINISHED_FEATURES_OFF) process.env[name] = 'false';
});
afterEach(() => {
  for (const name of FINISHED_FEATURES_OFF) {
    if (finishedFeaturesBefore[name] === undefined) delete process.env[name];
    else process.env[name] = finishedFeaturesBefore[name];
  }
});


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
    process.env[NAME] = 'false';
    process.env[OTHER] = 'false';
    const inside = await runWithFlags({ [NAME]: true, [OTHER]: true }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [doiResolveEnabled(), providerRoutingEnabled()];
    });
    expect(inside).toEqual([true, true]);
    expect(doiResolveEnabled()).toBe(false);
    expect(providerRoutingEnabled()).toBe(false);
  });

  it('gives no meaning to a removed layout switch, recorded for the run or set for the process', () => {
    process.env[NAME] = 'false';
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

  it('the finished features are on when unset, and off only when set to "false" (14 Oct 2026)', () => {
    delete process.env[NAME];
    delete process.env[OTHER];
    expect(doiResolveEnabled()).toBe(true);
    expect(providerRoutingEnabled()).toBe(true);
    process.env[NAME] = 'false';
    expect(doiResolveEnabled()).toBe(false);
    process.env[NAME] = 'no';
    expect(doiResolveEnabled()).toBe(true);
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
