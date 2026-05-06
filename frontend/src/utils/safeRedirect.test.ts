import { describe, expect, it } from 'vitest';
import { safeInternalPath } from './safeRedirect';

describe('safeInternalPath', () => {
  it('allows same-origin absolute paths', () => {
    expect(safeInternalPath('/app/research', '/x')).toBe('/app/research');
  });

  it('rejects external URLs and protocol-relative paths', () => {
    expect(safeInternalPath('https://evil.example', '/ok')).toBe('/ok');
    expect(safeInternalPath('//evil.example/x', '/ok')).toBe('/ok');
  });

  it('uses fallback for empty', () => {
    expect(safeInternalPath(null, '/fallback')).toBe('/fallback');
  });
});
