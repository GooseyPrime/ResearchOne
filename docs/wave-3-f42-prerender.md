# Wave 3 — F-42 marketing prerender (Track B)

## Why not `vite-plugin-prerender` (npm `1.0.8`)

That package’s entry bundle uses **`require` inside an ESM graph**, which fails when Vite 6 loads `vite.config.ts` as native ESM (`require is not defined`). Track B is therefore **post-build Playwright prerender** (`frontend/scripts/prerender-marketing.mjs`), not a Rollup-time plugin.

## What ships in this PR / branch

- **`frontend/scripts/prerender-marketing.mjs`** — after `vite build`, loads each marketing URL from **`vite preview`**, waits for **`#root > *`**, captures HTML, optionally rewrites the preview origin to **`PRERENDER_PUBLIC_ORIGIN`** (default `https://researchone.io`), writes `dist/<path>/index.html` (root last → `dist/index.html`).
- **Route list** — parsed from **`frontend/public/sitemap.xml`** (committed). Do not read `dist/sitemap.xml` (build output).
- **`npm run build`** — runs **`tsc && vite build && node scripts/prerender-marketing.mjs`**. The prerender step **spawns and tears down its own `vite preview`** unless **`PRERENDER_EXTERNAL_PREVIEW=1`** (see CI choice below).
- **`npm run build:no-prerender`** — `tsc && vite build` only.
- **`npm run prerender:marketing`** — prerender only (expects `dist/` and preview; same as build’s second phase).
- **Per-route head** — `MarketingDocumentEffect` + `applyMarketingDocumentHead` (`frontend/src/lib/marketingDocumentHead.ts`) update `<title>`, `meta[name=description]`, canonical, Open Graph, and Twitter tags on route change so prerendered HTML differs per URL (link previews / crawlers).
- **`vercel.json` + `frontend/vercel.json`** — SPA catch-all **excludes** first-path segments that have prerendered `dist/<segment>/` trees (must stay in sync when `public/sitemap.xml` gains new top-level marketing URLs).

## PolicyOne / V2

F-42 is **presentation and distribution** (HTML shell, meta tags, static paths). It does **not** change `REASONING_FIRST_PREAMBLE`, `RED_TEAM_V2_SYSTEM_PREFIX`, model defaults, or any research inference behavior.

## CI / Vercel wiring (gating item 3) — **choice (a)**

**Implemented:** a single **`npm run build`** that finishes `vite build`, then runs the prerender script which **starts `vite preview` on `PRERENDER_PREVIEW_PORT` (default `4175`)**, waits for HTTP, prerenders, then **SIGTERM** the child.

**Alternative (b):** two CI steps — `vite build`, then start preview in step 2, set **`PRERENDER_EXTERNAL_PREVIEW=1`** and **`PREVIEW_BASE_URL`**, run **`npm run prerender:marketing`**.

## Vercel rewrite (gating item 1 — F-42 close)

The catch-all rewrite to **`/`** must **not** match paths that have **`dist/<segment>/index.html`**. Those segments are listed in the negative lookahead in **`vercel.json`** / **`frontend/vercel.json`** next to `assets/`, `sitemap.xml`, etc.

When you add a **new top-level marketing URL** to `public/sitemap.xml`, add the same path segment to that regex (or F-42 will still serve the SPA shell for that path).

PostHog **`/relay-*`** and **`/ingest/*`** proxy rewrites are unchanged and remain **before** the catch-all.

## Per-route head (gating item 2)

After **`npm run build`** (from `frontend/` with valid `VITE_*`):

```bash
awk 'NR==1,/<\/head>/' dist/index.html | grep -E '<title>|og:title|og:description'
awk 'NR==1,/<\/head>/' dist/methodology/index.html | grep -E '<title>|og:title|og:description'
diff <(awk 'NR==1,/<\/head>/' dist/index.html | grep -E '<title>|og:title|og:description') \
     <(awk 'NR==1,/<\/head>/' dist/methodology/index.html | grep -E '<title>|og:title|og:description')
```

(Plain `grep` on the full file can false-positive if the page body quotes those tags.)

The diff must **not** be empty. If it is, `applyMarketingDocumentHead` is not running for that route.

## Production close-out — F-42 (canonical; after `www` deploy)

Implementation merged in **PR #120** (prerender, `vercel.json` exclusions, per-route head). What remains is **production verification** and **recording it on the F-42 tracking ticket**. A **short comment on that issue** is enough — you do **not** need a separate “close-out PR” now that the engineering work lives in #120.

### 1) Raw HTML includes body content (not only `<head>` meta)

When production has the new build:

```bash
curl -sL 'https://www.researchone.io/methodology' | wc -c
```

**Pass:** the response includes substantive markup inside **`#root`** (and/or a `<main>` landmark) — visible marketing sections/copy, not an empty SPA shell. **Fail:** rich `<head>` tags but `#root` is empty or trivial.

(Optional artifact for the ticket comment:)

```bash
curl -sL 'https://www.researchone.io/methodology' -o methodology-prod.html
```

### 2) Lighthouse **SEO** on production URLs

Run the **SEO** category (distinct from Accessibility) against **production** for all three:

- `https://www.researchone.io/`
- `https://www.researchone.io/methodology`
- `https://www.researchone.io/pricing`

Example (repeat with each URL; set `--output-path` per route):

```bash
npx lighthouse@11.4.0 'https://www.researchone.io/methodology' \
  --only-categories=seo \
  --preset=desktop \
  --chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage" \
  --output=json \
  --output-path=./lighthouse-seo-methodology-prod.json \
  --quiet
```

### 3) Record, then close F-42

1. Paste **curl / body verification notes** and **Lighthouse SEO scores** (and/or attach JSON) into the **F-42** tracking ticket.
2. **Close F-42** only after (1) and (2) pass on production.

## Pre-deploy checks (optional; while iterating before `www`)

- Open a generated `dist/<route>/index.html` and confirm **`http://127.0.0.1`** / preview host does not appear in `href`/`src` for app assets (the script rewrites the preview **origin** to `PRERENDER_PUBLIC_ORIGIN`).
- Confirm prerender reads **`public/sitemap.xml`** (see script `sitemapPath`).
- For local smoke, you may run **Lighthouse SEO** against **`vite preview`** on a prerendered tree; production checks in § Production close-out remain authoritative for ticket close.

## Clerk on cold HTML (document only — do not fix in F-42)

- **Build-time / prerender:** Vercel injects the real **`VITE_CLERK_PUBLISHABLE_KEY`** for production builds. Local smoke may use a **placeholder** publishable key (see `audit-snapshots/wave-2-after/VERIFICATION.md`); prerendered HTML is still **unauthenticated** (marketing shell).
- **Expected:** Clerk hydrates asynchronously; a small header shift after load is a **separate** UX issue, not part of F-42 acceptance.
- **Smoke:** open a prerendered file via `file://` or local static server with throttled network and confirm the app still boots; layout-shift tracking is out of scope for this ticket.

## Operator recipe (manual prerender only)

From **`frontend/`** after **`npm run build`**:

```bash
npm run prerender:marketing
```

(Preview is auto-spawned unless `PRERENDER_EXTERNAL_PREVIEW=1`.)

## Escape hatches

- **`SKIP_PRERENDER=1`** — prerender script exits 0 immediately (emergency CI bypass).
- **`build:no-prerender`** — skip prerender for faster local iteration.
