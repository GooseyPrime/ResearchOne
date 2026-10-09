#!/usr/bin/env node
/**
 * Opens the Dossiers page, a dossier, the run page and the diagnostics page of
 * one failed run in Chromium, against the production build, and reports how
 * long each held the page. See README.md.
 *
 *   node scripts/failed-run-harness/open-pages.mjs [--data <dir>] [--customer] [--profiles <dir>] [--with-analytics] [--skip-build]
 */
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, runnerImport } from 'vite';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(here, 'dist');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const port = Number(process.env.HARNESS_PORT ?? 4010);
const origin = `http://127.0.0.1:${port}`;
const isAdmin = !args.includes('--customer');
const dataDir = option('--data');
const profileDir = option('--profiles');
const withAnalytics = args.includes('--with-analytics');
/** A page that has not answered in this long is reported as not responding. */
const LIMIT_MS = Number(process.env.HARNESS_LIMIT_MS ?? 45_000);

/** The run, as files saved from the live API, or the repository's fixture of the run of 9 Oct 2026. */
async function loadData() {
  if (dataDir) {
    const read = (name, required = true) => {
      const file = path.join(dataDir, name);
      if (!existsSync(file)) {
        if (required) throw new Error(`${file} is missing (see README.md for the four files)`);
        return null;
      }
      return JSON.parse(readFileSync(file, 'utf8'));
    };
    const run = read('run.json');
    const dossier = read('dossier.json', false);
    return { run, artifacts: read('artifacts.json'), dossier, dossiers: read('dossiers.json', false), runs: read('runs.json', false) };
  }
  const load = (file) => runnerImport(path.join(root, file), { root, configFile: false, logLevel: 'error' }).then((m) => m.module);
  const many = await load('src/__tests__/rj022b/manySourcesFixture.ts');
  const first = await load('src/__tests__/rj022/failedRunFixture.ts');
  return {
    run: isAdmin ? many.rj022bFailedRun() : many.rj022bFailedRunForCustomer(),
    artifacts: many.rj022bArtifacts(),
    dossier: first.rj022Dossier(),
    dossiers: { rows: [first.rj022DossierListRow()], total: 1, page: 1, pageSize: 20 },
    runs: null,
  };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };

function serve(data) {
  const id = data.run.id;
  const listRow = (() => {
    const { plan: _p, model_log: _m, progress_events: _e, discovery_summary: _d, corpus_after: _c, retrieval_ids: _r, model_ensemble: _n, ...row } = data.run;
    return { ...row, query: String(row.query ?? '').slice(0, 512) };
  })();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const json = (body, status = 200) => res.writeHead(status, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname.startsWith('/socket.io')) return res.writeHead(404, cors).end();
    if (url.pathname.startsWith('/api/')) {
      const route = url.pathname.slice(5);
      if (route === 'auth/me') return json({ userId: 'user_harness', isAdmin });
      if (route === 'research') return json(data.runs ?? [listRow]);
      if (route === `research/${id}`) return json(data.run);
      if (route === `research/${id}/artifacts`) return json(data.artifacts);
      if (route === `research/${id}/retry-from-failure`) {
        return json({ error: "This request can't be run again. Press Send it as a new request to start it fresh; you have not been charged.", code: 'not_retryable', status: 'failed', retryable: false }, 400);
      }
      if (route === 'dossiers') return json(data.dossiers ?? { rows: [], total: 0, page: 1, pageSize: 20 });
      if (route === `dossiers/${id}`) return data.dossier ? json(data.dossier) : json({ error: 'Not found' }, 404);
      if (route.endsWith('/report-history')) return json({ entries: [] });
      if (route.endsWith('/spinoffs')) return json({ spinoffs: [] });
      if (route === 'corpus/stats') return json({ source_count: 0, document_count: 0, chunk_count: 0, embedding_count: 0, claim_count: 0, contradiction_count: 0, open_contradiction_count: 0, finalized_report_count: 0, active_run_count: 0, db_size: '0 MB' });
      if (route === 'health') return json({ status: 'ok', timestamp: new Date().toISOString() });
      if (route === 'notifications') return json({ notifications: [] });
      if (route === 'billing/subscription') return json({ tier: 'pro', status: 'active' });
      if (/plan/.test(route)) return json({ error: 'Not found' }, 404);
      return json({});
    }
    let file = path.join(dist, url.pathname);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const within = (ms, work, label) => Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);
