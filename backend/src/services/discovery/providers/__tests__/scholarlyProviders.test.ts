import { describe, expect, it } from 'vitest';
import type { SearchProvider } from '../searchProvider';
import type { SearchQuery, SearchResultCandidate } from '../../providerTypes';

class SuccessProvider implements SearchProvider {
  name = 'success';
  private results: SearchResultCandidate[];
  constructor(results: SearchResultCandidate[]) { this.results = results; }
  async search() { return this.results; }
}

class FailProvider implements SearchProvider {
  name = 'fail';
  async search(): Promise<SearchResultCandidate[]> { throw new Error('provider down'); }
}

function makeResult(provider: string, url: string): SearchResultCandidate {
  return { url, title: `Title from ${provider}`, snippet: 'test', score: 0.9, rank: 1, provider, sourceQuery: 'test' };
}

describe('scholarly providers', () => {
  describe('cascade strategy', () => {
    it('merges results from multiple providers via allSettled', async () => {
      const providers: SearchProvider[] = [
        new SuccessProvider([makeResult('a', 'https://a.com/1')]),
        new SuccessProvider([makeResult('b', 'https://b.com/1'), makeResult('b', 'https://b.com/2')]),
      ];

      const results = await Promise.allSettled(
        providers.map(p => p.search({ text: 'test' }))
      );

      const merged = results
        .filter((r): r is PromiseFulfilledResult<SearchResultCandidate[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);

      expect(merged).toHaveLength(3);
      expect(merged.map(r => r.provider)).toContain('a');
      expect(merged.map(r => r.provider)).toContain('b');
    });

    it('one provider failing does NOT block others', async () => {
      const providers: SearchProvider[] = [
        new SuccessProvider([makeResult('good', 'https://good.com/1')]),
        new FailProvider(),
        new SuccessProvider([makeResult('also_good', 'https://also.com/1')]),
      ];

      const results = await Promise.allSettled(
        providers.map(p => p.search({ text: 'test' }))
      );

      const fulfilled = results
        .filter((r): r is PromiseFulfilledResult<SearchResultCandidate[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(1);
    });

    it('deduplicates by URL', async () => {
      const providers: SearchProvider[] = [
        new SuccessProvider([makeResult('a', 'https://shared.com/paper')]),
        new SuccessProvider([makeResult('b', 'https://shared.com/paper')]),
      ];

      const results = await Promise.allSettled(
        providers.map(p => p.search({ text: 'test' }))
      );

      const merged = results
        .filter((r): r is PromiseFulfilledResult<SearchResultCandidate[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);

      const deduped = [...new Map(merged.map(r => [r.url, r])).values()];
      expect(deduped).toHaveLength(1);
    });
  });

  describe('provider interface compliance', () => {
    it('all providers export SearchProvider-compatible objects', async () => {
      const mods = await Promise.all([
        import('../parallelSearch'),
        import('../openAlexSearch'),
        import('../crossrefSearch'),
        import('../arxivSearch'),
        import('../pubmedCentralSearch'),
        import('../usptoSearch'),
        import('../clinicalTrialsSearch'),
      ]);

      for (const mod of mods) {
        const ProviderClass = Object.values(mod).find(
          v => typeof v === 'function' && v.prototype?.search
        ) as (new () => SearchProvider) | undefined;

        if (ProviderClass) {
          const instance = new ProviderClass();
          expect(instance.name).toBeTypeOf('string');
          expect(instance.search).toBeTypeOf('function');
        }
      }
    });
  });

  describe('scite scholarly', () => {
    it('exports three metadata functions', async () => {
      const mod = await import('../sciteScholarly');
      expect(mod.getInstitutionalStatus).toBeTypeOf('function');
      expect(mod.getCitationCounts).toBeTypeOf('function');
      expect(mod.getContrastingPaperDois).toBeTypeOf('function');
    });
  });
});
