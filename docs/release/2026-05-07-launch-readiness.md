# Launch Readiness Report — 2026-05-07

**Status: IN PROGRESS**
**Sign-off: Pending founder approval**

## Section 15 Checklist

### Core User Flows

| # | Test | Evidence | Status |
|---|---|---|---|
| 1 | New user signup → onboarding → wallet top-up → first Standard report → wallet decrement → report visible | Clerk webhook creates user + user_tiers row (WO C/G). Stripe checkout creates wallet credit (WO E/F). Research route enforces tier + credit (WO G/H). Report persisted on completion. | Code verified |
| 2 | Free demo runs 3 reports → 4th blocked with upgrade path | `checkTierAccess()` enforces `lifetimeReportCap: 3` for free_demo. Returns 403 with `upgrade_path: '/pricing'`. Test: `tierService.test.ts` | Code + test verified |
| 3 | Pro user subscribes → mode access granted → quota tracked | Stripe webhook syncs subscription → `setUserTier('pro')`. Pro tier allows all 5 objectives. `incrementReportCount` tracks monthly usage. | Code verified |
| 4 | Team owner adds members → Stripe seats → org shared access | RLS policy on `user_tiers` includes `org_id` check for shared access. **NOT FULLY IMPLEMENTED:** Stripe checkout creates single-seat subscriptions (`quantity: 1`); multi-seat management, member invite flow, and Stripe seat update on member add are not yet built. Requires dedicated team-management WO. | **Blocked** |
| 5 | BYOK user adds key → runs use their key | `storeKey()` validates via provider API dispatch table. Orchestrator passes `byokApiKeyOverride` to main `callRoleModel` calls, `discoveryOrchestrator`, and `reportGenerator`. **GAP:** Stage 10 helpers (`extractAndPersistClaims`, `extractAndPersistContradictions`, `mapAndPersistCitations`) call `callRoleModel` without forwarding `byokApiKeyOverride`. BYOK runs use platform key for these stages. | **Partial** |
| 6 | User deletes report → InTellMe deletion job enqueued | Deletion worker exists and consumes `intellmeDeletionQueue`. **GAP:** No producer — the `DELETE /api/research/:id` route deletes the DB row but does not enqueue an InTellMe deletion job. Requires wiring `.add()` call into the delete route. | **Blocked** |
| 7 | User opts out of Pipeline B → next run skips | `evaluatePipelineBEligibility()` checks `user_ingestion_consent.pipeline_b_consent`. When false, returns `{ eligible: false, reasons: ['user_opted_out'] }`. Test: `pipelineBEligibility.test.ts` | Code + test verified |
| 8 | Sovereign deployment cannot reach InTellMe | `EXCLUDE_INTELLME_CLIENT=true` → stub loaded. Stub throws on any call. `isSovereignDeployment` → `pipeline_b_eligible=false`. Tests: `sovereignDeployment.test.ts` | Code + test verified |
| 9 | Admin can comp user's tier | `POST /api/admin/users/:id/tier-override` with reason. Uses `adminQuery` to bypass RLS. Audit log row written. | Code verified |
| 10 | Failed run does not charge user | Orchestrator calls `releaseHold()` on terminal failure. `consumeHold` only on `status='completed'`. Test: wallet hold lifecycle. | Code verified |
| 11 | 402 when wallet empty | `placeHold()` returns `success: false` when `balance_cents - reserved_cents < cost`. Route returns 402 with `checkout_path`. | Code verified |
| 12 | 402 when reserved-balance blocks concurrent run | Atomic `UPDATE ... WHERE balance_cents - reserved_cents >= $cost`. Second concurrent hold fails. Test: `walletReservations.test.ts` | Code + test verified |
| 13 | Webhook idempotency: replay checkout.session.completed → single ledger row | `INSERT ... ON CONFLICT DO NOTHING RETURNING` in `checkAndRecordWebhookEvent()`. Already-processed events return 200 with `status: 'already_processed'`. Test: `stripe.idempotency.test.ts` | Code + test verified |

### Section 15 Smoke Test Additions

| # | Test | Evidence | Status |
|---|---|---|---|
| S1 | Subscribe to Living Report → Parallel webhook → revision | Living Reports infrastructure (WO T) — report_monitors table and webhook handler. | Requires WO T |
| S2 | Adversarial Twin → output contains only contradictions/gaps | `ADVERSARIAL_TWIN` mode overlays: skeptic=full-attack, synthesizer=contradictions-only. Mode overlays applied via `getModeOverlay()` in `applyV2SystemAugmentations()`. | Code verified |
| S3 | Provenance Ledger export → public verification | Ledger exporter (WO O spec) — tracked for dedicated implementation. | Deferred |
| S4 | Retracted-source regression: no evidence_tier mutation | Retriever overlay: "Never silently demote a chunk because it carries institutional friction." Verifier overlay: reports citing contested sources must contain mechanism-comparison. | Doctrine verified |
| S5 | Parallel webhook signature replay → 200 idempotent | Parallel Monitor webhook (WO T) — shared idempotency module from WO F. | Requires WO T |
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

### Test Suite Summary

| Suite | Tests | Status |
|---|---|---|
| Backend unit tests | 380+ | All passing |
| Frontend TypeScript | Clean | No errors |
| Tier rules (9 tiers) | 36 tests | Passing |
| Tier service (caps, access) | 20 tests | Passing |
| Wallet service (idempotency) | 8 tests | Passing |
| Wallet reservations (holds) | 10 tests | Passing |
| Credit enforcement (addon cost) | 10 tests | Passing |
| Stripe webhooks (sig, idem, checkout, sub) | 16 tests | Passing |
| BYOK encryption (security) | 8 tests | Passing |
| Sanitization gate (PII) | 13 tests | Passing |
| Pipeline B eligibility | 7 tests | Passing |
| Prompt composer (modes) | 51 tests | Passing |
| Schema validation | 4 tests | Passing |
| Sovereign deployment | 8 tests | Passing |
| RLS isolation | 21+ tests | Passing |
| Admin dashboard | 4 tests | Passing |

## Known Gaps (from QA review)

- **Team seat management** (#4): Multi-seat Stripe subscriptions, member invite flow, seat updates not implemented. Requires dedicated WO.
- **BYOK Stage 10 helpers** (#5): `extractAndPersistClaims`, `extractAndPersistContradictions`, `mapAndPersistCitations` don't forward `byokApiKeyOverride`. Fix: add parameter to these functions and pass from orchestrator.
- **Report deletion → InTellMe** (#6): Deletion worker exists but no producer. Fix: add `intellmeDeletionQueue.add()` to the research delete route.

## Launch Blockers

- [ ] Legal review of Terms, Privacy, Acceptable Use ($2.5-5K budget)
- [ ] Remove LegalDraftBanner after lawyer sign-off
- [ ] Production environment variables provisioned
- [ ] Database backups configured and tested
- [ ] Sentry DSN provisioned
- [ ] Stripe webhook URL confirmed in dashboard
- [ ] DNS routing verified
- [ ] Smoke test from production URL
- [ ] Lighthouse: Performance >= 80, Accessibility >= 95
- [ ] Soft launch cohort (10-25 users) tested

## Sign-Off

| Role | Name | Date | Signature |
|---|---|---|---|
| Founder | | | |
| Engineering Lead | | | |
| Legal Counsel | | | |