const twoFrames = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

async function main() {
  const data = await loadData();
  if (!args.includes('--skip-build')) {
    await build({ configFile: path.join(here, 'vite.harness.config.ts'), logLevel: 'warn' });
  }
  const server = await serve(data);
  const browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const id = data.run.id;
  const results = [];

  async function open(name, steps) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    // Nothing leaves the machine: fonts are not fetched, and the analytics tag
    // only with --with-analytics (the tag is switched off on these pages and
    // sends nothing; the option is for checking that it also does no work).
    await page.route('**/*', (r) => {
      const address = r.request().url();
      const allowed = address.startsWith(origin) || (withAnalytics && address.startsWith('https://www.googletagmanager.com/gtag/js'));
      return allowed ? r.continue() : r.abort();
    });
    await page.addInitScript(() => {
      window.__longTasks = [];
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ['longtask'] });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    const started = Date.now();
    let outcome = 'opened';
    try {
      await within(LIMIT_MS, steps(page), 'NOT RESPONDING');
      // A page that is still alive answers a trivial question after two frames.
      await within(LIMIT_MS, page.evaluate(twoFrames), 'NOT RESPONDING');
    } catch (err) {
      outcome = String(err.message).split('\n')[0];
    }
    const ms = Date.now() - started;
    const read = (work) => within(3_000, work, 'frozen').catch(() => null);
    const longTasks = await read(page.evaluate(() => window.__longTasks));
    const nodes = await read(page.evaluate(() => document.querySelectorAll('*').length));
    const profile = await within(60_000, cdp.send('Profiler.stop'), 'no profile').catch(() => null);
    if (profile && profileDir) {
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(path.join(profileDir, `${name}.cpuprofile`), JSON.stringify(profile.profile));
    }
    results.push({
      page: name,
      outcome,
      ms,
      'longest block (ms)': longTasks ? Math.max(0, ...longTasks) : 'page frozen',
      'blocked in total (ms)': longTasks ? longTasks.reduce((a, b) => a + b, 0) : 'page frozen',
      elements: nodes ?? 'page frozen',
    });
    await context.close().catch(() => {});
  }

  const idle = (page) => page.waitForLoadState('networkidle');
  await open('dossiers-list-then-card', async (page) => {
    await page.goto(`${origin}/app/dossiers`);
    await idle(page);
    // The card of this run, by the title or the opening words it shows.
    const row = data.dossiers?.rows?.find((entry) => entry.runId === id || entry.dossierId === id) ?? data.dossiers?.rows?.[0];
    if (!row) return;
    await page.getByText(row.displayTitle ?? String(row.requestQuery ?? '').slice(0, 40)).first().click();
    await page.waitForURL(/\/app\/(dossiers|run)\//);
    await idle(page);
  });
  await open('dossier', async (page) => { await page.goto(`${origin}/app/dossiers/${id}`); await idle(page); });
  await open('run-page', async (page) => { await page.goto(`${origin}/app/run/${id}`); await idle(page); await page.waitForTimeout(3_000); });
  await open('diagnostics-closed', async (page) => { await page.goto(`${origin}/app/reports/run/${id}`); await idle(page); });
  await open('diagnostics-every-section-open', async (page) => {
    await page.goto(`${origin}/app/reports/run/${id}`);
    await idle(page);
    const closed = page.locator('section > button[aria-expanded="false"]');
    for (let left = await closed.count(); left > 0; left -= 1) {
      await closed.first().click();
      await page.evaluate(twoFrames);
    }
    // And every "Show all N" inside them.
    const showAll = page.getByRole('button', { name: /^Show all \d+$/ });
    for (let left = await showAll.count(); left > 0; left -= 1) {
      await showAll.first().click();
      await page.evaluate(twoFrames);
    }
  });

  await browser.close();
  server.close();
  console.log(`\nRun ${id} as ${isAdmin ? 'an administrator' : 'a customer'}; run row ${JSON.stringify(data.run).length.toLocaleString()} bytes, diagnostics ${JSON.stringify(data.artifacts).length.toLocaleString()} bytes.`);
  console.table(results);
  if (profileDir) console.log(`CPU profiles written to ${profileDir} (open in Chrome DevTools > Performance > Load profile).`);
  process.exit(results.some((r) => r.outcome !== 'opened') ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
