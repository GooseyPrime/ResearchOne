# Monitor tokens — Living Reports economy

Working implementation resource for migrating **Living Reports** (`monitor_kind = living_report`) from per-report Stripe subscriptions to a **per-report monitor token** economy. Reverse-Citation Watch remains on the existing Stripe subscription path unless extended later.

## Context and objective

Subscription-tier `max_active_monitors` plus indefinite Stripe-backed monitors created unbounded compute risk for abandoned accounts. The new model caps exposure: users buy **monitor tokens** (integer units, separate from API wallet `balance_cents`) and spend one token per report per **2-month** monitoring window.

## Product rules

| Rule | Behavior |
|------|----------|
| **1 token = 2 months** | Active monitoring on one report until `expires_at`. |
| **Strict consumption** | Pause then re-activate consumes a **new** token (no refunds). |
| **Auto-renew** | Per-monitor `auto_renew`; cron deducts another token and extends `expires_at` when due. |
| **Packages** | $10 (1), $25 (5), $40 (10) via Stripe Checkout `mode: payment`. |
| **Auto top-up** | User preference on `user_monitor_balances`; Stripe charge in cron is **deferred** (v1 stores preference only). |

## Hard stops

1. **Currency separation** — Do not credit or debit `user_wallets` / `wallet_ledger` for monitor tokens.
2. **Transaction safety** — Token deduction and monitor activation in one Postgres transaction (`SELECT … FOR UPDATE` on balance).
3. **No refunds** — UI must warn before pause that re-activation costs another token.
4. **Canonical services** — Balance writes in `monitorTokenService.ts`; Stripe fulfillment in `checkoutMonitorTokens.ts`.

## Schema (migration `045_monitor_tokens_economy.sql`)

- `user_monitor_balances` — `user_id`, `token_balance`, `auto_topup_enabled`, `auto_topup_package_id`
- `monitor_token_ledger` — idempotent credits/debits (`idempotency_key` UNIQUE)
- `report_monitors` — `expires_at`, `auto_renew`

RLS on `user_monitor_balances` mirrors `report_monitors` (WO-K / migration 026 pattern).

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/billing/monitor-tokens` | Balance + auto top-up prefs |
| GET | `/api/billing/monitor-tokens/packages` | Checkout package catalog |
| POST | `/api/billing/monitor-tokens/checkout` | Stripe Checkout session |
| PATCH | `/api/billing/monitor-tokens/preferences` | Auto top-up toggle + package |
| POST | `/api/reports/:reportId/monitors` | `living_report` → token activate; `reverse_citation_watch` → Stripe |
| POST | `/api/monitors/:monitorId/toggle` | `{ active, autoRenew? }` token pause/activate |
| PATCH | `/api/monitors/:monitorId/auto-renew` | `{ autoRenew }` |

## Stripe

- Metadata: `purchase_type: monitor_tokens`, `user_id`, `package_id`, `token_amount`
- Webhook: `checkout.session.completed` → `creditMonitorTokensFromCheckoutSession` (idempotent per session id)

Env price IDs: `STRIPE_PRICE_ID_MONITOR_TOKEN_PACK_1`, `_PACK_5`, `_PACK_10`.

## Cron

`monitorExpiryCron.ts` (hourly with tier reset): expired active `living_report` rows → auto-renew if balance + `auto_renew`, else pause + user notification. No Stripe auto top-up in v1.

## Frontend

- `BillingPage` — Living Report Tokens card
- `MonitorToggle` — confirm modal, expiry countdown, auto-renew checkbox, buy link when balance 0

## Acceptance checklist

- [x] Migration `045_monitor_tokens_economy.sql` (apply on deploy)
- [x] Checkout / webhook / confirm credits balance once per session id (`checkoutMonitorTokens.test.ts`)
- [ ] Concurrent toggles cannot double-spend tokens (integration / manual)
- [x] Pause does not refund; re-activate requires token (UI + `toggleLivingReportMonitor`)
- [x] Cron expires monitors without tokens (`monitorExpirySweep` + hourly tier cron)
- [x] Deploy skew: missing columns → graceful defaults (Rule 13)

## Implementation status

Shipped on branch `cursor/monitor-tokens-living-reports-8af3`. Reverse-Citation Watch remains on Stripe subscription; legacy `stripe_subscription_id` living reports keep subscription controls.
