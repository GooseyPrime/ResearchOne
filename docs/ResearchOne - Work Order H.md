**Work Order H --- Research-run credit enforcement**

**Goal. Enforce credit availability before research runs and decrement
after successful runs. Per Section 12 (Credit decrement section) and
Section 13.**

**Pre-work --- read first:**

-   **This report Section 12 (credit decrement flow)**

-   **This report Section 13 (tier rules)**

-   **backend/src/services/agents/orchestrator.ts (or equivalent --- the
    run lifecycle)**

**Files to create:**

-   **backend/src/middleware/creditEnforcement.ts ---
    Replace requireCreditsForRun flat-cost logic with
    computeRunCost(tier, mode, addons). Validate each requested addon
    against tier eligibility before pricing. Reject unknown addons with
    400. Reject tier-disallowed addons with 403.**

**Files to modify:**

**backend/src/api/research/runs.ts --- add requireCreditsForRun
middleware AFTER requireTier and BEFORE the run-creation handler. The
middleware sets req.creditChargeContext.**

**The orchestrator\'s run-completion handler --- add the credit
decrement logic at the end of a successful run:**

**typescript**

**// After verifier passes and report is persisted:**

**const ctx = run.creditChargeContext;**

**await db.transaction(async (tx) =\> {**

**if (ctx.type === \'wallet\') {**

**await chargeWallet(tx, userId, ctx.cost, runId);**

**} else if (ctx.type === \'subscription\') {**

**await decrementSubscriptionQuota(tx, userId,
ctx.subscriptionQuotaToDecrement);**

**}**

**// \'byok\' is no-op**

**});**

**The orchestrator\'s run-failure handler --- DO NOT charge for failed
runs. Per .cursor/rules/11-error-paths-and-logging.mdc, log the failure
with stage and error metadata, but do not deduct credits.**

**Acceptance criteria:**

-   **Pro user with subscription quota remaining starts run → quota
    decrements only on successful completion**

-   **Wallet user with \$10 starts \$4 Standard run → run completes →
    wallet shows \$6 with ledger row**

-   **Wallet user with \$10 starts \$4 Standard run → run fails → wallet
    still \$10, no ledger row**

-   **BYOK user starts run → no platform credit charge regardless of
    outcome**

-   **Wallet user with \$0 starts run → 402 returned, no orchestrator
    work begins**

-   **Concurrent run attempts: user with \$10 starts two \$4 runs
    simultaneously → second attempt either queues or returns 402 (race
    condition handled correctly)**

**Tests required (must fail without the fix):**

-   **Successful run debits correctly**

-   **Failed run does not debit**

-   **Insufficient balance returns 402 before any orchestrator work**

-   **Concurrent decrement is race-safe (use SQL UPDATE \... WHERE
    balance_cents \>= \$1 RETURNING \... pattern)**

-   **Each addon adds correct cost to computeRunCost output**

-   **Tier-disallowed addon returns 403**

-   **Unknown addon key returns 400**

**What not to change.**

-   **Stripe webhook handler**

-   **The orchestrator\'s research logic (only the entry-point
    middleware and completion handler change)**
