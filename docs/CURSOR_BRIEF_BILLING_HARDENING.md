# Work Order Y — Billing & Subscription Hardening (Production Incident)

**Branch:** `fix/billing-subscription-hardening` (cut from `main`)
**PR title:** `WO-Y: Stripe subscription end-to-end repair (funnel, customer persistence, webhook+confirm reconciliation, tier-row integrity)`
**Owner:** Brandon (GooseyPrime)
**Severity:** P0 — paid customers stuck on free tier; 100%-coupon Pro purchases not honored.

---

## 0. Mission

Fix ResearchOne's billing/subscription/payment entitlement end-to-end, build a unified billing history feed, and redesign the BillingPage UI for a professional subscription-management experience. Stripe Checkout *appears* to succeed (including with 100% coupons) but the app frequently keeps the account on `free_demo`, no transaction history is visible, Pro-gated research objectives stay locked, and add-ons are browsable-but-unselectable. Additionally, the public "Subscribe to Pro" CTA on the pricing page is not actually a checkout call at all — it sends the user through sign-up → onboarding → `/app/research` and only records `initialTier: 'pro'` in Clerk `unsafeMetadata` that nothing consumes. The current BillingPage is a 460-line stacked-section monolith with weak hierarchy that does not surface the information a paying customer actually needs.

This is a production incident **and** a UX refresh. Do not ship a superficial patch. Audit and fix the full chain:

```
pricing CTA → auth/signup/onboarding → Stripe checkout session creation
→ Stripe redirect return → server-side confirmation → webhook reconciliation
→ DB entitlement rows → unified billing history → redesigned BillingPage UI
→ research objective gating → add-on gating → usage accounting
→ Stripe Customer Portal for self-service management
```

All work must follow `AGENTS.md` and `.cursor/rules/*` (especially `21-billing-and-webhook-contracts.mdc`, `10-state-machine-and-multi-writer.mdc`, `11-error-paths-and-logging.mdc`, `13-deploy-skew-and-schema.mdc`, `16-tests-must-fail-without-the-fix.mdc`, `33-plan-confirmation-gate.mdc`).

---

## 1. Verified defects (the *facts*, not theories)

Each item below was confirmed by reading the actual files in the repo. Treat these as the ground-truth bug list.

### D1 — Public pricing CTA does not invoke Stripe
`frontend/src/pages/PricingPage.tsx:60` Pro card href = `/sign-up?tier=pro` (`<Link>` only). `SignUpPage.tsx:7` redirects to `/onboarding?tier=pro`. `OnboardingPage.tsx:99` text reads *"pricing intent is recorded; checkout happens from Account when you are ready,"* stashes `initialTier: 'pro'` in Clerk `unsafeMetadata`, then `navigate('/app/research')`. No `stripe.checkout.sessions.create` anywhere in this funnel.

### D2 — No persistent Stripe customer; no `client_reference_id`
`grep -rn 'stripe.customers' backend/src` → **zero hits.** Every `checkout.sessions.create` call (`billing.ts:79`, `billing.ts:113`, `monitors.ts:85`) creates a fresh anonymous Stripe customer. `client_reference_id` is never set on any call.

### D3 — Foreign-key precondition not enforced before webhook writes
`016_billing_tables.sql` lines 2, 10, 24 declare `user_subscriptions.user_id REFERENCES users(id)`, `wallet_ledger.user_id REFERENCES users(id)`, `user_wallets.user_id REFERENCES users(id)`. `018_tier_tables.sql:2` declares `user_tiers.user_id REFERENCES users(id)`. The Stripe webhook (`stripe.ts`) calls `upsertUserSubscription` and `setUserTier` without first ensuring the `users` row exists. If the Clerk Svix webhook ever missed (rotated secret, deploy skew, dropped network), every Stripe write throws Postgres `23503`, dispatcher records `processing_error`, Stripe retries 3 days then quits. Silent permanent failure.

### D4 — `checkout.session.completed` handler is wallet-topup-only
`stripe.ts:55-86`. Handler reads `metadata.topupAmountCents` and `metadata.price_id`. For subscription-mode sessions `billing.ts:119-128` sets neither — only `{userId, tier}` on the session. Handler hits `amountCents === null` → logs `stripe_checkout_unknown_amount` → silent return. The "the user just completed checkout" event therefore does *nothing* for subscriptions.

### D5 — `invoice.payment_succeeded` not registered
`stripe.ts:325-331`. Only `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` are mapped. For 100%-coupon subscriptions, `invoice.payment_succeeded` is the most reliable "this is real and paid" signal. Missing.

### D6 — Metadata key inconsistency
`billing.ts:120` sets `metadata.userId` (camelCase) on session; `:125` sets `subscription_data.metadata.user_id` (snake_case) on subscription. Webhook handlers accept both as defensive workaround (`stripe.ts:57`, `:106`). Not currently broken but invites regressions.

### D7 — No server-side reconciliation on return from Stripe
There is no `POST /billing/checkout/confirm` endpoint. `BillingPage.tsx:84-98` only invalidates React Query caches when `?checkout=success` is present and immediately strips the query param. If the webhook hasn't fired yet (or hits any of D3/D4/D5/D6), the page reads `free_demo` from the DB and that's what the user sees.

### D8 — Success URL omits `{CHECKOUT_SESSION_ID}` template
`backend/.env.production.example:121`, `.env.development.example:118`, `.env.example:63` all set:
```
STRIPE_CHECKOUT_SUCCESS_URL=…/app/billing?checkout=success
```
No `&session_id={CHECKOUT_SESSION_ID}`. Stripe will substitute that template if provided. Without it, the frontend has no session ID to hand a confirm endpoint.

### D9 — `getUserTier` masks missing rows with a synthetic default
`tierService.ts:49-58` returns an in-memory `free_demo` object when no row exists. Caller cannot distinguish "row exists, free_demo" from "row missing entirely". `checkTierAccess` therefore appears to work — but `incrementReportCount` runs against a row that isn't there.

### D10 — `incrementReportCount` silently updates zero rows
`tierService.ts:101-131` runs `UPDATE user_tiers SET … WHERE user_id = $1`. If no row, zero rows match, **no error.** Combined with D9, usage never advances and Stripe-paid users get unlimited free reports (while free-tier users who lack a row also get unlimited).

### D11 — `/api/auth/sync` does not ensure `user_tiers`
`auth.ts:226-233` only upserts the `users` row. The Clerk webhook does call `ensureUserTierRow` (`clerk.ts:75-79`), but `/sync` is the *backstop* for users whose Clerk webhook missed — and it leaves them with `users` ✓ / `user_tiers` ✗, the exact state that triggers D9+D10.

### D12 — Free demo cap is 3 in code; product spec says 2
`tierRules.ts:73` → `lifetimeReportCap: 3`. No grandfather logic exists anywhere (verified via grep). The 3 is current code-of-record. Need to change to 2 (or whatever product spec says canonical) and update copy.

