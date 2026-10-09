/**
 * The registry of customer-facing names lives in the frontend
 * (`frontend/src/content/customerOptions.ts`): one name, one description and
 * one example for everything a customer can see or choose (RJ-017).
 *
 * The server also knows these things by id, and sends a name with a plan and
 * with the add-on catalog. This test reads the registry file and fails when
 * the server offers something the registry does not hold, or names it
 * differently. It runs with the backend suite, so a new report type or add-on
 * cannot be added here without its name, description and example there.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAddonCatalog } from '../services/billing/addonCatalog';
import { INTENT_TAXONOMY } from '../services/planning/intentTaxonomy';
import { ORCHESTRATION_PROFILES } from '../services/planning/orchestrationProfiles';
import { RUN_ADDON_KEYS } from '../services/reasoning/runAddons';

interface RegistryEntry {
  group: string;
  id: string;
  name: string;
  description: string;
  example: string;
}

const REGISTRY_FILE = join(__dirname, '..', '..', '..', 'frontend', 'src', 'content', 'customerOptions.ts');
const QUOTED = String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`;
const ENTRY = new RegExp(String.raw`entry\(\s*'([a-z_]+)',\s*'([^']+)',\s*${QUOTED},\s*${QUOTED},\s*${QUOTED}\s*\)`, 'g');
const unquote = (literal: string): string => literal.slice(1, -1).replace(/\\(['"\\])/g, '$1');

function readRegistry(): RegistryEntry[] {
  const source = readFileSync(REGISTRY_FILE, 'utf8');
  return [...source.matchAll(ENTRY)].map((match) => ({
    group: match[1],
    id: match[2],
    name: unquote(match[3]),
    description: unquote(match[4]),
    example: unquote(match[5]),
  }));
}

const registry = readRegistry();
const find = (group: string, id: string): RegistryEntry | undefined => registry.find((entry) => entry.group === group && entry.id === id);

describe('the registry of customer-facing names covers what the server offers', () => {
  it('is read whole: every entry in the file is parsed, each with a name, a description and an example', () => {
    const written = (readFileSync(REGISTRY_FILE, 'utf8').match(/^\s*entry\($|^\s*entry\('/gm) ?? []).length;
    expect(registry.length).toBeGreaterThan(90);
    expect(registry.length).toBe(written);
    for (const entry of registry) {
      expect(entry.name.trim(), `${entry.group}:${entry.id}`).not.toBe('');
      expect(entry.description.trim(), `${entry.group}:${entry.id}`).not.toBe('');
      expect(entry.example.trim(), `${entry.group}:${entry.id}`).not.toBe('');
    }
  });

  it('every report type has an entry, and the server names it as the registry does', () => {
    const ids = Object.keys(INTENT_TAXONOMY);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const entry = find('report_type', id);
      expect(entry, `report type ${id} is not in the registry`).toBeDefined();
      expect(INTENT_TAXONOMY[id as keyof typeof INTENT_TAXONOMY].displayLabel).toBe(entry?.name);
      expect(ORCHESTRATION_PROFILES[id as keyof typeof ORCHESTRATION_PROFILES].displayName).toBe(entry?.name);
    }
  });

  it('no report type keeps a jargon name', () => {
    const labels = Object.values(INTENT_TAXONOMY).map((definition) => definition.displayLabel);
    expect(labels).toContain('Fact-check');
    expect(labels.filter((label) => /adjudicat|legacy|^survey$|^comparative$|^exploratory$/i.test(label))).toEqual([]);
  });

  it('every add-on in the catalog has an entry, with the same name and description', () => {
    const catalog = getAddonCatalog();
    expect(catalog.length).toBeGreaterThan(4);
    for (const addon of catalog) {
      const entry = find('add_on', addon.id);
      expect(entry, `add-on ${addon.id} is not in the registry`).toBeDefined();
      expect(addon.name).toBe(entry?.name);
      expect(addon.description).toBe(entry?.description);
    }
    for (const key of RUN_ADDON_KEYS) expect(find('add_on', key), `per-run extra ${key}`).toBeDefined();
  });

  it('every way the checking step can run has an entry', () => {
    const timings = new Set(Object.values(ORCHESTRATION_PROFILES).map((profile) => profile.doubleCheckMode));
    const restatements = new Set(Object.values(ORCHESTRATION_PROFILES).map((profile) => profile.strongestFormMode));
    for (const timing of timings) expect(find('check_timing', timing), `check timing ${timing}`).toBeDefined();
    for (const restatement of restatements) expect(find('restatement_style', restatement), `restatement ${restatement}`).toBeDefined();
    expect(find('feature', 'double_check')?.name).toBe('Double-check');
  });
});
