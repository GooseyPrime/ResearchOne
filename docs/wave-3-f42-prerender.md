# Wave 3 — F-42 marketing prerender (Track B)

## Why not `vite-plugin-prerender` (npm `1.0.8`)

That package’s entry bundle uses **`require` inside an ESM graph**, which fails when Vite 6 loads `vite.config.ts` as native ESM:

`ReferenceError: require is not defined in ES module scope`

So Track B here is **post-build prerender** with **Playwright** (already a devDependency for Wave 2 snapshots), not a Rollup-time prerender plugin.

## What ships in this PR

- **`frontend/scripts/prerender-marketing.mjs`** — loads each marketing URL from a running **`vite preview`** instance, captures `document.documentElement.outerHTML` via `page.content()`, and writes:

  - `/` → `dist/index.html`
  - `/faq` → `dist/faq/index.html`
  - … (full list inside the script; aligned with `public/sitemap.xml` marketing paths, excluding `/app/*` and auth shells).

- **`npm run prerender:marketing`** — runs the script only (does **not** start the preview server).

## Operator recipe (local or CI)

From `frontend/` after a successful **`npm run build`** (with valid production `VITE_*` so Clerk + split-deployment guards do not throw — see `audit-snapshots/wave-2-after/VERIFICATION.md` for placeholder values used in agent smoke):

```bash
# terminal A
npx vite preview --host 127.0.0.1 --port 4173

# terminal B
PREVIEW_BASE_URL=http://127.0.0.1:4173 npm run prerender:marketing
```

## Vercel / routing

The existing **`vercel.json`** SPA fallback should continue to serve hashed assets from `dist/assets/*`. Nested `dist/<route>/index.html` files are picked up when present; routes without a prerendered file still fall through to the SPA shell.

## Follow-ups (not in this PR)

- Wire `prerender:marketing` into the production deploy pipeline after validating HTML size and Clerk hydration on static HTML.
- Consider **React Router framework `prerender`** when/if the app migrates off pure SPA Vite entry (native RR7 path).
