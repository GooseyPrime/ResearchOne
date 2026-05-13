# Wave 2.5 — accessibility pass (scope)

**Parent:** Wave 2 merged in **PR #117** (`audit-snapshots/wave-2-after/axe-home.json`, `@axe-core/cli@4.10.0`).

**Goal:** Close the highest-signal automated axe gaps on the **marketing shell** without re-litigating Wave 2 visual or copy decisions. Small, fast PR.

## Primary scope (home `/` — serious + moderate from impact filter)

These five rule IDs were reported on `/` in the Wave 2 audit JSON:

| Rule ID | Impact | Notes |
| --- | --- | --- |
| `aria-hidden-focus` | serious | Pipeline / SVG: `aria-hidden` subtree must not expose focusable controls. |
| `aria-prohibited-attr` | serious | Comparison table “confidence” UI: `aria-label` on elements whose role forbids it. |
| `nested-interactive` | serious | Pipeline schematic / timeline: interactive control inside interactive ancestor. |
| `landmark-one-main` | moderate | Add a single `<main>` landmark for primary page content (marketing layout). |
| `region` | moderate | Ensure major sections are in landmarks (`main`, `nav`, `footer`, or labelled `region`). |

## Secondary (re-scan after primary fixes)

- **`/methodology`** — `serious` ×1 (re-run axe JSON after home fixes; fix if same component or shared layout).
- **`/pricing`** — `moderate` ×1 (same).

## Verification for Wave 2.5 PR

- `npm run typecheck` / `npm run test` / `npm run lint` (frontend) unchanged or improved.
- Re-run:  
  `npx @axe-core/cli@4.10.0 http://127.0.0.1:4173/ -j | jq '[.[] | .violations[]? | .impact] | reduce .[] as $i ({}; .[$i] += 1)'`  
  on `/`, `/methodology`, `/pricing` after `vite preview` (same placeholder prod env as `audit-snapshots/wave-2-after/VERIFICATION.md` if needed).

## Explicit non-goals

- No change to Wave 2 hero copy, pipeline art direction, or founder-authorized override scope.
- No Wave 3 F-42 / prerender work in this PR.
