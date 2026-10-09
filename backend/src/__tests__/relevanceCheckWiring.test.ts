/**
 * The research job hands the relevance check to every search and every
 * retrieval it makes.
 *
 * The check is applied inside discovery and inside retrieval, and each of
 * those is exercised end to end by its own suite. What those suites cannot
 * see is a call site in the research job that forgets to pass the run's
 * question along, which would quietly switch the check off for that step: the
 * repeated failure on this repository is a fix that computes the right answer
 * and hands it to something that ignores it. The job cannot be run whole in a
 * test, so this reads its source and fails when a call site is added or
 * changed without the check.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distinctSourceCount } from '../services/reasoning/baselineReport';
import { relevanceCheckCausedShortfall } from '../services/retrieval/runRelevanceFilter';

const source = readFileSync(join(__dirname, '../services/reasoning/researchOrchestrator.ts'), 'utf8');

/** The argument object of each call to `name`, as source text. */
function callsTo(name: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`await ${name}({`, from);
    if (at === -1) break;
    let depth = 0;
    let end = at;
    for (let i = source.indexOf('{', at); i < source.length; i++) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out.push(source.slice(at, end + 1));
    from = end;
  }
  return out;
}

describe('the research job and the relevance check', () => {
  it('counts a source with no link, such as an uploaded file, when deciding the check left the run short', () => {
    const call = /relevanceCheckCausedShortfall\(\{([\s\S]*?)\n {6}\}\)/.exec(source)?.[1] ?? '';
    expect(call).toMatch(/usableSources: distinctSourceCount\(/);
    expect(call).toMatch(/title: chunk\.source_title/);
    expect(call).not.toMatch(/new Set\(/);
    // What that count does with the case the old one dropped.
    const web = Array.from({ length: 14 }, (_, i) => ({ title: `Page ${i}`, url: `https://example.org/${i}` }));
    const upload = { title: 'county-audit.pdf', url: null };
    expect(distinctSourceCount([...web, upload, upload])).toBe(15);
    expect(relevanceCheckCausedShortfall({ usableSources: distinctSourceCount([...web, upload]), setAside: 1, minimum: 15 })).toBe(false);
  });

  it('passes the run\'s question to every retrieval', () => {
    const calls = callsTo('retrieveChunksWithAudit');
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) expect(call).toMatch(/\n\s+relevance: runRelevance,\n/);
  });

  it('builds that scope from the run\'s own question, not from a retrieval query', () => {
    const scope = /const runRelevance: RunRelevanceScope = \{([\s\S]*?)\n {4}\};/.exec(source)?.[1] ?? '';
    expect(scope).toMatch(/\n\s+runId,\n/);
    expect(scope).toMatch(/\n\s+researchQuery,\n/);
  });

  it('is told what each discovery pass set aside, on every pass', () => {
    const calls = callsTo('runDiscoveryOrchestrator');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call).toMatch(/\n\s+onRelevanceCheck,\n/);
  });

  it('maps citations in a step of their own, so a failure saving findings cannot skip it', () => {
    const findings = source.indexOf('await extractAndPersistClaims({');
    const mapper = source.indexOf('await mapAndPersistCitations({');
    expect(findings).toBeGreaterThan(-1);
    expect(mapper).toBeGreaterThan(findings);
    // A `catch` closes the findings block before the mapper is reached.
    expect(source.slice(findings, mapper)).toMatch(/\} catch \(epistemicErr\) \{/);
  });
});
