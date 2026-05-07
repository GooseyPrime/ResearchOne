**Work Order F --- Stripe webhook + ledger**

**Goal. Process Stripe webhooks reliably, idempotently, and securely.
The ledger is the source of truth for wallet state.**

**Pre-work --- read first:**

-   **This report Section 12 (full webhook handler code)**

-   **Stripe docs on webhook signature verification (latest)**

-   **.cursor/rules/14-third-party-api-contracts.mdc**

**Files to create:**

-   **backend/src/api/webhooks/_shared/verifyAndDispatch.ts ---
    Extract the raw-body + signature-scheme + idempotency-key core into
    this shared module. The Stripe handler becomes a 40-line consumer of
    this core. Acceptance: a fake noop provider can be wired in tests in
    \<30 LOC. This is the template for WO-T\'s Parallel Monitor
    webhook.**

-   **backend/src/api/webhooks/stripe.ts --- handler with signature
    verification, idempotency, transactional ledger writes. Full code in
    Section 12.**

**Files to modify:**

**backend/src/index.ts --- mount the Stripe webhook route with
express.raw({ type: \'application/json\' }) BEFORE the global JSON body
parser. This is critical: Stripe\'s signature verification requires the
raw bytes, and a JSON-parsed body fails verification.**

**Order in index.ts:**

**typescript**

**// Stripe webhook route --- raw body, before JSON parser**

**app.post(\'/api/webhooks/stripe\', express.raw({ type:
\'application/json\' }), handleStripeWebhook);**

**// Global JSON parser for all other routes**

**app.use(express.json({ limit: \'10mb\' }));**

**// All other middleware and routes**

**Acceptance criteria:**

-   **Webhook with valid signature for checkout.session.completed
    (top-up) → wallet credited, ledger row written**

-   **Same webhook replayed → idempotency works, no duplicate credit
    (verify via ledger row count)**

-   **Webhook with invalid signature → 400, no DB writes**

-   **Webhook for customer.subscription.created → user_subscriptions row
    inserted, user_tiers.tier updated to match**

-   **Webhook for customer.subscription.deleted → tier downgraded at
    current_period_end (handled by daily cron, not immediate)**

-   **Webhook for invoice.payment_failed → user notified via email (out
    of scope here; flag the event in DB for later notification work)**

-   **Webhook delivery failure (return 500) → Stripe retries; on next
    retry, idempotency prevents duplicate processing**

**Tests required (must fail without the fix):**

-   **backend/\_\_tests\_\_/webhooks/stripe.signature.test.ts ---
    invalid signature returns 400**

-   **backend/\_\_tests\_\_/webhooks/stripe.idempotency.test.ts ---
    replay same event, verify single ledger row**

-   **backend/\_\_tests\_\_/webhooks/stripe.checkout-completed.test.ts
    --- wallet credited correctly with metadata**

-   **backend/\_\_tests\_\_/webhooks/stripe.subscription-created.test.ts
    --- tier updated correctly**

**What not to change.**

-   **The credit decrement flow (Work Order H)**

-   **Any non-billing routes**

**Critical reminder. Do NOT log webhook payload contents in plaintext to
logs that might be queried by support --- they contain Stripe customer
details. Log event IDs and event types only; payload is in
stripe_webhook_events.payload jsonb for debugging and is RLS-restricted
to admin role.**
