# Add-on cancellation and access behavior

Reference for support, billing UI copy, and webhook expectations. Three billing models coexist; cancel semantics differ per model.

## Main plan subscription (`user_subscriptions` / Stripe plan tier)

| Action | Stripe | Entitlement | Monitors / tokens |
|--------|--------|-------------|-------------------|
| Cancel at period end | `cancel_at_period_end=true`; status stays `active` until period end | Paid tier until `current_period_end` (`stripeSubscriptionStatusGrantsPlanAccess`) | Unchanged until plan deletion webhook |
| Subscription deleted | `customer.subscription.deleted` (plan sub, no `metadata.monitor_kind`) | `user_tiers` may reset per webhook rules; admin/sovereign manual tiers preserved | `cancelUserAddonSubscriptions` cascades Stripe-backed report monitors |

Billing page should show `cancelAtPeriodEnd` and period end when the API exposes them.

## Reverse-Citation Watch (Stripe per-report monitor)

| Action | API | Effect |
|--------|-----|--------|
| Subscribe | `POST /api/reports/:id/monitors` with `monitorKind: reverse_citation_watch` | Checkout → `report_monitors` row + `stripe_subscription_id` |
| Delete monitor | `DELETE /api/monitors/:id` | **Immediate** Stripe subscription cancel (not period-end) |
| Main plan deleted | Webhook cascade | RCW monitors with Stripe subs cancelled |

Add-on Stripe subscriptions must keep `metadata.monitor_kind` so plan-tier sync does not overwrite `user_tiers` (Rule 21).

## Living Reports (monitor tokens)

| Action | API | Effect |
|--------|-----|--------|
| Activate | `POST /api/reports/:id/monitors` with `living_report` (token balance) | Debits token; sets `expires_at` on monitor row |
| Insufficient tokens | 402 | User directed to Billing monitor-token purchase |
| Pause / expiry | Cron `monitorExpirySweep` | Access ends at `expires_at`; tokens are not refunded on pause |
| Main plan cancel | No automatic token wipe | Unused token balance remains; monitors expire when tokens/time run out |

## Per-run research enhancements (wallet at `POST /api/research`)

| Action | Billing | Pipeline |
|--------|---------|----------|
| Enable on submit | `addons[]` → `computeRunCost` → wallet hold (addon surcharges may apply under subscription quota) | `research_runs.selected_addons` + BullMQ job `addons` → orchestrator effects |
| Tier includes addon | `*Included` flags waive surcharge; eligibility still required | Same pipeline flags without extra wallet hold |
| Run fails / completes | Hold release per existing wallet rules | N/A |

No separate “cancel” — user deselects toggles before the next run. Past runs retain `selected_addons` on the row for audit.

## Out of scope

- Stripe prepay for per-run add-ons on the catalog page.
- `cancel_at_period_end` for individual RCW monitor subscriptions (optional future: Customer Portal).
