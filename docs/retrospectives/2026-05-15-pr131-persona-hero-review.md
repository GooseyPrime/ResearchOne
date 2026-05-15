# 2026-05-15 — PR #131 follow-up (Copilot)

## Thread summary

GitHub Copilot (`copilot-pull-request-reviewer`) left **two** inline review comments on the initial merge commit. **No Codex bot comments** appeared on the same PR review thread at the time of follow-up.

## Findings

1. **Invalid `theme()` token in arbitrary radial gradient** (Copilot): `theme(colors.slate.800/30)` is not a valid Tailwind `theme()` lookup; the bundler may emit a literal `theme(...)` string and the hero depth wash would not render.
2. **Opaque boolean assertion in marketing hardening test** (Copilot): `expect(html.includes(...) || ...).toBe(true)` produces a generic failure message when the pipeline markers drift; prefer a single `toMatch` over the allowed `data-testid` values.

## Resolution

- `PersonaAwareHero.tsx`: Replaced the gradient stop with `rgba(30,41,59,0.3)` (Tailwind `slate-800` / `#1e293b` at 30% opacity) inside the arbitrary `bg-[radial-gradient(...)]` value, avoiding invalid `theme(colors.slate.800/30)` lookups and avoiding `/` inside the arbitrary segment (which can truncate Tailwind utilities).
- `marketingHardening.test.tsx`: Assert with  
  `expect(html).toMatch(/data-testid="(?:pipeline-animated|pipeline-mobile-static|static-pipeline-fallback)"/)`  
  so Vitest prints the received HTML substring on failure.

## Codex

No Codex-authored review items were present on PR #131 for this pass; nothing to reconcile under that label.
