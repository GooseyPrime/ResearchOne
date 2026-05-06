import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appPath = path.resolve(process.cwd(), 'src/App.tsx');

describe('App routing structure', () => {
  it('routes / to LandingPage and app routes under /app', () => {
    const appSource = readFileSync(appPath, 'utf8');
    expect(appSource).toContain('path="/" element={<LandingPage />}');
    expect(appSource).toContain('path="/app" element={<Layout />}');
    expect(appSource).toContain('path="research" element={<ResearchPage />}');
    expect(appSource).toContain('<Navigate to="/app/research" replace />');
  });
});
