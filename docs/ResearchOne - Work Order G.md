**Work Order G --- Tier tables and access enforcement**

**Goal. Implement the tier system per Section 13 of this report. Tier
table, tier middleware, per-tier mode and feature gating.**

**Pre-work --- read first:**

-   **This report Section 13 (tier rules table is the spec)**

-   **Output of Work Order C (users table exists)**

**Files to create:**

-   **backend/src/db/migrations/20260XXX_tier_tables.sql:**

**sql**

**CREATE TABLE user_tiers (**

**user_id text PRIMARY KEY REFERENCES users(user_id),**

**tier text NOT NULL DEFAULT \'free_demo\' CHECK (tier IN (**

**\'anonymous\',\'free_demo\',\'student\',\'wallet\',\'pro\',\'team\',\'byok\',\'sovereign\',\'admin\'**

**)),**

**org_id text,**

**current_period_reports_used integer NOT NULL DEFAULT 0,**

**current_period_deep_reports_used numeric NOT NULL DEFAULT 0,**

**lifetime_reports_used integer NOT NULL DEFAULT 0,**

**current_period_resets_at timestamp,**

**updated_at timestamp NOT NULL DEFAULT now()**

**);**

-   **backend/src/config/tierRules.ts --- exports TIER_RULES const
    object matching Section 13\'s table exactly**

-   **backend/src/middleware/tierEnforcement.ts --- requireTier(check)
    middleware factory**

-   **backend/src/services/tier/tierService.ts --- getUserTier,
    setUserTier, incrementReportCount, resetMonthlyCounters**

-   **backend/src/jobs/tierResetCron.ts --- node-cron scheduled job,
    runs daily UTC midnight, resets monthly counters**

**Files to modify:**

**backend/src/api/research/runs.ts (or equivalent) --- add requireTier({
mode: req.body.mode }) middleware before run-creation logic.**

**Every export endpoint --- add requireTier({ requiresExportFormat:
req.query.format }).**

**backend/src/api/webhooks/clerk.ts --- on user.created, insert default
user_tiers row with tier free_demo.**

**backend/src/api/webhooks/stripe.ts --- on subscription create/update,
set user_tiers.tier to match the plan.**

**Acceptance criteria:**

-   **New user signs up → user_tiers row created with
    tier=\'free_demo\'**

-   **Free demo user attempts investigative mode → 403 with
    upgrade_path: \'/pricing\' in response body**

-   **Free demo user runs 3 reports → 4th attempt returns 403 (lifetime
    cap)**

-   **Pro user attempts any mode → 200**

-   **Pro user has 25 reports remaining → run starts**

-   **Pro user has 0 reports remaining and \$0 wallet → 402 with
    checkout path**

-   **Pro user has 0 reports remaining and \$10 wallet → run starts,
    wallet decremented (after run completes --- that\'s Work Order H)**

-   **Daily cron job resets current_period_reports_used for users whose
    period has rolled over**

**Tests required:**

-   **One test per tier confirming allowed/denied modes (9 tiers × at
    least 1 mode test each)**

-   **Lifetime cap enforcement for free_demo**

-   **Monthly cap enforcement for student and pro**

-   **Cron job correctness: seed users with various
    current_period_resets_at, run cron, verify only past-due users
    reset**

**What not to change.**

-   **Wallet logic (Work Order E/F)**

-   **Credit decrement logic (Work Order H)**
