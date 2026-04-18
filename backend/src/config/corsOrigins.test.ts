import { describe, it, expect } from 'vitest';
import { parseCorsOrigins } from './corsOrigins';

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
