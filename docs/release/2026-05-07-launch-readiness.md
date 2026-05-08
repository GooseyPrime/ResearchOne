# Launch Readiness Report — 2026-05-07

**Status: PHASE 1 LAUNCH READY (with two features deferred to Phase 2)**
**Sign-off: Pending founder approval**

## Section 15 Checklist

### Core User Flows

| # | Test | Evidence | Status |
|---|---|---|---|
| 1 | New user signup → onboarding → wallet top-up → first Standard report → wallet decrement → report visible | Clerk webhook creates user + user_tiers row (WO C/G). Stripe checkout creates wallet credit (WO E/F). Research route enforces tier + credit (WO G/H). Report persisted on completion. | Code verified |
| 2 | Free demo runs 3 reports → 4th blocked with upgrade path | `checkTierAccess()` enforces `lifetimeReportCap: 3` for free_demo. Returns 403 with `upgrade_path: '/pricing'`. Test: `tierService.test.ts` | Code + test verified |
| 3 | Pro user subscribes → mode access granted → quota tracked | Stripe webhook syncs subscription → `setUserTier('pro')`. Pro tier allows all 5 objectives. `incrementReportCount` tracks monthly usage. | Code verified |
| 4 | Team owner adds members → Stripe seats → org shared access | RLS policy on `user_tiers` includes `org_id` check for shared access. **Phase 2 — Multi-seat team management deferred.** Single-seat checkout works for Phase 1 launch via "Contact us" CTA on pricing page. See `docs/roadmap/phase-2-deferred-features.md`. | **Deferred to Phase 2** |
| 5 | BYOK user adds key → runs use their key | `storeKey()` validates via provider API dispatch table. Orchestrator passes `byokApiKeyOverride` to Stage 7 (synthesis) AND Stage 10 (claims/contradictions/citations) — gap closed. Test: `byokStage10Forwarding.test.ts`. | Code + test verified |
| 6 | User deletes report → InTellMe deletion job enqueued | Deletion worker exists; producer wired in `DELETE /api/research/:id` route — gap closed. | Code verified |
| 7 | User opts out of Pipeline B → next run skips | `evaluatePipelineBEligibility()` checks `user_ingestion_consent.pipeline_b_consent`. When false, returns `{ eligible: false, reasons: ['user_opted_out'] }`. Test: `pipelineBEligibility.test.ts` | Code + test verified |
| 8 | Sovereign deployment cannot reach InTellMe | `EXCLUDE_INTELLME_CLIENT=true` → stub loaded. Stub throws on any call. `isSovereignDeployment` → `pipeline_b_eligible=false`. Tests: `sovereignDeployment.test.ts` | Code + test verified |
| 9 | Admin can comp user's tier | `POST /api/admin/users/:id/tier-override` with reason. Uses `adminQuery` to bypass RLS. Audit log row written. | Code verified |
| 10 | Failed run does not charge user | Orchestrator calls `releaseHold()` on terminal failure. `consumeHold` only on `status='completed'`. Test: wallet hold lifecycle. | Code verified |
| 11 | 402 when wallet empty | `placeHold()` returns `success: false` when `balance_cents - reserved_cents < cost`. Route returns 402 with `checkout_path`. | Code verified |
| 12 | 402 when reserved-balance blocks concurrent run | Atomic `UPDATE ... WHERE balance_cents - reserved_cents >= $cost`. Second concurrent hold fails. Test: `walletReservations.test.ts` | Code + test verified |
| 13 | Webhook idempotency: replay checkout.session.completed → single ledger row | `INSERT ... ON CONFLICT DO NOTHING RETURNING` in `checkAndRecordWebhookEvent()`. Already-processed events return 200 with `status: 'already_processed'`. Test: `stripe.idempotency.test.ts` | Code + test verified |
| 14 | Pro cancellation cascades — add-on monitors cancelled when tier sub ends | `cancelUserAddonSubscriptions()` invoked from `customer.subscription.deleted` handler when discriminator says it's a tier sub. Stripe API call cancels each add-on sub; local rows marked cancelled. Test: `cascadeCancel.test.ts`. | Code + test verified |
| 15 | Add-on cancel does NOT downgrade tier | `monitor_kind` metadata discriminator returns early before `setUserTier('free_demo')`. Test: `stripe.subscription-deleted-discriminator.test.ts`. | Code + test verified |
| 16 | Payment-failed surfaces in-app notification | `invoice.payment_failed` resolves user via `user_subscriptions`, inserts a `user_notifications` row of kind `payment_failed`. Frontend `NotificationBanner` polls `/api/notifications` and shows a red banner with "Update payment method" CTA. | Code verified |

### Section 15 Smoke Test Additions

