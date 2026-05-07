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

-   **backend/src/services/billing/walletReservations.ts ---
    pre-run wallet reservation/hold primitive. Adds a
    `wallet_holds(id, user_id, run_id, hold_cents, expires_at)`
    table and a transactional `placeHold` that performs the
    SELECT-balance → INSERT-hold under `SELECT FOR UPDATE` (or
    equivalent atomic UPDATE...WHERE balance_cents - reserved_cents
    \>= cost RETURNING). On run completion the orchestrator
    converts the hold into a real ledger debit; on failure or
    expiry it releases the hold. This closes the concurrent-run
    race called out by the PR\#64 review (a wallet user with
    exactly one run\'s balance must not be able to launch two runs
    in parallel and have both pass middleware).**

**Files to modify:**

**backend/src/api/research/runs.ts --- add requireCreditsForRun
middleware AFTER requireTier and BEFORE the run-creation handler. The
middleware (a) computes cost via `computeRunCost`, (b) calls
`placeHold(userId, runId, cost)` on the wallet path before responding
2xx, and (c) sets req.creditChargeContext (which now carries the
holdId, not just the cost).**

**The orchestrator\'s run-completion handler --- consume the hold and
write the ledger debit in a single transaction:**

```ts
// After verifier passes and report is persisted:
const ctx = run.creditChargeContext;

await db.transaction(async (tx) => {
  if (ctx.type === 'wallet') {
    // chargeWallet must consume ctx.holdId atomically so the
    // hold and the ledger row commit together.
    await chargeWallet(tx, userId, ctx.cost, runId, ctx.holdId);
  } else if (ctx.type === 'subscription') {
    await decrementSubscriptionQuota(
      tx,
      userId,
      ctx.subscriptionQuotaToDecrement,
    );
  }
  // 'byok' is no-op
});
```

**The orchestrator\'s run-failure handler --- DO NOT charge for failed
runs. Release the hold (`releaseHold(holdId)`) and log the failure
with stage and error metadata per
.cursor/rules/11-error-paths-and-logging.mdc, but do not deduct
credits.**

**Reservation/hold lifecycle (required, not optional):**

-   **A wallet hold is placed BEFORE any orchestrator work begins.
    `placeHold` and the available-balance check are the same
    transaction; the SQL must be `UPDATE user_wallets SET
    reserved_cents = reserved_cents + $cost WHERE user_id = $u AND
    balance_cents - reserved_cents \>= $cost RETURNING ...` (or
    equivalent SELECT...FOR UPDATE pattern).**
-   **Holds expire (default 30 min) and are reaped by the same daily
    cron that resets monthly tier counters.**
-   **`getAvailableBalance(userId)` returns `balance_cents -
    reserved_cents`. All UI and 402 checks read from this view, not
    from `balance_cents`.**

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
    simultaneously → both holds succeed (\$8 reserved). User with
    \$4 attempts two \$4 runs simultaneously → first hold succeeds,
    second returns 402 BEFORE any orchestrator work begins. No
    interleaving in which both holds succeed.**

**Tests required (must fail without the fix):**

-   **Successful run debits correctly**

-   **Failed run does not debit**

-   **Insufficient balance returns 402 before any orchestrator work**

-   **Concurrent hold placement is race-safe: the test seeds a
    user with \$4 and fires two `placeHold($4)` calls in parallel
    via `Promise.all`; exactly one resolves and one rejects with
    402. (Use the SQL `UPDATE ... WHERE balance_cents -
    reserved_cents \>= $cost RETURNING ...` pattern.)**

-   **Hold-then-charge atomicity: a successful run consumes its
    hold and writes its ledger row in the same DB transaction; a
    crash between hold and ledger leaves the hold to be reaped,
    not a phantom debit.**

-   **Each addon adds correct cost to computeRunCost output**

-   **Tier-disallowed addon returns 403**

-   **Unknown addon key returns 400**

**What not to change.**

-   **Stripe webhook handler**

-   **The orchestrator\'s research logic (only the entry-point
    middleware and completion handler change)**
