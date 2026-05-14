/**
 * F-42 — static HTML for marketing routes (Wave 3, post-build Playwright prerender).
 *
 * Route list: parsed from **`public/sitemap.xml`** (committed source of truth), not `dist/sitemap.xml`.
 *
 * Default mode (Vercel / `npm run build`): spawns **`vite preview`**, waits for readiness, prerender each URL,
 * then terminates the preview child. Override with **`PRERENDER_EXTERNAL_PREVIEW=1`** if CI starts preview separately.
 *
 * Optional: **`SKIP_PRERENDER=1`** exits 0 without doing work (escape hatch).
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, '..');
const distDir = path.join(frontendRoot, 'dist');
const sitemapPath = path.join(frontendRoot, 'public', 'sitemap.xml');

const PREVIEW_PORT = process.env.PRERENDER_PREVIEW_PORT ?? '4175';
const PUBLIC_ORIGIN = (process.env.PRERENDER_PUBLIC_ORIGIN ?? 'https://researchone.io').replace(/\/$/, '');

async function fetchWithTimeout(url, ms = 5000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { signal: ac.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

async function assertPreviewUp(baseUrl) {
  const u = `${baseUrl.replace(/\/$/, '')}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(u, 5000);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `Preview not reachable at ${baseUrl}. For external preview set PRERENDER_EXTERNAL_PREVIEW=1 and PREVIEW_BASE_URL, or fix the spawned preview.`,
  );
}

async function loadRoutesFromSitemap() {
  const xml = await readFile(sitemapPath, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const paths = [];
  for (const loc of locs) {
    try {
      const { pathname } = new URL(loc);
      const p = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
      if (!p || p.startsWith('/app')) continue;
      paths.push(p === '' ? '/' : p);
    } catch {
      /* skip bad URL */
    }
  }
  const unique = [...new Set(paths)];
  unique.sort((a, b) => {
    if (a === '/') return 1;
    if (b === '/') return -1;
    return a.localeCompare(b);
  });
  return unique;
}

function distHtmlPath(route) {
  if (route === '/') return path.join(distDir, 'index.html');
  const clean = route.replace(/^\//, '');
  return path.join(distDir, clean, 'index.html');
}

function rewriteCapturedOrigin(html, previewOrigin) {
  if (!previewOrigin || previewOrigin === PUBLIC_ORIGIN) return html;
  return html.split(previewOrigin).join(PUBLIC_ORIGIN);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function prerenderRoutes(baseUrl, routes) {
  const previewOrigin = new URL(baseUrl).origin;
  const browser = await launchBrowser();
  try {
    for (const route of routes) {
      const page = await browser.newPage();
      const url = `${baseUrl.replace(/\/$/, '')}${route === '/' ? '/' : route}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForSelector('#root > *', { timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      let html = await page.content();
      await page.close();
      html = rewriteCapturedOrigin(html, previewOrigin);

      const out = distHtmlPath(route);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, html, 'utf8');
      process.stdout.write(`prerendered ${route} → ${path.relative(frontendRoot, out)}\n`);
    }
  } finally {
    await browser.close();
  }
}

async function withManagedPreview(run) {
  if (process.env.PRERENDER_EXTERNAL_PREVIEW === '1') {
    const base = (process.env.PREVIEW_BASE_URL ?? `http://127.0.0.1:${PREVIEW_PORT}`).replace(/\/$/, '');
    await assertPreviewUp(base);
    await run(base);
    return;
  }

  const base = `http://127.0.0.1:${PREVIEW_PORT}`;
  const child = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', PREVIEW_PORT, '--strictPort'], {
    cwd: frontendRoot,
    stdio: 'ignore',
    env: { ...process.env },
  });

  const kill = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  process.on('SIGINT', kill);
  process.on('SIGTERM', kill);

  try {
    await assertPreviewUp(base);
    await run(base);
  } finally {
    kill();
    await new Promise((r) => setTimeout(r, 800));
  }
}

async function main() {
  if (process.env.SKIP_PRERENDER === '1') {
    process.stdout.write('SKIP_PRERENDER=1 — skipping marketing prerender\n');
    return;
  }

  // Install the Playwright Chromium binary if it is not already present.
  // - Uses the locally-installed `playwright` bin to avoid npx PATH issues on Vercel.
  // - Omits `--with-deps` because that requires root (apt-get/yum); Vercel's build
  //   container already ships the system libraries needed by chromium_headless_shell.
  const playwrightBin = path.join(frontendRoot, 'node_modules', '.bin', 'playwright');
  execSync(`"${playwrightBin}" install chromium`, { stdio: 'inherit', cwd: frontendRoot });

  await access(distDir);
  await access(path.join(distDir, 'index.html'));
  await access(sitemapPath);

  const routes = await loadRoutesFromSitemap();
  if (!routes.length) {
    throw new Error(`No routes parsed from ${path.relative(frontendRoot, sitemapPath)}`);
  }

  await withManagedPreview(async (baseUrl) => {
    await prerenderRoutes(baseUrl, routes);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
