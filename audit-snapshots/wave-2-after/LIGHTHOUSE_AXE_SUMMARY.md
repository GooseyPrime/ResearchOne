# Lighthouse + axe — Wave 2 verification (2026-05-12)

**Environment:** `vite preview` on `http://127.0.0.1:4173` after a production build with placeholder split-deployment + Clerk keys (see `VERIFICATION.md`).  
**Lighthouse:** `lighthouse@11.4.0`, desktop preset, categories **Performance**, **Accessibility**, **Best Practices** only. Chrome flags: `--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage` (avoids `PROTOCOL_TIMEOUT` on this runner).

## Lighthouse scores (0–100)

| URL | Performance | Accessibility | Best Practices |
| --- | ---: | ---: | ---: |
| `/` | 95 | 96 | 96 |
| `/methodology` | 98 | 91 | 96 |
| `/pricing` | 95 | 96 | 96 |

Raw JSON: `lighthouse-home.json`, `lighthouse-methodology.json`, `lighthouse-pricing.json` in this directory.

## axe (`@axe-core/cli@4.10.0`) — impact counts (`jq` on CLI JSON)

Violations aggregated by **impact** (missing keys = **0**):

### `/` (`axe-home.json`)

| critical | serious | moderate | minor |
| ---: | ---: | ---: | ---: |
| 0 | 3 | 2 | 0 |

Rule IDs on `/`: `aria-hidden-focus` (serious), `aria-prohibited-attr` (serious), `nested-interactive` (serious), `landmark-one-main` (moderate), `region` (moderate).

### `/methodology` (`axe-methodology.json`)

| critical | serious | moderate | minor |
| ---: | ---: | ---: | ---: |
| 0 | 1 | 0 | 0 |

### `/pricing` (`axe-pricing.json`)

| critical | serious | moderate | minor |
| ---: | ---: | ---: | ---: |
| 0 | 0 | 1 | 0 |

**jq one-liner** (per file, root is an array of axe results):

```bash
jq '[.[] | .violations[]? | .impact] | reduce .[] as $i ({}; .[$i] += 1)' axe-home.json
```
