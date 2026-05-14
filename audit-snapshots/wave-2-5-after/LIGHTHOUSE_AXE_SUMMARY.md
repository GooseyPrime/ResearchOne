# Lighthouse + axe — Wave 2.5 verification (2026-05-14)

**Environment:** `vite preview` on `http://127.0.0.1:4173` after a production build with placeholder split-deployment + Clerk keys (same pattern as `audit-snapshots/wave-2-after/VERIFICATION.md`).

**Lighthouse:** `lighthouse@11.4.0`, desktop preset, categories **Performance**, **Accessibility**, **Best Practices**, **SEO**. Chrome: Playwright-bundled Chromium (`--chrome-path=…/chromium-1223/chrome-linux64/chrome`) with `--chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage"`.

**axe:** `@axe-core/cli@4.10.0`, JSON output under this directory.

## Baseline (Wave 2 — `audit-snapshots/wave-2-after/`)

Lighthouse (Performance / Accessibility / Best Practices only — SEO not in baseline JSON):

| URL | Performance | Accessibility | Best Practices |
| --- | ---: | ---: | ---: |
| `/` | 95 | 96 | 96 |
| `/methodology` | 98 | 91 | 96 |
| `/pricing` | 95 | 96 | 96 |

axe impact counts (from `LIGHTHOUSE_AXE_SUMMARY.md`):

| URL | critical | serious | moderate | minor |
| --- | ---: | ---: | ---: | ---: |
| `/` | 0 | 3 | 2 | 0 |
| `/methodology` | 0 | 1 | 0 | 0 |
| `/pricing` | 0 | 0 | 1 | 0 |

In-scope rule IDs on `/` (Wave 2): `aria-hidden-focus`, `aria-prohibited-attr`, `nested-interactive`, `landmark-one-main`, `region`.

## After (Wave 2.5 — this directory)

### Lighthouse scores (0–100)

| URL | Performance | Accessibility | Best Practices | SEO |
| --- | ---: | ---: | ---: | ---: |
| `/` | 94 | 100 | 96 | 100 |
| `/methodology` | 94 | 100 | 96 | 100 |
| `/pricing` | 92 | 100 | 96 | 100 |

Raw JSON: `lighthouse-home.json`, `lighthouse-methodology.json`, `lighthouse-pricing.json`.

**Accessibility gate:** all three routes scored **≥ 95** (100) on Accessibility.

### axe — impact counts (`jq` on CLI JSON)

Violations aggregated by **impact** (missing keys = **0**):

| URL | critical | serious | moderate | minor |
| --- | ---: | ---: | ---: | ---: |
| `/` (`axe-home.json`) | 0 | 0 | 0 | 0 |
| `/methodology` (`axe-methodology.json`) | 0 | 0 | 0 | 0 |
| `/pricing` (`axe-pricing.json`) | 0 | 0 | 0 | 0 |

In-scope rule IDs on `/` after Wave 2.5: **none** (all five at count 0).

**jq one-liner** (per file, root is an array of axe results):

```bash
jq '[.[] | .violations[]? | .impact] | reduce .[] as $i ({}; .[$i] += 1)' axe-home.json
```
