**Work Order E --- Stripe wallet + checkout**

**Goal. Wire Stripe Checkout for wallet top-ups and subscription tiers.
Per Section 12 of this report.**

**Pre-work --- read first:**

-   **This report Section 12 (full implementation plan)**

-   **This report Section 4 (pricing table --- the tier prices)**

-   **Stripe docs for Checkout Sessions and Subscriptions (verify
    current API)**

**Stripe dashboard setup (manual, document the steps):**

-   **Create Stripe products: ResearchOne Student, Pro, Team Seat, BYOK,
    Wallet Top-up**

-   **Create prices for each: monthly + annual for subscriptions;
    \$20/\$50/\$100 for top-ups**

-   **Configure webhook endpoint:
    https://api.researchone.io/api/webhooks/stripe**

-   **Subscribe to events: checkout.session.completed,
    customer.subscription.created, customer.subscription.updated,
    customer.subscription.deleted, invoice.payment_failed,
    charge.refunded**

-   **Capture STRIPE_WEBHOOK_SECRET and all STRIPE_PRICE_ID\_\* values**

**Dependencies:**

**cd backend && npm install stripe@\^17**

**cd ../frontend && npm install \@stripe/stripe-js@\^4**

**Environment variables (Section 12 lists all of them): add to
.env.example files.**

**Files to create:**

**Backend:**

-   **backend/src/db/migrations/20260XXX_billing_tables.sql ---
    user_wallets, wallet_ledger, user_subscriptions,
    stripe_webhook_events. Schema in Section 12.**

-   **backend/src/services/billing/stripeClient.ts --- Stripe SDK
    wrapper**

-   **backend/src/services/billing/walletService.ts --- getBalance,
    creditWallet, debitWallet (transactional, idempotent)**

-   **backend/src/services/billing/subscriptionService.ts ---
    syncSubscription, markSubscriptionCanceled, getSubscriptionForUser**

-   **backend/src/api/billing/checkout.ts --- POST
    /api/billing/checkout**

-   **backend/src/api/billing/wallet.ts --- GET /api/billing/wallet, GET
    /api/billing/transactions**

-   **backend/src/api/billing/subscription.ts --- GET
    /api/billing/subscription, POST /api/billing/cancel-subscription**

**Frontend:**

-   **frontend/src/pages/BillingPage.tsx --- wallet balance, top-up
    buttons, subscription status, transaction history**

-   **frontend/src/lib/billing/checkout.ts --- initiates Stripe Checkout
    redirect**

**Acceptance criteria:**

-   **User can click \"Top up \$20\" → Stripe Checkout opens → payment
    completes → wallet shows \$20.00**

-   **User can subscribe to Pro → Stripe Checkout → subscription active
    → tier in DB updated to pro**

-   **Transaction history shows the top-up with timestamp, amount,
    balance after**

-   **Subscription cancellation sets cancel_at_period_end=true; user
    retains access until period end**

**Tests required:**

-   **backend/\_\_tests\_\_/billing/walletService.test.ts --- credit,
    debit, idempotency (calling credit twice with same key yields one
    ledger row)**

-   **backend/\_\_tests\_\_/billing/walletService.transaction.test.ts
    --- atomicity (force a failure mid-transaction, verify rollback)**

-   **Tests must fail if idempotency check is removed**

**What not to change.**

-   **Webhook handler --- that\'s Work Order F**

-   **Credit decrement on research runs --- that\'s Work Order H**

-   **Auth middleware**
