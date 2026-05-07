**Work Order N --- Admin dashboard**

**Goal. Build the admin UI for user lookup, wallet adjustment, tier
override, run telemetry, and audit log query.**

**Pre-work --- read first:**

-   **This report Section 10 (admin dashboard specs)**

-   **All previous work orders (you\'ll be reading data they wrote)**

**Files to create:**

**Frontend:**

-   **frontend/src/pages/admin/AdminDashboard.tsx**

-   **frontend/src/pages/admin/UserLookup.tsx**

-   **frontend/src/pages/admin/WalletAdjustment.tsx**

-   **frontend/src/pages/admin/TierOverride.tsx**

-   **frontend/src/pages/admin/RunTelemetry.tsx**

-   **frontend/src/pages/admin/AuditLogViewer.tsx**

-   **frontend/src/pages/admin/MonitorsAdmin.tsx --- org-level view of
    report monitors**

-   **frontend/src/pages/admin/AdversarialTwinQueue.tsx --- queue view
    for adversarial twin runs**

-   **frontend/src/pages/admin/PolicyOneScoreApiKeys.tsx --- manage
    PolicyOne Score API keys**

-   **frontend/src/pages/admin/ContradictionHeatmap.tsx --- org-level
    contradiction heatmap view**

**Backend:**

-   **backend/src/api/admin/users.ts --- GET
    /api/admin/users?email=\..., GET /api/admin/users/:id**

-   **backend/src/api/admin/wallet.ts --- POST
    /api/admin/users/:id/wallet-adjust with reason field (logged to
    ledger as admin_adjustment)**

-   **backend/src/api/admin/tier.ts --- POST
    /api/admin/users/:id/tier-override with reason**

-   **backend/src/api/admin/telemetry.ts --- run statistics by mode, by
    tier, by date range**

-   **backend/src/api/admin/audit.ts --- GET /api/admin/audit-log with
    filters**

-   **backend/src/api/admin/monitors/ --- endpoints for report monitors
    admin**

-   **backend/src/api/admin/twin/ --- endpoints for adversarial twin
    queue admin**

-   **backend/src/api/admin/policyone-api-keys/ --- endpoints for
    PolicyOne Score API key management**

-   **backend/src/api/admin/contradictions/ --- endpoints for
    contradiction heatmap data**

**All admin endpoints gated by requireAdmin middleware.**

**Acceptance criteria:**

-   **Admin can search users by email**

-   **Admin can credit/debit a wallet with a logged reason**

-   **Admin can override a user\'s tier (e.g., comp a journalist with
    Pro access)**

-   **Run telemetry shows runs/day, mode mix, success/failure rates,
    average runtime**

-   **Audit log is searchable by user, event type, date range**

-   **Non-admin gets 403 on every admin endpoint**

-   **Every admin action writes a row to ingestion_audit_log (or a
    separate admin_actions log) with the admin\'s user ID, target user
    ID, action, reason, timestamp**

**Tests required:**

-   **Non-admin user gets 403**

-   **Admin action writes audit row**

-   **Wallet adjustment is transactional (balance updated + ledger row
    written atomically)**

**What not to change.**

-   **User-facing routes**

-   **Research engine**
