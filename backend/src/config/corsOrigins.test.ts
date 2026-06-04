import { describe, it, expect } from 'vitest';
import { expandCorsOriginAliases, parseCorsOrigins, resolveCorsOrigins } from './corsOrigins';

describe('parseCorsOrigins', () => {
  it('strips trailing slashes so browser Origin matches', () => {
    expect(parseCorsOrigins('https://app.vercel.app/', '')).toEqual(['https://app.vercel.app']);
  });

  it('parses comma-separated list', () => {
    expect(
      parseCorsOrigins('https://a.com, https://b.com/', 'http://localhost:5173')
    ).toEqual(['https://a.com', 'https://b.com']);
  });

  it('uses fallback when undefined', () => {
    expect(parseCorsOrigins(undefined, 'http://localhost:5173')).toEqual(['http://localhost:5173']);
  });
});

describe('expandCorsOriginAliases', () => {
  it('adds www variant when apex origin is configured', () => {
    expect(expandCorsOriginAliases(['https://researchone.io'])).toEqual([
      'https://researchone.io',
      'https://www.researchone.io',
    ]);
  });

  it('adds apex variant when www origin is configured', () => {
    expect(expandCorsOriginAliases(['https://www.researchone.io'])).toEqual([
      'https://www.researchone.io',
      'https://researchone.io',
    ]);
  });

  it('does not duplicate when both are already listed', () => {
    expect(
      resolveCorsOrigins('https://researchone.io,https://www.researchone.io', 'http://localhost:5173')
    ).toEqual(['https://researchone.io', 'https://www.researchone.io']);
  });
});
