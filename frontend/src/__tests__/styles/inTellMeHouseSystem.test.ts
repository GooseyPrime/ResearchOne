import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('InTellMe house style integration', () => {
  it('removes Google Fonts and keeps local font loading only', () => {
    const html = readRepoFile('index.html');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });

  it('declares required dark-only SLATE INK tokens and font families', () => {
    const tokens = readRepoFile('src/styles/tokens.css');
    const site = readRepoFile('src/styles/site.css');
    const tailwind = readRepoFile('tailwind.config.js');
    const theme = readRepoFile('src/theme.css');
    const indexCss = readRepoFile('src/index.css');
    const labNotebookTokens = readRepoFile('src/components/landing/visual/labNotebookTokens.ts');

    expect(tokens).toContain('color-scheme: dark');
    expect(tokens).toContain("font-family: 'Fraunces'");
    expect(tokens).toContain("font-family: 'IBM Plex Sans'");
    expect(tokens).toContain("font-family: 'IBM Plex Mono'");
    expect(tokens).not.toContain('font-optical-sizing: auto;');
    expect(site).toContain('font-optical-sizing: auto;');
    expect(tokens).toContain('--champagne: #7a8ea8;');
    expect(tokens).toContain('--champagne-soft: rgba(122, 142, 168, 0.18);');
    expect(tokens).toContain('--wet-stone: #101218;');
    expect(tailwind).toContain("'Fraunces Fallback'");
    expect(tailwind).toContain("'Plex Sans Fallback'");
    expect(theme).toContain("'Fraunces Fallback'");
    expect(theme).toContain("'Plex Sans Fallback'");
    expect(indexCss).toContain('--r1-notebook-bg: var(--wet-stone);');
    expect(indexCss).toContain('--r1-notebook-rule-h: rgba(122, 142, 168, 0.12);');
    expect(indexCss).toContain('--r1-notebook-rule-v: rgba(122, 142, 168, 0.18);');
    expect(labNotebookTokens).toContain("background: '#101218'");
    expect(labNotebookTokens).toContain("ruleHorizontal: 'rgba(122, 142, 168, 0.12)'");
    expect(labNotebookTokens).toContain("ruleVertical: 'rgba(122, 142, 168, 0.18)'");
  });

  it('removes unsupported SLA uptime marketing language', () => {
    const runtimeTopology = readRepoFile('src/components/r1-vault/RuntimeTopology.tsx');
    expect(runtimeTopology).not.toContain('99.9% UPTIME SLA');
    expect(runtimeTopology).toContain('PILOT VALIDATION IN PROGRESS');
  });
});
