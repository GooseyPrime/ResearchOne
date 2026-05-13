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

## Lighthouse + axe (numeric)

Completed in CI/agent with **`--chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage"`** (plain `--headless` hit `PROTOCOL_TIMEOUT` here). Scores, axe impact counts, and `jq` snippets are in **`LIGHTHOUSE_AXE_SUMMARY.md`**. Raw JSON: `lighthouse-*.json`, `axe-*.json` in this directory.

Legacy human-readable axe log: **`axe-home.txt`** (pre-JSON run).
