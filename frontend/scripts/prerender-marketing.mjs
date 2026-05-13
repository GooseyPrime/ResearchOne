/**
 * F-42 — static HTML for marketing routes (Wave 3, Track B–style post-build prerender).
 *
 * Prerequisites:
 *   1. `npm run build` (with production `VITE_*` so the bundle boots — see `audit-snapshots/wave-2-after/VERIFICATION.md` placeholders for local smoke).
 *   2. `npx vite preview --host 127.0.0.1 --port 4173` (or set `PREVIEW_BASE_URL`).
 *
 * Writes fully hydrated HTML into `dist/`:
 *   - `/` → `dist/index.html` (overwrites Vite’s SPA shell with rendered DOM)
 *   - `/faq` → `dist/faq/index.html`
 *
 * Uses Playwright + system Chrome (`channel: 'chrome'`) — same as Wave 2 snapshots.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, '..');
const distDir = path.join(frontendRoot, 'dist');

const PREVIEW_BASE_URL = (process.env.PREVIEW_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

/** Keep aligned with `public/sitemap.xml` marketing URLs (no `/app/*`). */
const MARKETING_ROUTES = [
  '/',
  '/pricing',
  '/methodology',
  '/faq',
  '/compare',
  '/about',
  '/contact',
  '/docs',
  '/changelog',
  '/security',
  '/sovereign',
  '/byok',
  '/terms',
  '/privacy',
  '/acceptable-use',
  '/sample-report',
];

async function assertPreviewUp() {
  const u = `${PREVIEW_BASE_URL}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(u, { redirect: 'follow' });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `Preview not reachable at ${PREVIEW_BASE_URL}. Start \`npx vite preview\` from frontend/ (after build), or set PREVIEW_BASE_URL.`
  );
}

function distHtmlPath(route) {
  if (route === '/') return path.join(distDir, 'index.html');
  const clean = route.replace(/^\//, '');
  return path.join(distDir, clean, 'index.html');
}

async function main() {
  await access(distDir);
  await access(path.join(distDir, 'index.html'));
  await assertPreviewUp();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const route of MARKETING_ROUTES) {
      const page = await browser.newPage();
      const url = `${PREVIEW_BASE_URL}${route}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await new Promise((r) => setTimeout(r, 1500));
      const html = await page.content();
      await page.close();

      const out = distHtmlPath(route);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, html, 'utf8');
      process.stdout.write(`prerendered ${route} → ${path.relative(frontendRoot, out)}\n`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
