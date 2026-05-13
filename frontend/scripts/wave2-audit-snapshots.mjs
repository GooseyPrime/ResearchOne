/**
 * Capture Wave 2 marketing audit screenshots (requires `vite preview` on AUDIT_BASE_URL).
 * Uses system Chrome (`channel: 'chrome'`) so CI/agents need not download Playwright browsers.
 *
 * Run from repo (after a **production** build that satisfies Clerk + split-deployment env — see
 * `audit-snapshots/wave-2-after/VERIFICATION.md` for placeholder values):
 *
 * `cd frontend && npm run build && npx vite preview --host 127.0.0.1 --port 4173 &`
 * `npm run audit:snapshots:wave2`
 */
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const outDir = join(root, 'audit-snapshots', 'wave-2-after');
const base = (process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const goto = async (page) => {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('[data-testid="landing-hero-region"]', {
      state: 'attached',
      timeout: 60000,
    });
    await new Promise((r) => setTimeout(r, 1500));
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await goto(page);
  await page.locator('[data-testid="landing-hero-region"]').screenshot({
    path: join(outDir, 'landing-hero-desktop.png'),
  });
  await page.locator('[data-testid="landing-comparison-region"]').screenshot({
    path: join(outDir, 'landing-comparison.png'),
  });
  await page.locator('[data-testid="landing-living-report-region"]').screenshot({
    path: join(outDir, 'landing-living-report.png'),
  });
  await ctx.close();

  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mctx.newPage();
  await goto(mpage);
  await mpage.locator('[data-testid="landing-hero-region"]').screenshot({
    path: join(outDir, 'landing-hero-mobile.png'),
  });
  await mctx.close();

  const rctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const rpage = await rctx.newPage();
  await goto(rpage);
  await rpage.locator('[data-testid="landing-hero-region"]').screenshot({
    path: join(outDir, 'landing-hero-reduced-motion.png'),
  });
  await rctx.close();

  await browser.close();
  console.log('Wrote screenshots to', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
