/**
 * Persona resolver — unit tests.
 *
 * Per Cursor rule 26 I-10: every assertion must fail when the relevant
 * resolver branch is reverted.
 *
 * Run: npx vitest run personaResolver
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolvePersona,
  _clearPersonaCache,
  isPersonaId,
  PERSONA_IDS,
} from '../../components/landing/persona/personaResolver';

describe('personaResolver — isPersonaId', () => {
  it('accepts the five canonical ids', () => {
    PERSONA_IDS.forEach((id) => expect(isPersonaId(id)).toBe(true));
  });

  it('rejects unknown strings', () => {
    expect(isPersonaId('marketing')).toBe(false);
    expect(isPersonaId('')).toBe(false);
    expect(isPersonaId(42)).toBe(false);
    expect(isPersonaId(null)).toBe(false);
  });
});

describe('personaResolver — query param wins outright', () => {
  beforeEach(() => _clearPersonaCache());

  it('?p=osint → osint', () => {
    expect(resolvePersona({ search: '?p=osint', referrer: '', pathname: '/' })).toBe('osint');
  });

  it('?p=uap overrides a referrer that would resolve to osint', () => {
    expect(
      resolvePersona({
        search: '?p=uap',
        referrer: 'https://www.bellingcat.com/articles/research-tools',
        pathname: '/',
      })
    ).toBe('uap');
    // REVERT-CHECK: personaResolver.ts:fromQueryParam — the early
    // return after a successful match in `resolvePersona`. If the
    // referrer branch ran after the query param, this test fails.
  });

  it('unknown ?p value falls through to other signals', () => {
    expect(
      resolvePersona({
        search: '?p=marketing',
        referrer: 'https://www.reddit.com/r/UFOs/comments/xyz',
        pathname: '/',
      })
    ).toBe('uap');
  });

  it('?p value is case-insensitive', () => {
    expect(resolvePersona({ search: '?p=OSINT', referrer: '', pathname: '/' })).toBe('osint');
  });
});

describe('personaResolver — UTM bag', () => {
  beforeEach(() => _clearPersonaCache());

  it('utm_campaign=osint → osint', () => {
    expect(
      resolvePersona({ search: '?utm_source=twitter&utm_campaign=osint', referrer: '', pathname: '/' })
    ).toBe('osint');
  });

  it('utm_campaign=disclosure_uap → uap', () => {
    expect(
      resolvePersona({ search: '?utm_campaign=disclosure_uap', referrer: '', pathname: '/' })
    ).toBe('uap');
  });

  it('utm_source=NICAR → osint', () => {
    expect(
      resolvePersona({ search: '?utm_source=NICAR', referrer: '', pathname: '/' })
    ).toBe('osint');
  });

  it('utm campaign=prior-art-launch → patent', () => {
    expect(
      resolvePersona({ search: '?utm_campaign=prior-art-launch', referrer: '', pathname: '/' })
    ).toBe('patent');
  });

  it('utm noise that matches no persona falls through', () => {
    expect(
      resolvePersona({ search: '?utm_source=newsletter&utm_campaign=mayspecial', referrer: '', pathname: '/' })
    ).toBe('default');
  });
});

describe('personaResolver — referrer matching', () => {
  beforeEach(() => _clearPersonaCache());

  it('r/UFOs → uap', () => {
    expect(
      resolvePersona({
        search: '',
        referrer: 'https://www.reddit.com/r/UFOs/comments/abc/post',
        pathname: '/',
      })
    ).toBe('uap');
  });

  it('r/OSINT → osint', () => {
    expect(
      resolvePersona({
        search: '',
        referrer: 'https://old.reddit.com/r/OSINT/comments/xyz/',
        pathname: '/',
      })
    ).toBe('osint');
  });

  it('bellingcat.com → osint', () => {
    expect(
      resolvePersona({
        search: '',
        referrer: 'https://www.bellingcat.com/resources/online-investigation-toolkit/',
        pathname: '/',
      })
    ).toBe('osint');
  });

  it('elicit.com → academic', () => {
    expect(
      resolvePersona({
        search: '',
        referrer: 'https://elicit.com/alternatives',
        pathname: '/',
      })
    ).toBe('academic');
  });

  it('patents.google.com → patent', () => {
    expect(
      resolvePersona({
        search: '',
        referrer: 'https://patents.google.com/?q=prior+art',
        pathname: '/',
      })
    ).toBe('patent');
  });

  it('malformed referrer falls through silently', () => {
    expect(
      resolvePersona({ search: '', referrer: 'not a url', pathname: '/' })
    ).toBe('default');
  });

  it('unknown referrer host falls through', () => {
    expect(
      resolvePersona({ search: '', referrer: 'https://news.ycombinator.com/item?id=12345', pathname: '/' })
    ).toBe('default');
  });
});

describe('personaResolver — pathname routes', () => {
  beforeEach(() => _clearPersonaCache());

  it('/for/journalists → osint', () => {
    expect(resolvePersona({ search: '', referrer: '', pathname: '/for/journalists' })).toBe('osint');
  });

  it('/for/uap → uap', () => {
    expect(resolvePersona({ search: '', referrer: '', pathname: '/for/uap' })).toBe('uap');
  });

  it('/for/academic → academic', () => {
    expect(resolvePersona({ search: '', referrer: '', pathname: '/for/academic' })).toBe('academic');
  });

  it('/for/patent → patent', () => {
    expect(resolvePersona({ search: '', referrer: '', pathname: '/for/patent' })).toBe('patent');
  });

  it('unknown /for/... falls through', () => {
    expect(resolvePersona({ search: '', referrer: '', pathname: '/for/aliens' })).toBe('default');
  });
});

describe('personaResolver — determinism (rule 26 I-7)', () => {
  beforeEach(() => _clearPersonaCache());

  it('same inputs → same output 10 times in a row', () => {
    const inputs = { search: '?p=osint', referrer: '', pathname: '/' };
    const results = Array.from({ length: 10 }, () => resolvePersona(inputs));
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('osint');
  });
});

describe('personaResolver — sessionStorage cache (rule 26 I-8)', () => {
  beforeEach(() => _clearPersonaCache());

  it('caches a resolved persona on first call', () => {
    resolvePersona({ search: '?p=uap', referrer: '', pathname: '/' });
    expect(sessionStorage.getItem('r1.persona')).toBe('uap');
  });

  it('reads from cache when later resolve has no signals', () => {
    // First call sets cache.
    resolvePersona({ search: '?p=academic', referrer: '', pathname: '/' });
    // Second call has no signals — should return cached value.
    expect(
      resolvePersona({ search: '', referrer: '', pathname: '/' })
    ).toBe('academic');
    // REVERT-CHECK: personaResolver.ts — the `if (useSessionCache)`
    // block in resolvePersona, just before the 'default' fallback.
  });

  it('useSessionCache=false bypasses the cache', () => {
    resolvePersona({ search: '?p=academic', referrer: '', pathname: '/' });
    expect(
      resolvePersona({ search: '', referrer: '', pathname: '/', useSessionCache: false })
    ).toBe('default');
  });

  it('writeSessionCache=false does not write', () => {
    resolvePersona({
      search: '?p=osint',
      referrer: '',
      pathname: '/',
      writeSessionCache: false,
    });
    expect(sessionStorage.getItem('r1.persona')).toBeNull();
  });
});

describe('personaResolver — privacy invariants (rule 26 I-1)', () => {
  beforeEach(() => _clearPersonaCache());

  it('no fetch is called during resolution', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called');
    });
    resolvePersona({
      search: '?p=osint',
      referrer: 'https://www.bellingcat.com/',
      pathname: '/',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('no cookie is set', () => {
    const before = document.cookie;
    resolvePersona({ search: '?p=uap', referrer: '', pathname: '/' });
    expect(document.cookie).toBe(before);
  });
});

describe('personaResolver — SSR safety', () => {
  let originalWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    originalWindow = globalThis.window;
    // Simulate Node/SSR by deleting window. vitest jsdom has window
    // by default; we delete it for this single test.
    // @ts-expect-error — intentionally undefining for SSR test.
    delete globalThis.window;
  });

  afterEach(() => {
    if (originalWindow) globalThis.window = originalWindow;
  });

  it('returns "default" when window is undefined, without throwing', () => {
    expect(() => resolvePersona()).not.toThrow();
    expect(resolvePersona()).toBe('default');
    // REVERT-CHECK: personaResolver.ts — the `if (typeof window ===
    // 'undefined') return 'default'` guard at the top of
    // resolvePersona.
  });
});

describe('personaResolver — fallback', () => {
  beforeEach(() => _clearPersonaCache());

  it('no signals at all → default', () => {
    expect(resolvePersona({ search: '', referrer: '', pathname: '/' })).toBe('default');
  });
});
