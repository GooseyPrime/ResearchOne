# Retrospective — PR #166 add-ons billing (Codex / Copilot review)

Date: 2026-06-03
Scope: Codex P1 ×3 and Copilot recommendations on PR #166 (`cursor/add-ons-billing-wiring`).

## Findings addressed

| Reviewer | Issue | Class |
|---|---|---|
| Codex P1 | Subscription runs with add-on wallet holds never `consumeHold` / `releaseHold` | **C-CONDITION-NARROW** — gated cleanup on `creditCtx.type === 'wallet'` while holds also exist on subscription + surcharge paths |
| Codex P1 | `spinoffService` blanket `42703` → unscoped INSERT | **C-DEPLOY-SKEW** — treated all missing columns as optional, including `user_id` |
| Codex P1 | `adversarial_twin` charged but `challenge` stayed in `agentsToSkip` | **C-CHARGE-WITHOUT-EFFECT** |
| Copilot | `LivingReportSubscribeModal` treated `paused` as active | **C-STATE-COVERAGE** — incomplete monitor status enum in UI guard |
| Copilot | `adversarial_twin` eligibility used `provenanceLedgerIncluded` | **C-FEATURE-MISMATCH** — purchase gate ≠ plan waiver feature |
| Copilot | AddOnsPage “subscription(s)” for token Living Reports | **C-COPY-PRODUCT-MODEL** — Stripe subs vs monitor tokens |

## Standing rules (logged in `AGENTS.md`)

See **Recurring review themes (Codex / Copilot, PR #166 — add-ons billing wiring)** in [`AGENTS.md`](../AGENTS.md).

## Tests added / updated

- `creditEnforcement.test.ts` — Pro may purchase `adversarial_twin` without provenance ledger
- `runAddons.test.ts` — exploratory profile + add-on un-skips `challenge`
- `spinoffInsertSkew.test.ts` — fail-closed on missing `user_id`; fallback without `selected_addons`
