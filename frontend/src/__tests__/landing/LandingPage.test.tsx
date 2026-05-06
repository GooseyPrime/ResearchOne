import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const landingPagePath = path.resolve(process.cwd(), 'src/pages/LandingPage.tsx');

describe('LandingPage', () => {
  it('includes the approved h1 and both CTA labels', () => {
    const source = readFileSync(landingPagePath, 'utf-8');
    expect(source).toContain('Research that shows its work.');
    expect(source).toContain('Start free');
    expect(source).toContain('See a sample report');
  });
});
