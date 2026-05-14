# Wave 2.5 — accessibility pass (scope)

**Parent:** Wave 2 merged in **PR #117** (`audit-snapshots/wave-2-after/axe-home.json`, `@axe-core/cli@4.10.0`).

**Scope contract merged:** **PR #119** (this file + marketing scope rules). **Implementation** is tracked in a **separate GitHub PR** whose body must link this document and declare axe re-scan buckets per § Secondary re-scan trigger.

**F-42 baseline:** Marketing prerender shipped in **PR #120** (`docs/wave-3-f42-prerender.md`). Production crawlers should see body HTML; Wave 2.5 work still **must not** change prerender routing or head injection here (see § Explicit non-goals).

**Goal:** Close the highest-signal automated axe gaps on the **marketing shell** without re-litigating Wave 2 visual or copy decisions. Small, fast PR.

**PolicyOne / V2:** This pass is **marking and DOM accessibility only** (landmarks, ARIA correctness, focus nesting). It does **not** change research prompts, `REASONING_FIRST_PREAMBLE`, `RED_TEAM_V2_SYSTEM_PREFIX`, model defaults, or any inference-time research policy. If an a11y fix would require hiding or reframing research-visible claims, stop and escalate under **Rule 22** (out-of-scope discovery) instead of shipping it here.

## Primary scope (home `/` — serious + moderate from impact filter)

These five rule IDs were reported on `/` in the Wave 2 audit JSON:

| Rule ID | Impact | Notes |
| --- | --- | --- |
| `aria-hidden-focus` | serious | Pipeline / SVG: `aria-hidden` subtree must not expose focusable controls. |
| `aria-prohibited-attr` | serious | Comparison table “confidence” UI: `aria-label` on elements whose role forbids it. |
| `nested-interactive` | serious | Pipeline schematic / timeline: interactive control inside interactive ancestor. |
| `landmark-one-main` | moderate | Add a single `<main>` landmark for primary page content (marketing layout). |
| `region` | moderate | Ensure major sections are in landmarks (`main`, `nav`, `footer`, or labelled `region`). |

## Secondary re-scan trigger

> **Secondary re-scan trigger.** Re-run axe on `/methodology` and `/pricing` if and only if the home-page fix modifies one of: `Layout`, `LandingHeader`, `LandingFooter`, `marketingNav.ts`, `frontend/src/index.css` globals, or any other component imported by a marketing page other than `/`. Page-local fixes (e.g., to `PipelineSchematic`, `LivingReportTimeline`, or any `landing/` component not imported by `MethodologyPage` or `PricingPage`) do not require secondary re-scans. The implementing agent must declare per-fix which bucket it falls into and justify any skipped re-scan in the PR body.

## Lighthouse Accessibility success criterion

> **Lighthouse Accessibility success criterion.** After Wave 2.5 implementation lands, re-run Lighthouse desktop preset against `vite preview` for `/`, `/methodology`, and `/pricing`. All three routes must score ≥ 95 on the Accessibility category. `/methodology` currently sits at 91 and is expected to lift as a side effect of fixing the in-scope rule IDs; if it does not lift to ≥ 95, the implementing agent must surface why under Rule 22 rather than declare the pass complete.

Wave 2 baselines (desktop preset, Accessibility only): see `audit-snapshots/wave-2-after/LIGHTHOUSE_AXE_SUMMARY.md` (`/` 96, `/methodology` 91, `/pricing` 96).

## Verification for Wave 2.5 implementation PR

> All shell commands in this document run from **`frontend/`** unless explicitly prefixed with `cd <path> &&`.

### Markdown (this scope file)

This scope document must pass **markdownlint** before the scope PR merges (uses repo-root **`.markdownlint-cli2.yaml`** when present):

```bash
cd .. && npx markdownlint-cli2 "docs/wave-2-5-a11y-scope.md"
```

### Frontend checks (cwd: `frontend/`)

```bash
npm run typecheck
npm run test
npm run lint
```

### `vite preview` + axe (cwd: `frontend/`)

After `npm run build` (use the same production `VITE_*` placeholders as `audit-snapshots/wave-2-after/VERIFICATION.md` if the bundle otherwise refuses to boot), start preview in another terminal:

```bash
npx vite preview --host 127.0.0.1 --port 4173
```

**Home `/` (required every implementation PR):** from `frontend/`:

```bash
npx @axe-core/cli@4.10.0 http://127.0.0.1:4173/ -j | jq '[.[] | .violations[]? | .impact] | reduce .[] as $i ({}; .[$i] += 1)'
```

**`/methodology` and `/pricing`:** only when the **Secondary re-scan trigger** above applies; same pattern, swapping the URL.

To save JSON under the repo root audit tree (optional artifact), run from **`frontend/`**:

```bash
cd .. && npx @axe-core/cli@4.10.0 http://127.0.0.1:4173/methodology -j > audit-snapshots/wave-2-after/axe-methodology-post-2-5.json
```

(Adjust the URL and filename per route; requires preview still listening on `4173`.)

### Lighthouse Accessibility (cwd: repo root — explicit `cd`)

After Wave 2.5 fixes, re-run **Accessibility category only** (desktop preset) for `/`, `/methodology`, and `/pricing`. Example for `/` (repeat for each path):

```bash
cd .. && npx lighthouse@11.4.0 "http://127.0.0.1:4173/" \
  --only-categories=accessibility \
  --preset=desktop \
  --chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage" \
  --output=json \
  --output-path=audit-snapshots/wave-2-after/lighthouse-home-post-2-5.json \
  --quiet
```

> **Note:** The `cd ..` in this subsection assumes your shell cwd is **`frontend/`** (matches the preamble). If you are already at the repo root, omit `cd .. &&` and run the `npx lighthouse@11.4.0 ...` line alone.

## Explicit non-goals

- No change to Wave 2 hero copy, pipeline art direction, or founder-authorized override scope.
- **F-42 prerender / SPA empty-body fix** is out of scope for Wave 2.5 and was delivered in **PR #120** (see `docs/wave-3-f42-prerender.md`). The implementing agent must not expand this PR to include head-tag or prerender changes; if such a change appears necessary during a11y work, surface it under **Rule 22** (out-of-scope discovery) and stop.
- No Wave 3 work beyond that F-42 track in this PR.