### D13 — "Recent transactions" UI shows wallet ledger only
`BillingPage.tsx:432-456`. Section title is "Recent transactions" but data source is `walletQuery.data?.history` — wallet ledger only. Subscription purchases never appear because no `billing_events` table exists.

### D14 — Add-on UI gate (`hasProAccess`) is downstream of all of the above
`BillingPage.tsx:150-156, 393-401`. "Add-ons are browsable but unselectable" is the *symptom* of `effectiveTier !== 'pro'`. Fix the entitlement sync and this disappears. No separate code change needed here.

---

## 2. Things that are NOT broken (don't waste cycles)

Other analyses suggested these. Verified against code; they are fine:

- **RLS does not block the webhook.** `pool.ts:75-98`: `query()` only enters the `SET ROLE application_role` branch when `rlsStore.getStore()?.userId` is non-null. Stripe webhooks arrive with `req.auth.userId = null`, `rlsContextMiddleware` sets `{userId: null}`, `query()` falls through to the bare-pool path which runs as the table owner — implicitly bypassing RLS. `022_rls_policies.sql:117, 121-123` explicitly note this.
- **Idempotency does not swallow errors.** `verifyAndDispatch.ts:76-85` writes `processing_error` to `stripe_webhook_events`. Visible to operators.
- **Body-parser ordering is correct.** `app.ts:47-53` registers `express.raw` BEFORE `express.json` on `/api/webhooks/stripe` AND `/webhooks/stripe`.
- **Signature verification is correct.** `stripe.ts:357-358` passes the raw buffer to `constructEvent`.
- **Tier resolution fallback chain is correct.** `subscriptionService.ts:101-123` falls back `lookup_key → priceId → metadata.tier`.

---

## 3. Architectural plan

Apply the following invariants:

1. **Local-DB rows must exist before any Stripe call that depends on them.** Both `users` and `user_tiers` must be guaranteed-present before `POST /billing/checkout/*` issues a session.
2. **Stripe customers are 1:1 with Clerk users and persistent.** Look up or create `stripe_customer_id` keyed on Clerk `userId` and pass `customer` + `client_reference_id` on every checkout session.
3. **There are TWO writers to entitlement state, both must produce the same result.** (a) Server-side confirm endpoint called by the frontend on return from Stripe, (b) Stripe webhook. Both must call a single shared `syncStripeSubscriptionToUser(...)` function. Both must be idempotent. The frontend's confirm call is the *fast* path; the webhook is the *durable* path.
4. **`getUserTier` must distinguish "row missing" from "row present and free_demo"** so callers can decide whether to create-and-retry or fail loud.
5. **`incrementReportCount` must never silently update zero rows** — either ensure-row-first or `INSERT … ON CONFLICT DO UPDATE`.
6. **Never grant entitlement from Clerk `unsafeMetadata` alone.** Stripe (or local row synced from Stripe) is the source of truth.

---

## 4. Implementation — phased plan

### Phase 0 — Branch + scope confirmation (Rule 33 plan-confirmation gate)

Before any code changes, post a comment in the PR draft titled "Plan confirmation" listing every file you will modify in Phase 1–6 plus the new migration filename. Wait for approval if working with reviewer; otherwise self-approve and proceed.

### Phase 1 — Local row integrity (foundation; fixes D3, D9, D10, D11)

**Files:** `backend/src/services/tier/tierService.ts`, `backend/src/api/routes/auth.ts`, `backend/src/db/migrations/NN1_backfill_user_tiers.sql` (new — pick next number).

1. Add a new function `ensureUserAndTierRow(userId: string, email?: string|null): Promise<void>` in a new file `backend/src/services/users/ensureUserRow.ts`. It must upsert `users` AND `user_tiers` in a single transaction, idempotent, tolerant of missing migrations (`42P01`/`42703` codes → log + return like the existing services do).
2. Change `getUserTier` signature to optionally return a discriminator. Add a sibling `getOrCreateUserTier(userId)` that calls `ensureUserAndTierRow` if missing and returns a real row. Callers in research/billing routes switch to `getOrCreateUserTier` so they never see the synthetic default.
3. Rewrite `incrementReportCount` to use `INSERT … ON CONFLICT DO UPDATE`:
   ```sql
   INSERT INTO user_tiers (user_id, tier, current_period_reports_used,
                           current_period_deep_reports_used, lifetime_reports_used,
                           current_period_resets_at, updated_at)
   VALUES ($1, 'free_demo', 1, $2, 1, $3, NOW())
   ON CONFLICT (user_id) DO UPDATE SET
     current_period_reports_used = user_tiers.current_period_reports_used + 1,
     current_period_deep_reports_used =
       user_tiers.current_period_deep_reports_used + EXCLUDED.current_period_deep_reports_used,
     lifetime_reports_used = user_tiers.lifetime_reports_used + 1,
     updated_at = NOW();
   ```
   …with `$2` being `1` for deep, `0` otherwise. Tests in step 7 below must fail without this fix.
4. Update `POST /api/auth/sync` (`auth.ts:216-238`) to call `ensureUserAndTierRow(userId, email)` instead of the bare `users` upsert.
5. New migration `NN1_backfill_user_tiers.sql`:
   ```sql
   -- Backfill: any users row without a matching user_tiers row gets a free_demo row.
   INSERT INTO user_tiers (user_id, tier, current_period_resets_at, updated_at)
   SELECT u.id, 'free_demo',
          date_trunc('month', NOW()) + INTERVAL '1 month',
          NOW()
   FROM users u
   LEFT JOIN user_tiers ut ON ut.user_id = u.id
   WHERE ut.user_id IS NULL
   ON CONFLICT (user_id) DO NOTHING;

   -- Backfill: any user_subscriptions row with paid-access status but user_tiers
   -- still on free_demo gets bumped to the catalog tier from the subscription.
   UPDATE user_tiers ut
   SET tier = us.tier, updated_at = NOW()
   FROM user_subscriptions us
   WHERE ut.user_id = us.user_id
     AND ut.tier = 'free_demo'
     AND us.tier <> 'free_demo'
     AND us.status IN ('active','trialing','past_due');
   ```
6. Frontend hook: `useEnsureUserSynced` (new) calls `POST /api/auth/sync` once after Clerk `isSignedIn` becomes true. Wire into `App.tsx` so every signed-in session guarantees the local rows exist. (This is a belt-and-braces backstop for missed Clerk webhooks.)
7. Tests added in `backend/src/__tests__/tierService.row-integrity.test.ts`:
   - `incrementReportCount` with no pre-existing row → row created, counter = 1.
   - `getOrCreateUserTier` for new user → row inserted, returned.
   - `/api/auth/sync` for user with no `user_tiers` row → row created.

### Phase 2 — Persistent Stripe customer mapping (fixes D2)