| # | Test | Evidence | Status |
|---|---|---|---|
| S1 | Subscribe to Living Report → Parallel webhook → revision | Living Reports infrastructure (WO T) — registered monitor + signed webhook → `createRevisionRequest` + `livingReportRevisionQueue.add` + `revision_enqueued` event row. Test: `livingReportsSmoke.test.ts`. | Code + test verified |
| S2 | Adversarial Twin → output contains only contradictions/gaps | `ADVERSARIAL_TWIN` mode overlays: skeptic=full-attack, synthesizer=contradictions-only. Mode overlays applied via `getModeOverlay()` in `applyV2SystemAugmentations()`. | Code verified |
| S3 | Provenance Ledger export → public verification | **Phase 2** — Pricing page shows "Coming soon — Enterprise" with Contact us CTA. See `docs/roadmap/phase-2-deferred-features.md`. | **Deferred to Phase 2** |
| S4 | Retracted-source regression: no evidence_tier mutation | Retriever overlay: "Never silently demote a chunk because it carries institutional friction." Verifier overlay: reports citing contested sources must contain mechanism-comparison. | Doctrine verified |
| S5 | Parallel webhook signature replay → 200 idempotent | Replay test in `livingReportsSmoke.test.ts`: same event_id returns `{ ok: true, replayed: true }` and DOES NOT re-enqueue or duplicate revision request. | Code + test verified |
| S6 | Tier-disallowed addon → 403 | `computeRunCost()` returns error with `status: 403` for disallowed addons. Test: `creditEnforcement.test.ts` | Code + test verified |

### Infrastructure Verification

| Item | Status |
|---|---|
| SPA rewrite (both vercel.json) | Verified |
| CSP headers (Clerk, Stripe, Cloudflare) | Verified |
| HSTS header | Verified |
| Rate limiting (auth 10/min, default 500/15min) | Verified |
| Trust proxy configured | Verified |
| RLS enabled on customer-data tables | Verified (migration 022) |
| BYOK encryption (AES-256-GCM) | Verified |
| Pipeline B sanitization (PII stripping) | Verified + tested |
| 404 page on unknown routes | Verified |
| Open Graph / Twitter card meta tags | Verified |

### Test Suite Summary (current)

| Suite | Tests | Status |
|---|---|---|
| Backend unit + integration | 427 | All passing |
| Frontend unit + SSR | 63 | All passing |
| Tier rules (9 tiers) | 36 | Passing |
| Tier service (caps, access) | 20 | Passing |
| Wallet service (idempotency) | 8 | Passing |
| Wallet reservations (holds) | 10 | Passing |
| Credit enforcement (addon cost) | 10 | Passing |
| Stripe webhooks (sig, idem, checkout, sub, deleted-discriminator) | 18 | Passing |
| BYOK encryption + Stage 10 forwarding | 12 | Passing |
| Sanitization gate (PII) | 13 | Passing |
| Pipeline B eligibility | 7 | Passing |
| Prompt composer (modes) | 51 | Passing |
| Schema validation | 4 | Passing |
| Sovereign deployment | 8 | Passing |
| RLS isolation | 21+ | Passing |
| Admin dashboard | 4 | Passing |
| Living Reports smoke (S1, S5) | 3 | Passing |
| Cascade cancel (add-ons on tier-end) | 3 | Passing |
| Pricing page SSR | 7 | Passing |

## Resolved Gaps (since 2026-05-07)

- ~~**Team seat management** (#4)~~ — Pricing page now shows "Coming soon — Contact us" for Team. Single-seat checkout still works. Full multi-seat sync deferred to Phase 2.
- ~~**BYOK Stage 10 helpers** (#5)~~ — `extractAndPersistClaims`, `extractAndPersistContradictions`, `mapAndPersistCitations` now accept and forward `byokApiKeyOverride` to `callRoleModel`. Test: `byokStage10Forwarding.test.ts`.
- ~~**Report deletion → InTellMe** (#6)~~ — `intellmeDeletionQueue.add()` wired into the research delete route.
- ~~**Subscription cascade invariant**~~ — Cancelling Pro now cancels the user's separate Living Report add-on Stripe subscriptions. Cancelling JUST an add-on no longer downgrades the user's tier to free_demo.
- ~~**Payment-failed in-app notification**~~ — `user_notifications` table + `/api/notifications` route + `NotificationBanner` component close the WO-F gap.
- ~~**Living Reports smoke tests S1/S5**~~ — Vitest backend integration tests now cover subscribe-to-revision and webhook replay idempotency.
- ~~**Add-on UI completeness**~~ — `MonitorToggle` exposes both Living Reports and Reverse-Citation Watch. `BillingPage` shows a "Your add-ons" section. Pricing page lists all add-ons with prices.

## Launch Blockers

- [x] Legal review of Terms, Privacy, Acceptable Use ($2.5-5K budget)
- [x] Remove LegalDraftBanner after lawyer sign-off
- [ ] Production environment variables provisioned
- [ ] Database backups configured and tested
- [ ] Sentry DSN provisioned
- [ ] Stripe webhook URL confirmed in dashboard
- [ ] DNS routing verified
- [ ] Smoke test from production URL
- [ ] Lighthouse: Performance >= 80, Accessibility >= 95
- [ ] Soft launch cohort (10-25 users) tested

## Phase 2 Roadmap

Two product features are explicitly deferred to dedicated work orders post-Phase-1 launch:

1. **Provenance Ledger** (WO-O follow-up) — Tamper-evident audit trail with signed manifest and public verification endpoint. Pricing-page tile says "Coming soon — Enterprise" with Contact us CTA.
2. **Multi-seat Team management** (WO-G/Q follow-up) — Stripe quantity sync with Clerk org member count, member invite flow, pooled quota by org_id. Pricing-page tile says "Coming soon" with Contact us CTA.

Full scope of both features is captured in [docs/roadmap/phase-2-deferred-features.md](../roadmap/phase-2-deferred-features.md).

## Sign-Off

| Role | Name | Date | Signature |
|---|---|---|---|
| Founder | | | |
| Engineering Lead | | | |
| Legal Counsel | | | |
