# Wave 2 — verification artifacts (2026-05-12)

## Production `vite preview` build (agent / CI)

The production bundle calls `assertSplitDeploymentEnv()` and requires a non-empty Clerk publishable key. For **local screenshot / Lighthouse / axe runs only**, rebuild with placeholder origins (the API host does not need to resolve for static marketing capture):

```bash
cd frontend
VITE_CLERK_PUBLISHABLE_KEY=pk_test_audit0000000000000000000000000000 \
VITE_API_BASE_URL=https://api.placeholder.invalid \
VITE_SOCKET_URL=wss://api.placeholder.invalid \
npm run build
npx vite preview --host 127.0.0.1 --port 4173
```

## Screenshots

Captured with `npm run audit:snapshots:wave2` (Playwright, system Chrome) into this directory:

| File | Region |
| --- | --- |
| `landing-hero-desktop.png` | `[data-testid="landing-hero-region"]`, desktop |
| `landing-hero-mobile.png` | Same, 390×844 viewport |
| `landing-hero-reduced-motion.png` | Same, `prefers-reduced-motion: reduce` |
| `landing-comparison.png` | `[data-testid="landing-comparison-region"]` |
| `landing-living-report.png` | `[data-testid="landing-living-report-region"]` |

## Lighthouse (home `/`)

A full Lighthouse navigation run against `http://127.0.0.1:4173/` **did not complete** in the agent environment (Chrome/Lighthouse subprocess stalled past practical wall-clock). Re-run locally or in CI after `vite preview` is up:

```bash
npx lighthouse@11.4.0 http://127.0.0.1:4173/ \
  --only-categories=performance,accessibility,best-practices \
  --preset=desktop --chrome-flags="--headless --no-sandbox" \
  --output=json --output-path=audit-snapshots/wave-2-after/lighthouse-home.json
```

Record **Performance**, **Best Practices**, and **Accessibility** category scores in the PR description when available.

## axe (home `/`)

Command:

```bash
npx @axe-core/cli@4.10.0 http://127.0.0.1:4173/ | tee audit-snapshots/wave-2-after/axe-home.txt
```

Human-readable output is saved as **`axe-home.txt`**. On this run, axe reported **40** automated findings across rules including `aria-hidden-focus`, `aria-prohibited-attr`, `landmark-one-main`, `nested-interactive`, and `region`. The CLI summary **did not list any “critical” impact** lines in the captured text; treat severity as **unverified in JSON** until a reporter exports violations with impact tags. Follow-up: add `<main>`, resolve `aria-label` on non-landmark roles in the comparison table, and tighten pipeline/timeline focus nesting in a dedicated a11y pass if product requires axe-clean **and** WCAG conformance beyond marketing smoke.