**Files:** new migration `NN2_stripe_customers.sql`, new service `backend/src/services/billing/stripeCustomer.ts`, edits to `backend/src/api/routes/billing.ts`.

1. New migration:
   ```sql
   CREATE TABLE IF NOT EXISTS stripe_customers (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     stripe_customer_id TEXT NOT NULL UNIQUE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   -- RLS: same pattern as user_subscriptions (per-user isolation).
   DO $$
   BEGIN
     IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
       EXECUTE 'ALTER TABLE stripe_customers ENABLE ROW LEVEL SECURITY';
       EXECUTE $p$CREATE POLICY stripe_customers_user_isolation ON stripe_customers
         FOR ALL TO application_role
         USING (user_id = current_setting('app.user_id', true))$p$;
     END IF;
   END $$;
   ```
2. New service `stripeCustomer.ts`:
   ```ts
   export async function getOrCreateStripeCustomer(
     userId: string, email: string | null
   ): Promise<string> {
     const existing = await queryOne<{ stripe_customer_id: string }>(
       'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1',
       [userId]
     );
     if (existing) return existing.stripe_customer_id;

     // Defensive: check Stripe for an existing customer with this email or
     // metadata.user_id (e.g. created by an earlier broken session) before
     // creating a new one. This consolidates orphans from the pre-fix era.
     const stripe = getStripeClient();
     const search = await stripe.customers.search({
       query: `metadata['user_id']:'${userId}'`,
     }).catch(() => ({ data: [] as Stripe.Customer[] }));

     const customer = search.data[0]
       ?? await stripe.customers.create({
         email: email ?? undefined,
         metadata: { user_id: userId },
       });

     await query(
       `INSERT INTO stripe_customers (user_id, stripe_customer_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id`,
       [userId, customer.id]
     );
     return customer.id;
   }
   ```
3. Modify `POST /billing/checkout/subscription` and `POST /billing/checkout/topup`:
   - Call `ensureUserAndTierRow(userId, email)` before creating the session.
   - Call `getOrCreateStripeCustomer(userId, email)`.
   - Pass `customer: stripeCustomerId` to the session create.
   - Pass `client_reference_id: userId`.
   - Validate `priceId` against config: it must match a configured subscription price ID; reject with 400 if not. Also validate that the requested `tier` matches the tier the price ID maps to (use `getTierForSubscriptionPrice`).
   - Standardize metadata keys to **snake_case throughout**: `{ user_id, tier, price_id, checkout_kind: 'subscription' | 'topup' }` on both session metadata and `subscription_data.metadata`.
4. Tests in `backend/src/__tests__/billing.checkout-session.test.ts`:
   - Verifies `customer` and `client_reference_id` are passed.
   - Verifies tier/priceId mismatch rejected with 400.
   - Verifies repeated calls reuse the same `stripe_customer_id`.

### Phase 3 — Success URL template (fixes D8)

**Files:** `backend/.env.production.example`, `backend/.env.development.example`, `backend/.env.example`, `backend/src/config/stripeCheckoutUrls.ts`, docs/runbooks.

1. Update all three `.env*.example`:
   ```
   STRIPE_CHECKOUT_SUCCESS_URL=https://researchone.io/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}
   ```
2. Update `stripeCheckoutUrls.ts` validator to *require* `{CHECKOUT_SESSION_ID}` substring in production (throw if absent) and add a unit test for it.
3. Update `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` to call out the template requirement.

### Phase 4 — Shared subscription sync + confirm endpoint (fixes D4, D5, D6, D7)

**Files:** new `backend/src/services/billing/syncStripeSubscription.ts`, edits to `backend/src/api/webhooks/stripe.ts`, new route `POST /api/billing/checkout/confirm` in `backend/src/api/routes/billing.ts`.

1. Extract a single canonical sync function:
   ```ts
   // syncStripeSubscription.ts
   export async function syncStripeSubscriptionToUser(args: {
     subscription: Stripe.Subscription;
     userId: string;       // resolved by caller; never trust client
     eventId?: string;     // for logging only
     source: 'webhook' | 'confirm-endpoint';
   }): Promise<void> {
     // Existing logic from handleSubscriptionCreatedOrUpdated in stripe.ts,
     // refactored. Must:
     //  - distinguish add-on subscriptions via items[].price.id matching
     //    livingReportMonthly / reverseCitationWatchMonthly
     //  - for add-on path, only registerMonitor; never touch user_tiers
     //  - for tier path, ensureUserAndTierRow then upsertUserSubscription
     //    then setUserTier (only if status grants access)
   }
   ```
2. Refactor `stripe.ts` `handleSubscriptionCreatedOrUpdated` to call `syncStripeSubscriptionToUser` after resolving user_id with this fallback ladder:
   1. `subscription.metadata.user_id` / `userId`
   2. Otherwise expand the customer and read `customer.metadata.user_id`
   3. Otherwise look up `stripe_customers` table by `stripe_customer_id`
   4. If still null, record `processing_error` with explicit reason ("could not resolve user_id from subscription, customer, or stripe_customers table"); do NOT silently return success.
3. Refactor `handleCheckoutSessionCompleted` to branch on `session.mode`:
   ```ts
   if (session.mode === 'payment') {
     // existing wallet top-up logic
   } else if (session.mode === 'subscription') {
     // Retrieve & expand the subscription, then call
     // syncStripeSubscriptionToUser with the same user-id fallback ladder.
   }
   ```
4. Register two more event types: `invoice.payment_succeeded`, `invoice.paid`. Both retrieve their `subscription` field, expand it, and call `syncStripeSubscriptionToUser`. (Defensive — if `customer.subscription.created` fires before the invoice closes, the tier may briefly be `incomplete`; `invoice.payment_succeeded` is the "really paid" confirmation.)
5. Add `POST /api/billing/checkout/confirm` in `routes/billing.ts`:
   ```ts
   router.post('/checkout/confirm', async (req, res, next) => {
     try {
       const userId = req.auth?.userId;
       if (!userId) return res.status(401).json({ error: 'Unauthorized' });

       const sessionId = String(req.body?.sessionId ?? '');
       if (!sessionId.startsWith('cs_')) {
         return res.status(400).json({ error: 'Invalid sessionId' });
       }

       const stripe = getStripeClient();
       const session = await stripe.checkout.sessions.retrieve(sessionId, {
         expand: ['subscription', 'customer'],
       });

       // Verify ownership — defense in depth across all the identity surfaces.
       const sessionUserId =
         session.metadata?.user_id ?? session.metadata?.userId ?? null;
       const subscriptionUserId =
         (typeof session.subscription === 'object' && session.subscription)
           ? (session.subscription.metadata?.user_id ?? null)
           : null;
       const ref = session.client_reference_id ?? null;
       const claimed = sessionUserId ?? subscriptionUserId ?? ref;
       if (!claimed || claimed !== userId) {
         logger.warn('checkout_confirm_ownership_mismatch', {
           userId, sessionId, claimed,
         });
         return res.status(403).json({ error: 'Session does not belong to this user' });
       }

       if (session.mode === 'subscription' && session.subscription) {
         const sub = typeof session.subscription === 'string'
           ? await stripe.subscriptions.retrieve(session.subscription)
           : session.subscription;
         await syncStripeSubscriptionToUser({
           subscription: sub, userId, source: 'confirm-endpoint',
         });
       } else if (session.mode === 'payment') {
         // Wallet top-up: ensure ledger row exists idempotently
         // (same code path as webhook handler but called inline).
       }

       const view = await getBillingSubscriptionView(userId);
       res.json(view);
     } catch (err) { next(err); }
   });
   ```
6. Tests in `backend/src/__tests__/billing.checkout-confirm.test.ts`:
   - 100%-coupon Pro session → returns `effectiveTier: 'pro'`, syncs both tables.
   - Session belongs to another user → 403.
   - Repeated calls are idempotent (no duplicate writes).
   - Topup session → wallet credit applied once even on retry.
   - Add-on subscription does NOT overwrite plan tier.
7. Tests in `backend/src/__tests__/webhooks/stripe.checkout-completed-subscription.test.ts`:
   - `checkout.session.completed` with `mode: 'subscription'` triggers subscription sync, not wallet credit.
8. Tests in `backend/src/__tests__/webhooks/stripe.invoice-payment-succeeded.test.ts`:
   - `invoice.payment_succeeded` syncs the subscription.

### Phase 5 — Pricing/signup funnel repair (fixes D1)

**Files:** `frontend/src/pages/PricingPage.tsx`, `frontend/src/pages/OnboardingPage.tsx`, `frontend/src/lib/billing/checkout.ts`, `frontend/src/utils/signupTier.ts`.

1. `PricingPage` Pro/Student/BYOK/Team cards: replace the bare `<Link to="/sign-up?tier=pro">` with a smart CTA component `<SubscribeCTA tier="pro" />`. Behavior:
   - If `useAuth().isSignedIn === true` AND tier is gated (`pro`, `student`, `byok`, `team`): call `POST /billing/checkout/subscription` directly and redirect to Stripe.
   - If signed out: preserve `?tier=pro` through sign-up → onboarding → BillingPage; on BillingPage, if `initialTier` is set in Clerk metadata AND user has no active subscription, auto-scroll/open the corresponding upgrade button and show a banner "Continue your Pro subscription".
2. `OnboardingPage`:
   - Remove the misleading "pricing intent is recorded; checkout happens from Account when you are ready" copy.
   - Stop navigating to `/app/research` for users with `tier=pro`/`tier=student` intent. Navigate to `/app/billing?intent=pro` instead.
   - On `/app/billing?intent=pro`, prominently show the matching subscribe button.
3. Tests in `frontend/src/__tests__/pricingFunnel.test.tsx`:
   - Signed-in user clicks Pro → asserts `startCheckoutRedirect('/billing/checkout/subscription', …)` was called.
   - Signed-out user clicks Pro → goes to `/sign-up?tier=pro` → onboarding → billing with `intent=pro` highlighted.
   - Free Demo CTA still routes to `/sign-up` only (no checkout).

### Phase 6 — BillingPage return flow (consumes Phase 4 confirm endpoint)

**Files:** `frontend/src/pages/BillingPage.tsx`.

1. Replace the existing `useEffect` (lines 84-98) that only invalidates queries. New flow:
   ```ts
   const [confirming, setConfirming] = useState<'idle'|'in_progress'|'error'>('idle');
   const [confirmError, setConfirmError] = useState<string|null>(null);

   useEffect(() => {
     const checkout = searchParams.get('checkout');
     const sessionId = searchParams.get('session_id');
     if (checkout !== 'success') return;

     if (!sessionId) {
       // Fallback path — old success URLs without session_id. Show a warning.
       void queryClient.invalidateQueries({ queryKey: BILLING_SUBSCRIPTION_QUERY_KEY });
       void queryClient.invalidateQueries({ queryKey: ['billing-wallet'] });
       setSearchParams(p => { p.delete('checkout'); return p; }, { replace: true });
       return;
     }

     setConfirming('in_progress');
     void (async () => {
       try {
         const { data } = await api.post<BillingSubscription>(
           '/billing/checkout/confirm', { sessionId }
         );
         queryClient.setQueryData(BILLING_SUBSCRIPTION_QUERY_KEY, data);
         await queryClient.invalidateQueries({ queryKey: ['billing-wallet'] });
         await queryClient.invalidateQueries({ queryKey: ['billing-monitors'] });
         setConfirming('idle');
         setSearchParams(p => {
           p.delete('checkout'); p.delete('session_id'); return p;
         }, { replace: true });
       } catch (e) {
         setConfirming('error');
         setConfirmError(extractApiError(e));
       }
     })();
   }, [searchParams, queryClient, setSearchParams]);
   ```
2. Render states: `idle` = normal page; `in_progress` = "Finalizing your subscription…" banner above the Wallet section; `error` = red banner with retry button (re-runs the confirm POST).
3. Tests in `frontend/src/__tests__/billingPage.confirm.test.tsx`:
   - Land with `?checkout=success&session_id=cs_test_x` → confirm POSTed → tier renders `Pro`.
   - Confirm fails → error banner shown with retry.
   - Land without `session_id` → fallback invalidation path, warning shown.

### Phase 7 — Free demo cap correction + UI copy (fixes D12)

**Files:** `backend/src/config/tierRules.ts`, `frontend/src/pages/PricingPage.tsx`, `frontend/src/pages/LandingPage.tsx`, `frontend/src/pages/ResearchPageV2.tsx` (copy only), tests.

1. Confirm product spec value (Brandon: confirm in PR — 2 or 3?). The brief assumes **2**. Set `tierRules.ts:73` → `lifetimeReportCap: 2`.
2. Replace `"$0 — 3 reports lifetime"` literal in `PricingPage.tsx:56` and `LandingPage.tsx:200` with `"$0 — 2 reports lifetime"`.
3. Update test fixtures that hard-coded `3`.

### Phase 8 — Unified billing history backend (fixes D13)

**Files:** new migration `NN3_billing_events.sql`, new service `backend/src/services/billing/billingEventsService.ts`, edits to `backend/src/services/billing/syncStripeSubscription.ts`, edits to `backend/src/api/webhooks/stripe.ts`, edits to `backend/src/api/routes/billing.ts`.

The fix is a proper unified history feed, not a cosmetic label change. Wallet ledger continues to live in `wallet_ledger` (existing writers and idempotency keys are unchanged). A new `billing_events` table captures subscription/invoice activity. The API merges both streams chronologically.

1. **New migration `NN3_billing_events.sql`:**
   ```sql
   CREATE TABLE IF NOT EXISTS billing_events (
     id BIGSERIAL PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     stripe_event_id TEXT UNIQUE,
     stripe_invoice_id TEXT,
     stripe_subscription_id TEXT,
     stripe_checkout_session_id TEXT,
     event_kind TEXT NOT NULL CHECK (event_kind IN (
       'subscription_started',
       'subscription_renewed',
       'subscription_updated',
       'subscription_canceled',
       'invoice_paid',
       'invoice_payment_failed',
       'addon_started',
       'addon_canceled'
     )),
     tier TEXT,                              -- 'pro', 'student', 'team', 'byok', null for addons
     addon_kind TEXT,                        -- 'living_report' | 'reverse_citation_watch' | null
     amount_cents BIGINT,                    -- positive = charged; null for non-financial events
     currency TEXT,                          -- lowercase ISO; null for non-financial events
     description TEXT NOT NULL,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
     occurred_at TIMESTAMPTZ NOT NULL,       -- from Stripe `created` field, NOT NOW()
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE INDEX IF NOT EXISTS idx_billing_events_user_occurred
     ON billing_events(user_id, occurred_at DESC);

   CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_event_id
     ON billing_events(stripe_event_id)
     WHERE stripe_event_id IS NOT NULL;

   -- RLS — same per-user isolation pattern as user_subscriptions.
   DO $$
   BEGIN
     IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
       EXECUTE 'ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY';
       IF NOT EXISTS (
         SELECT FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'billing_events'
       ) THEN
         EXECUTE $p$CREATE POLICY billing_events_user_isolation ON billing_events
           FOR ALL TO application_role
           USING (user_id = current_setting('app.user_id', true))$p$;
       END IF;
       EXECUTE 'GRANT SELECT, INSERT ON billing_events TO application_role';
       EXECUTE 'GRANT USAGE ON SEQUENCE billing_events_id_seq TO application_role';
     END IF;
   END $$;
   ```
   Append-only by RLS grant — application role gets `SELECT, INSERT` but not `UPDATE/DELETE`. Forensic integrity.

2. **New service `billingEventsService.ts`:**
   ```ts
   export interface BillingEventInsert {
     userId: string;
     stripeEventId?: string | null;          // unique idempotency key
     stripeInvoiceId?: string | null;
     stripeSubscriptionId?: string | null;
     stripeCheckoutSessionId?: string | null;
     eventKind:
       | 'subscription_started' | 'subscription_renewed'
       | 'subscription_updated' | 'subscription_canceled'
       | 'invoice_paid' | 'invoice_payment_failed'
       | 'addon_started' | 'addon_canceled';
     tier?: string | null;
     addonKind?: 'living_report' | 'reverse_citation_watch' | null;
     amountCents?: number | null;
     currency?: string | null;
     description: string;
     metadata?: Record<string, unknown>;
     occurredAt: Date;
   }

   /** Idempotent via stripe_event_id UNIQUE constraint. Repeat calls = no-ops. */
   export async function recordBillingEvent(input: BillingEventInsert): Promise<void> {
     await query(
       `INSERT INTO billing_events (
          user_id, stripe_event_id, stripe_invoice_id, stripe_subscription_id,
          stripe_checkout_session_id, event_kind, tier, addon_kind,
          amount_cents, currency, description, metadata, occurred_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (stripe_event_id) DO NOTHING`,
       [/* ... */]
     );
   }

   /** Unified history merging billing_events + wallet_ledger, paged. */
   export interface BillingHistoryRow {
     kind: 'subscription' | 'wallet';
     id: string;                              // 'be_<id>' or 'wl_<id>'
     occurred_at: string;                     // ISO
     description: string;
     amount_cents: number | null;
     currency: string | null;
     status: 'paid' | 'failed' | 'credit' | 'debit' | 'info';
     metadata: Record<string, unknown>;
   }

   export async function getBillingHistory(
     userId: string, limit: number, offset: number
   ): Promise<{ items: BillingHistoryRow[]; total: number }> {
     // Single UNION ALL query then ORDER BY occurred_at DESC LIMIT/OFFSET.
     // Status mapping:
     //   invoice_paid -> 'paid'; invoice_payment_failed -> 'failed';
     //   subscription_started/renewed/canceled/updated/addon_* -> 'info';
     //   wallet_ledger.entry_type='credit' -> 'credit'; 'debit' -> 'debit'.
   }
   ```

3. **Wire writes into `syncStripeSubscriptionToUser`** (created in Phase 4):
   - On *new* subscription with paid-access status → `subscription_started` event.
   - On status transition to a paid-access state from a non-paid state on the same subscription_id → also `subscription_started` (recovery from past_due).
   - On `current_period_end` advancing AND status is `active` → `subscription_renewed`.
   - On `cancel_at_period_end` toggle or tier change → `subscription_updated`.
   - On status transition to `canceled` → `subscription_canceled` (also written by `customer.subscription.deleted`).
   - For add-on subscriptions (Living Report / RCW) → `addon_started` / `addon_canceled` instead of the plan variants. **Add-on events do NOT carry `tier`.**

4. **Wire writes into webhook handlers in `stripe.ts`:**
   - `invoice.payment_succeeded` / `invoice.paid` → `invoice_paid` event with `amount_cents = invoice.amount_paid`, `currency = invoice.currency`. (Both events are wired so we cover Stripe's deprecation transitions; `ON CONFLICT (stripe_event_id) DO NOTHING` makes the dual write safe.)
   - `invoice.payment_failed` → `invoice_payment_failed` event with `amount_cents = invoice.amount_due`.

5. **New endpoint `GET /api/billing/history` in `routes/billing.ts`:**
   ```ts
   router.get('/history', async (req, res, next) => {
     try {
       const userId = req.auth?.userId;
       if (!userId) return res.status(401).json({ error: 'Unauthorized' });
       const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '25'), 10), 1), 100);
       const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10), 0);
       const result = await getBillingHistory(userId, limit, offset);
       res.json(result);
     } catch (err) { next(err); }
   });
   ```

6. **Backfill** in `NN3_billing_events.sql` (idempotent):
   ```sql
   -- Synthesize subscription_started events from existing user_subscriptions rows
   -- so the new history feed isn't blank for users who paid before this WO.
   INSERT INTO billing_events
     (user_id, stripe_subscription_id, event_kind, tier, description, occurred_at)
   SELECT us.user_id,
          us.stripe_subscription_id,
          'subscription_started',
          us.tier,
          'Subscription started (backfilled)',
          COALESCE(us.updated_at, NOW())
   FROM user_subscriptions us
   WHERE us.stripe_subscription_id IS NOT NULL
     AND us.status IN ('active','trialing','past_due')
     AND NOT EXISTS (
       SELECT 1 FROM billing_events be
       WHERE be.stripe_subscription_id = us.stripe_subscription_id
         AND be.event_kind = 'subscription_started'
     );
   ```

7. **Tests** in `backend/src/__tests__/billing.history.test.ts`:
   - `invoice.payment_succeeded` writes one `invoice_paid` row.
   - Replaying the same event is a no-op (idempotency).
   - Subscription transition active → canceled writes `subscription_canceled`.
   - `GET /billing/history` returns merged + sorted rows from both tables.
   - Pagination: `limit=10&offset=10` returns rows 11–20 of the merged stream.
   - Add-on subscription writes `addon_started` with `tier IS NULL` and `addon_kind` set.

### Phase 8b — BillingPage UI redesign (consumes Phase 8 history + Phase 9 portal)

**Files:** `frontend/src/pages/BillingPage.tsx`, new components in `frontend/src/components/billing/`, `frontend/src/hooks/useBillingHistory.ts` (new).

The current `BillingPage.tsx` is a 460-line monolith that stacks raw sections with weak hierarchy. Decompose into typed sub-components, lift the IA, and use the design tokens already in the codebase (`bg-r1-bg-deep`, `border-r1-border`, etc — verify against `frontend/src/index.css` and existing landing pages).

#### Information architecture (top to bottom)

1. **Plan Card** (`<PlanCard />`) — full-width hero card
   - **Paid user state:** large tier name + cadence (e.g., "Pro · Monthly"), price, renewal date (or "Cancels on …" amber chip when `cancelAtPeriodEnd`), status pill (Active / Trialing / Past due / Canceled), primary action button "Manage subscription" → calls `POST /billing/portal-session`, redirects to Stripe Customer Portal. Secondary text-link "Compare plans".
   - **Free/wallet user state:** the card flips to a compact "Choose a plan" call-to-action with a Lucide `Sparkles` icon and prominent "View plans" button anchored to the Plan Picker below.
2. **Plan Picker** (`<PlanPicker />`) — *only rendered when user does NOT have an active paid plan.* Grid of 4 plan cards (Student / Pro / BYOK / Team) using existing `subscriptionOptionsQuery` data, each with monthly + annual buttons. Highlight the recommended plan (Pro) with a subtle accent ring. When `?intent=pro` (from Phase 5 OnboardingPage redirect) is in the URL, scroll into view + flash a subtle attention pulse on the Pro card on mount.
3. **Usage Card** (`<UsageCard />`) — current-period and lifetime usage with a horizontal progress bar each. Pull from `subQuery.data.lifetimeReportsUsed` / `.lifetimeReportCap` and (new) a `usage` block on the subscription view containing `current_period_reports_used` / `monthlyReportCap` (extend `BillingSubscriptionView` to include these — they already exist on the `user_tiers` row, just plumb them through). When approaching cap (≥80%), color the bar amber; at cap, red plus a "Top up wallet" inline CTA.
4. **Wallet Card** (`<WalletCard />`) — large balance display ("$12.50 USD"), one-line description "Wallet credits are used when you exceed your plan cap or for pay-per-report tiers", pill row of top-up buttons (`$20 / $50 / $100`). Lucide `Wallet` icon. Top-up errors render inline below the pill row, not above.
5. **Add-ons Card** (`<AddonsCard />`) — visible to all tiers; gated state for free users. **Active state:** list of monitors with status pill, monitor kind, linked report title, price; "Manage add-ons" right-aligned link → `/app/monitors`. **Gated state:** explanation + Lucide `Lock` icon + "Upgrade to Pro to unlock add-ons" button anchored to the Plan Picker.
6. **Billing History** (`<BillingHistory />`) — table-style list fetched from `GET /api/billing/history` via new `useBillingHistory` hook. Columns: date · event description · amount · status pill. Rows are typed by `kind`:
   - `subscription_started` → "Subscription started · Pro" + amount blank or charge amount; status `Paid` or `Active`.
   - `subscription_renewed` → "Renewed · Pro" + charge amount; status `Paid`.
   - `subscription_canceled` → "Canceled" + no amount; status `Canceled`.
   - `invoice_paid` → "Invoice paid" + amount; status `Paid`.
   - `invoice_payment_failed` → "Payment failed" + amount due; status `Failed` (red).
   - `addon_started` / `addon_canceled` → "Add-on started · Living Report" etc.
   - `wallet` (credit) → "Wallet top-up" + amount; status `Credit` (emerald).
   - `wallet` (debit) → description from ledger + amount; status `Debit` (slate).

   Pagination: "Load more" button at bottom posting `offset += limit`. Empty state: "No billing activity yet. Your subscription and wallet history will appear here." with subtle illustration or just centered muted text.

#### Visual system

- Cards: `rounded-2xl border border-white/10 bg-r1-bg-deep p-6` (lift from existing pages — verify exact tokens; brief assumes these match).
- Section spacing: `space-y-6` between cards, container `mx-auto max-w-5xl px-6 py-10`.
- Status pills: small (`text-xs px-2 py-0.5 rounded-full`), color mapped:
  - Active / Paid / Credit → emerald (`bg-emerald-500/15 text-emerald-300`)
  - Trialing → indigo
  - Past due → amber
  - Canceled / Debit → slate
  - Failed → red
- Icons: `lucide-react` (already in repo). Suggested: `Crown` for Pro card hero, `Wallet`, `Sparkles`, `Lock`, `Receipt` for history, `AlertTriangle` for past_due.
- Progress bars: shadcn-style or hand-rolled `<div class="h-2 rounded-full bg-white/5 overflow-hidden"><div class="h-full bg-r1-accent transition-all" style="width:..."></div></div>`.
- Loading: skeleton cards (Tailwind `animate-pulse` block matching each card's rough footprint). No spinners as page placeholders — they read amateur.
- "Finalizing your subscription…" banner (from Phase 6) anchors at the top of the page as a sticky info chip until the confirm endpoint resolves; on success it slides up and disappears.

#### Component decomposition

Create these files under `frontend/src/components/billing/`:
- `PlanCard.tsx` — props: `{ subscription: BillingSubscription, onManage: () => void, onCancel: () => void, cancelMutation: …, isAllowlistedAdmin: boolean }`.
- `PlanPicker.tsx` — props: `{ options: SubscriptionOption[], onSubscribe: (priceId, tier) => void, highlightTier?: 'pro' }`.
- `UsageCard.tsx` — props: `{ subscription: BillingSubscription }` (extend hook type to expose period usage).
- `WalletCard.tsx` — props: `{ wallet: WalletResponse | undefined, topupOptions: TopupOption[], onTopup: (priceId) => void, isLoading: boolean, error: string | null }`.
- `AddonsCard.tsx` — props: `{ hasProAccess: boolean, monitors: ReportMonitorRow[], isLoading: boolean }`.
- `BillingHistory.tsx` — props: `{ history: BillingHistoryRow[], hasMore: boolean, isLoading: boolean, onLoadMore: () => void }`.
- `StatusPill.tsx` — props: `{ variant: 'active'|'trialing'|'past_due'|'canceled'|'failed'|'paid'|'credit'|'debit'|'info', children: ReactNode }`.

`BillingPage.tsx` becomes the orchestrator — ~120 lines max. It composes the components, manages the query/mutation/URL-param plumbing, and renders the confirming banner from Phase 6.

#### Hook additions

```ts
// frontend/src/hooks/useBillingHistory.ts
export function useBillingHistoryQuery() {
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['billing-history', offset],
    queryFn: () =>
      api.get<{ items: BillingHistoryRow[]; total: number }>(
        `/billing/history?limit=25&offset=${offset}`
      ).then(r => r.data),
    keepPreviousData: true,
  });
  // expose flattened items + hasMore + loadMore
}
```

Add `monthlyReportCap`, `currentPeriodReportsUsed`, `currentPeriodDeepReportsUsed`, `monthlyDeepReportCap` to the `BillingSubscriptionView` shape (server) and to `BillingSubscription` type (client). Plumb through `billingSubscriptionView.ts` reading from `user_tiers` and `TIER_RULES[effectiveTier]`.

#### Tests in `frontend/src/__tests__/billing/`

- `planCard.test.tsx` — paid state renders tier/renewal/manage button; free state renders "Choose a plan" CTA; past_due renders amber status pill.
- `planPicker.test.tsx` — clicking Pro Monthly calls `startCheckoutRedirect`; `?intent=pro` highlights Pro card.
- `usageCard.test.tsx` — progress bar widths match `used/cap`; ≥80% amber; ≥100% red + top-up CTA.
- `addonsCard.test.tsx` — gated state for free user; active monitors listed for pro user.
- `billingHistory.test.tsx` — merges subscription + wallet rows in correct chronological order; "Load more" advances offset; empty state renders.
- `billingPage.integration.test.tsx` — full page renders with mocked queries; confirm flow shows "Finalizing…" banner.

#### Accessibility

- All status pills get a paired `aria-label` describing status verbally (icon+color alone is not accessible).
- Progress bars use `role="progressbar"` + `aria-valuenow/min/max`.
- The Plan Picker grid items are `<article>` with `<h3>` titles; Subscribe buttons are real `<button>` not divs.
- Color contrast verified against existing tokens — keep AA minimum.

### Phase 9 — Stripe Customer Portal (required, consumed by Phase 8b)

**Files:** `backend/src/api/routes/billing.ts`, `backend/src/services/billing/stripeCustomer.ts`.

This was originally optional; the new Plan Card "Manage subscription" button depends on it, so it's required now.

```ts
router.post('/portal-session', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const email = (req.auth?.payload?.email as string | undefined) ?? null;
    const customerId = await getOrCreateStripeCustomer(userId, email);
    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: config.stripe.successUrl.split('?')[0],   // strip session_id template
    });
    res.json({ url: session.url });
  } catch (err) { next(err); }
});
```

Stripe Customer Portal must be configured in the Stripe Dashboard before this endpoint will work (Settings → Billing → Customer Portal). The runbook in Section 5 lists the required configuration.

Tests:
- `billing.portal-session.test.ts` — returns `{ url }`; creates customer if not yet mapped; rejects unauthenticated.

### Phase 10 — Diagnostics admin script

**File:** new `backend/scripts/billing-diagnostics.ts`.

CLI that prints:
- count of `users` rows without matching `user_tiers` rows
- count of `user_subscriptions` rows with `status IN ('active','trialing','past_due')` and `user_tiers.tier = 'free_demo'`
- recent `stripe_webhook_events` with non-null `processing_error`
- count of `user_subscriptions` rows with `stripe_subscription_id IS NULL`
- duplicate `stripe_subscription_id` values (should be zero — column is UNIQUE)
- users with multiple Stripe customers in `stripe_customers` (orphan consolidation candidates)

---

## 5. Operational runbook (include in PR description)

### Stripe Dashboard webhook configuration

Endpoint URL: `https://<backend-domain>/api/webhooks/stripe` (compatibility alias `/webhooks/stripe` also works).

Required events:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.paid`
- `invoice.payment_failed`

### Stripe Customer Portal configuration (required by Phase 9)

Stripe Dashboard → **Settings → Billing → Customer Portal**:
- Enable the portal.
- Allow customers to: update payment method, view invoice history, cancel subscriptions (with "Cancel at end of billing period"), switch between annual/monthly on existing products.
- Add the products and prices that should be switchable (Student, Pro, BYOK, Team) so users can self-serve plan changes.
- Set the business information and links (terms, privacy) so the portal matches ResearchOne branding.
- Test the portal with a sandbox customer before pointing the production endpoint at it.

### Required environment variables

| Var | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` in prod |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the Dashboard endpoint detail page |
| `STRIPE_CHECKOUT_SUCCESS_URL` | **MUST** include `&session_id={CHECKOUT_SESSION_ID}` template |
| `STRIPE_CHECKOUT_CANCEL_URL` | https URL on the allow-list |
| `STRIPE_PRICE_ID_PRO_MONTHLY` / `…_PRO_ANNUAL` | etc — all configured price IDs |
| `STRIPE_PRICE_ID_STUDENT_MONTHLY` / `…_ANNUAL` | |
| `STRIPE_PRICE_ID_BYOK_MONTHLY` / `…_ANNUAL` | |
| `STRIPE_PRICE_ID_TEAM_SEAT_MONTHLY` / `…_ANNUAL` | |
| `STRIPE_PRICE_ID_WALLET_20` / `…_50` / `…_100` | |
| `STRIPE_PRICE_ID_LIVING_REPORT_MONTHLY` | |
| `STRIPE_PRICE_ID_REVERSE_CITATION_WATCH_MONTHLY` | |

### Stripe CLI local test (smoke)

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# In another shell:
stripe trigger customer.subscription.created \
  --add subscription:metadata.user_id=user_test_local
stripe trigger checkout.session.completed
stripe trigger invoice.payment_succeeded
```

### Manual end-to-end test (production-equivalent)

1. Create a 100%-off coupon in Stripe Dashboard (Forever, Customer-facing).
2. Create a brand-new Clerk test user.
3. Hit `/pricing`, click **Subscribe → Pro Monthly**, complete Stripe Checkout with the 100% coupon.
4. On return, BillingPage should show "Finalizing your subscription…" then resolve to **Tier: Pro · Status: active**.
5. Navigate to `/app/research-v2`; verify the objective dropdown now contains all five objectives.
6. Navigate to `/app/billing`; verify the "Your add-ons" section shows the add-on list, not the gated "Browse add-ons" pitch.
7. Verify `user_subscriptions` row exists with `tier='pro' AND status='active' AND stripe_subscription_id IS NOT NULL`.
8. Verify `user_tiers.tier = 'pro'`.
9. Verify `stripe_customers` row exists.

### Backfilling an existing customer who got stuck on free

For each affected user, run:
```sql
-- Replace placeholders.
SELECT id FROM users WHERE id = '<clerk_user_id>';
SELECT * FROM user_subscriptions WHERE user_id = '<clerk_user_id>';
SELECT * FROM user_tiers WHERE user_id = '<clerk_user_id>';
SELECT * FROM stripe_webhook_events
  WHERE payload->>'metadata' ILIKE '%<clerk_user_id>%'
   OR processing_error IS NOT NULL
  ORDER BY processed_at DESC LIMIT 20;
```

Then either replay the missed Stripe webhook from the Dashboard, OR call the new confirm endpoint server-side using the original `cs_…` ID (visible in Stripe Dashboard → Customer → Checkout sessions).

### Rollback plan

- All new code is additive plus refactors guarded by the existing test suite.
- New migrations (`NN1_backfill_user_tiers.sql`, `NN2_stripe_customers.sql`) are idempotent and reversible by `DROP TABLE stripe_customers` + manual revert of `user_tiers` (no data loss; the backfill is a no-op on subsequent runs).
- Feature-flag the confirm endpoint behind `BILLING_CONFIRM_ENDPOINT_ENABLED=true` (default true) so it can be disabled fast if the Stripe `customers.search` rate limit becomes a problem in production. Frontend falls back to the cache-invalidation path when the endpoint returns 503/disabled.

---

## 6. Acceptance criteria (verified by reviewer before merge)

1. **Fresh-user Pro purchase with 100% coupon completes end-to-end:**
   - `tier=pro`, `effectiveTier=pro`, `status=active|trialing`, `stripeSubscriptionId` populated.
   - Pro-only research objectives selectable immediately on return.
   - Add-ons unlock immediately on return.
2. **Public pricing CTA invokes Stripe Checkout, not a fake redirect to research.**
3. **Wallet top-ups continue to work and write wallet ledger entries.**
4. **No duplicate active subscriptions** are created by refresh/retry on the success URL.
5. **`user_tiers` row is guaranteed for every signed-in user** even if the Clerk webhook was missed.
6. **`incrementReportCount` increments reliably** even when no `user_tiers` row exists at call time.
7. **Free demo cap matches confirmed product spec (2 by default; confirm in PR).**
8. **Webhook failures are observable** via `stripe_webhook_events.processing_error` and structured log entries — no silent success.
9. **`stripe_customers` table is populated** for any user who has ever opened Checkout.
10. **`billing_events` table is populated** by every subscription/invoice webhook event (one row per Stripe event ID, idempotent on replay).
11. **`GET /api/billing/history`** returns a merged + chronologically-sorted feed of subscription events and wallet ledger entries, paginated.
12. **BillingPage UI redesign rendered with the new card layout:** Plan Card, Plan Picker (when applicable), Usage Card, Wallet Card, Add-ons Card, Billing History. Status pills color-coded. Skeleton loaders during fetch.
13. **"Manage subscription" button** on the Plan Card opens Stripe Customer Portal in the same tab (or new tab — agent's call, document the choice in PR).
14. **All new tests pass; existing test suite still passes.**
15. **PR description includes:**
    - Root cause summary (defects D1–D14).
    - Files changed.
    - Migration notes + backfill verification.
    - Manual Stripe test results (screenshots or copied terminal output of the smoke test above).
    - Confirmation from the `billing-diagnostics.ts` script run against the dev database showing zero outstanding orphans.
    - At least one screenshot of the redesigned BillingPage in both paid and free-user states.

---

## 7. Hard constraints

- Do NOT hardcode live secrets. Use env vars.
- Do NOT expose Stripe secret keys to the frontend.
- Do NOT trust client-submitted `tier` blindly — always cross-validate against `priceId` server-side.
- Do NOT grant entitlement from Clerk `unsafeMetadata` alone. Stripe (or the local row synced from Stripe) is source of truth.
- Do NOT delete or rename `user_subscriptions`, `user_tiers`, `wallet_ledger`, `user_wallets`, or `stripe_webhook_events` — they have RLS policies and existing readers.
- Do NOT remove the `/webhooks/stripe` compatibility alias — production reverse proxies may use it.
- Do NOT silently swallow webhook errors. Record `processing_error` and re-raise so Stripe retries.
- Do NOT introduce new dependencies for the UI redesign — use `lucide-react`, `tailwindcss`, `@tanstack/react-query`, `@clerk/react`, all already in `frontend/package.json`. If a chart library would be useful for the usage progress visuals, hand-roll the bar — adding `recharts` for this is overkill.
- Do NOT collapse `wallet_ledger` into `billing_events`. Two separate tables, merged on read.

---

## 8. Out-of-scope items (file follow-up WOs if needed)

- Webhook replay tool for operators (current process: replay via Stripe Dashboard manually).
- `customer.updated` event handling for email synchronisation.
- Multi-currency support.
- Per-org subscription billing (currently per-user only).
- Real-time billing history updates via SSE/websocket (current: refetch on mutation + on confirm).
- Customer-facing invoice PDF download (Stripe Customer Portal already provides this).

---

## 9. Plan-confirmation checklist (Rule 33)

Before opening the PR for review, reply in the PR thread with this filled in:

- [ ] All 14 defects D1–D14 addressed or explicitly deferred with justification.
- [ ] Three new migrations applied locally (`NN1_backfill_user_tiers.sql`, `NN2_stripe_customers.sql`, `NN3_billing_events.sql`) + verified with `billing-diagnostics.ts`.
- [ ] Stripe CLI smoke test passes for all 7 required event types.
- [ ] Stripe Customer Portal configured in the Stripe Dashboard for both dev and prod accounts (confirm in PR which products/prices are switchable).
- [ ] Manual 100%-coupon Pro purchase test recorded in PR (screenshot or copied output) showing the new "Finalizing your subscription…" banner → Pro status pill → unlocked objectives → unlocked add-ons.
- [ ] Screenshots of the redesigned BillingPage in: (a) free_demo state with Plan Picker visible, (b) pro state with Plan Card hero and history table populated, (c) past_due state showing amber pill, (d) canceled-at-period-end state showing the amber "Cancels on …" chip.
- [ ] New tests written that **fail without the corresponding fix** (Rule 16).
- [ ] BillingPage component decomposed — `BillingPage.tsx` ≤ 150 lines after refactor; each sub-component in `frontend/src/components/billing/` is single-purpose and prop-driven.
- [ ] No `console.log` left in committed code — use the existing `logger`.
- [ ] No hardcoded user IDs, customer IDs, or session IDs in tests — use mocks.
- [ ] Updated `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` with the new env-var requirement AND the Customer Portal configuration step.
- [ ] Updated `.cursor/rules/21-billing-and-webhook-contracts.mdc` to reflect the new contracts including `billing_events` writes and the confirm endpoint.

— end of brief —
