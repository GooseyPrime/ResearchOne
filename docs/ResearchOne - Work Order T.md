# Work Order T — Living Reports Infrastructure

**Goal.** Build the Parallel Monitor integration that turns published reports into continuously-updating intelligence products. When a published report is "watched," the system registers a Parallel Monitor query against that report's `falsification_criteria` and key sources; Parallel sends a webhook on web-state change; the existing post-publication revision pipeline (Revision Intake → Change Planner → Section Rewriter → Citation Integrity Checker → Final Revision Verifier) is triggered automatically; the user is notified of the new revision. This is the highest-margin recurring revenue line in the new pricing model. It depends on Stripe billing being live (the subscription product was created in WO-E's bootstrap) and the WO-M epistemic-friction prompt updates being merged (so revisions reason about contrasting/retracted sources correctly).

**Pre-work.** WO-E (`stripe-bootstrap.ts` script — `STRIPE_PRICE_ID_LIVING_REPORT_MONTHLY` and `STRIPE_PRICE_ID_REVERSE_CITATION_WATCH_MONTHLY` must already be provisioned). WO-F (Stripe webhook handler — the `verifyAndDispatchWebhook` core extracted in the WO-F patch is reused here). WO-G (tier rules — `living_reports_quota` and `reverse_citation_watch_quota` rows must exist). WO-K (RLS — `report_monitors` and `report_monitor_events` tables must be in the RLS migration list). WO-M (epistemic-friction prompt updates merged — revisions auto-triggered by Parallel Monitor must use the same prompt discipline as user-initiated revisions). `.cursor/rules/14-third-party-api-contracts.mdc`, `.cursor/rules/10-state-machine-and-multi-writer.mdc` (revision lifecycle is a state machine with concurrent writers — webhook + manual revision can race), `.cursor/rules/16-tests-must-fail-without-the-fix.mdc`. Existing files: `backend/src/services/reasoning/reportRevisionService.ts` (revision pipeline entry point), `backend/src/api/webhooks/stripe.ts` (webhook discipline template, after WO-F refactor), `backend/src/db/migrations/004_report_revisions_and_model_policy.sql` (revision schema). Confirm Parallel Monitor API contract at https://parallel.ai/docs — record exact webhook payload shape and signature scheme in JSDoc on the handler.

**Dependencies.**
```bash
# All required deps already present (axios, pg, bullmq, ioredis, zod, stripe).
# No new packages.
```

**Files to create.**

Schema migration `backend/src/db/migrations/018_report_monitors.sql`:

```sql
CREATE TABLE report_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  monitor_kind TEXT NOT NULL CHECK (monitor_kind IN ('living_report', 'reverse_citation_watch')),
  parallel_monitor_id TEXT NOT NULL,
  query_def JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled', 'failed')),
  stripe_subscription_id TEXT,
  stripe_subscription_item_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  last_revision_id UUID REFERENCES report_revisions(id),
  UNIQUE (report_id, monitor_kind)  -- one Living Report and one Reverse-Citation Watch per report
);

CREATE INDEX idx_report_monitors_user_id ON report_monitors(user_id);
CREATE INDEX idx_report_monitors_org_id ON report_monitors(org_id);
CREATE INDEX idx_report_monitors_status ON report_monitors(status) WHERE status = 'active';
CREATE INDEX idx_report_monitors_parallel_id ON report_monitors(parallel_monitor_id);

CREATE TABLE report_monitor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES report_monitors(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL
    CHECK (event_kind IN ('webhook_received', 'webhook_replayed', 'webhook_invalid_signature',
                          'revision_enqueued', 'revision_completed', 'revision_failed',
                          'monitor_paused', 'monitor_resumed', 'monitor_cancelled',
                          'subscription_active', 'subscription_past_due', 'subscription_cancelled')),
  webhook_event_id TEXT,  -- Parallel's event id, for idempotency
  payload JSONB,
  revision_id UUID REFERENCES report_revisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only audit log
CREATE INDEX idx_report_monitor_events_monitor_id ON report_monitor_events(monitor_id, created_at DESC);
CREATE UNIQUE INDEX idx_report_monitor_events_webhook_idempotency
  ON report_monitor_events(webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;
```

Service:

- `backend/src/services/monitoring/parallelMonitorService.ts` — Five exported functions:
  - `registerMonitor({ reportId, userId, orgId, monitorKind, stripeSubscriptionId })`: pulls report's `falsification_criteria` and top-N citations from the DB, constructs Parallel Monitor query body, POSTs to Parallel API, inserts row in `report_monitors`. Returns `{ monitorId, parallelMonitorId, status }`. **Idempotent on `(reportId, monitorKind)`** — re-call with same arguments returns existing monitor without duplicate Parallel registration.
  - `pauseMonitor(monitorId, userId)`: PATCHes Parallel to disable, updates row to `paused`. Auth check: caller must be the monitor's user or in the monitor's org.
  - `resumeMonitor(monitorId, userId)`: inverse.
  - `cancelMonitor(monitorId, userId, reason)`: DELETEs the Parallel monitor, updates row to `cancelled`. Triggered by user, by Stripe `subscription.deleted`, or by report deletion.
  - `handleParallelEvent(monitorId, payload)`: invoked by webhook handler. Enqueues revision via existing `reportRevisionService.requestRevision()`, writes `revision_enqueued` event, updates `last_event_at` and (after revision completes) `last_revision_id`.

Webhook:

- `backend/src/api/webhooks/parallel.ts` — Express handler with raw-body signature verification using the same `verifyAndDispatchWebhook` core that WO-F's refactor extracted. Signature scheme: HMAC-SHA256 of raw body with `PARALLEL_MONITOR_WEBHOOK_SECRET`, header `X-Parallel-Signature`. Idempotency: insert `webhook_event_id` into `report_monitor_events` with the unique partial index from the migration; on conflict, return 200 with `{replayed: true}` and skip processing. Returns 200 on successful enqueue, 400 on signature failure (logged, no DB writes), 500 on internal error so Parallel retries.

Routes:

- `backend/src/api/monitors.ts` — Five endpoints, all behind `requireAuth` middleware (from WO-C):
  - `POST /api/reports/:id/monitors` — body `{ monitorKind: 'living_report' | 'reverse_citation_watch' }`. Verifies caller owns or has org access to report. Triggers Stripe Checkout for a new subscription with the appropriate `STRIPE_PRICE_ID_LIVING_REPORT_MONTHLY` (or reverse-citation) — returns Checkout URL. After Stripe webhook fires `subscription.created` (handled in WO-F), the existing webhook handler calls `parallelMonitorService.registerMonitor()`. **No direct write to `report_monitors` from the API route** — the Stripe webhook is the source of truth that the subscription is paid.
  - `GET /api/reports/:id/monitors` — list active monitors for this report.
  - `POST /api/monitors/:monitorId/pause` — manual pause.
  - `POST /api/monitors/:monitorId/resume` — manual resume.
  - `DELETE /api/monitors/:monitorId` — cancels monitor AND cancels Stripe subscription.

Worker (BullMQ):

- `backend/src/queue/workers/livingReportRevisionWorker.ts` — Consumes `living_report_revision` queue jobs enqueued by `handleParallelEvent`. Calls `reportRevisionService.runRevisionPipeline(revisionRequestId)` (existing service). On completion, writes `revision_completed` event row, updates `report_monitors.last_revision_id`, emits `revision:completed` socket event so the user's UI updates in real time.

Frontend:

- `frontend/src/components/reports/MonitorToggle.tsx` — Component shown on `ReportDetailPage.tsx` for published reports. Two tabs: "Watch this report" (Living Report) and "Watch the citations" (Reverse-Citation Watch). Each tab shows: status (not subscribed / active / paused / cancelled), price ($99/mo or $29/mo), subscribe/manage buttons. Subscribe button hits `POST /api/reports/:id/monitors`, redirects to Stripe Checkout. Manage button opens Stripe Customer Portal via existing billing route.
- `frontend/src/components/reports/MonitorEventsPanel.tsx` — Optional collapsible panel below the report. Shows last 10 events for the monitor (revision timestamps, what changed, link to compare versions). Driven by socket subscription on `monitor:events` channel, scoped to monitors visible to the user.
- `frontend/src/pages/MonitorsPage.tsx` — `/monitors` route. Lists all of the user's (or org's) active monitors with quick actions. Useful for prosumers running 5+ monitors who don't want to navigate per-report.

Tests:

- `backend/src/services/monitoring/__tests__/parallelMonitorService.test.ts`
- `backend/src/api/webhooks/__tests__/parallel.test.ts`
- `backend/src/api/__tests__/monitors.test.ts`
- `backend/src/queue/workers/__tests__/livingReportRevisionWorker.test.ts`

**Files to modify.**

`backend/src/services/reasoning/reportRevisionService.ts` — Add `triggeredBy: 'user' | 'parallel_monitor' | 'reverse_citation_watch'` to revision metadata (passed through to `report_revisions.metadata`). Required for downstream reporting and so the user's UI can label the source of the revision. **Do NOT branch the revision pipeline on this field.** All revisions go through the same Revision Intake → Change Planner → Section Rewriter → Citation Integrity → Final Verifier sequence regardless of trigger. Per Cursor rule 20, every revision honors the same epistemic policy.

`backend/src/api/webhooks/stripe.ts` — Add handlers for the new subscription products. On `customer.subscription.created` for `STRIPE_PRICE_ID_LIVING_REPORT_MONTHLY` or `_REVERSE_CITATION_WATCH_MONTHLY`: invoke `parallelMonitorService.registerMonitor()` with the report ID from `subscription.metadata.report_id` (set when Checkout session was created). On `customer.subscription.deleted` for these products: invoke `parallelMonitorService.cancelMonitor()`. On `invoice.payment_failed`: write `subscription_past_due` event row, **but do NOT pause the monitor immediately** — let Stripe's dunning handle it; cancel only on the `subscription.deleted` event. This is the Section 12 precedent — revenue collection lifecycle stays on Stripe's clock.

`backend/src/index.ts` — Mount `/api/webhooks/parallel-monitor` route with `express.raw({ type: 'application/json' })` BEFORE the global JSON parser, mirroring the Stripe webhook mount. Mount `/api/monitors` and `/api/reports/:id/monitors` after auth middleware. Register the new BullMQ worker.

`backend/src/queue/queues.ts` — Add `living_report_revision` queue definition.

`frontend/src/pages/ReportDetailPage.tsx` — Render `<MonitorToggle reportId={report.id} status={report.status} />` for reports where `status === 'published'`. Hide for draft and revised-in-flight reports.

`frontend/src/App.tsx` — Add `/monitors` route → `MonitorsPage`.

`backend/.env.production.example` — append:

```
PARALLEL_MONITOR_WEBHOOK_SECRET=
PARALLEL_BASE_URL=https://api.parallel.ai/v1
```

**Acceptance criteria.**

- User on Pro tier visits a published report → clicks "Watch this report" → Stripe Checkout opens → completes payment → returns to report → toggle shows "Active" status within 30 seconds. Backend state: row in `report_monitors` with `status='active'`, `parallel_monitor_id` set, `stripe_subscription_id` set; row in `report_monitor_events` with `event_kind='subscription_active'`.
- Parallel sends a webhook for an active monitor → backend verifies signature → enqueues revision job → revision pipeline runs → user sees revised report → monitor's `last_revision_id` updates → socket event `revision:completed` received in user's UI. End-to-end <90 seconds for a small revision.
- Parallel replays the same webhook (same `event_id`) → second invocation returns 200 with `{replayed: true}` → no second revision is enqueued. **Confirmed via DB: `report_monitor_events` row count for that `event_id` is exactly 1.**
- Parallel sends a webhook with invalid signature → 400 returned → no DB writes → log entry recorded.
- User cancels their Living Report subscription via Stripe Customer Portal → Stripe sends `subscription.deleted` → backend cancels Parallel monitor → row updates to `status='cancelled'` → user's UI toggle shows "Cancelled" → no further webhook events trigger revisions.
- User deletes the underlying report → cascade deletes `report_monitors` row → cancels Parallel monitor → cancels Stripe subscription. **All three side effects happen atomically** or with compensating cleanup; no orphan Parallel monitors and no orphan Stripe subscriptions.
- Pro tier user attempts to subscribe to a Living Report on a report belonging to another user (no org-level share) → 403 from `POST /api/reports/:id/monitors`.
- Free Demo user attempts to subscribe → 403 from tier middleware (per WO-G), upgrade path returned.
- Team tier user has 5 included Living Reports (per `tier_addons` row) → first 5 subscribe at $0 (Stripe Checkout still required to capture payment method, but unit price is $0) → 6th opens Checkout at $99/mo. **Quota tracking happens in WO-G's `tierService`** and is consulted before Checkout URL is generated.
- Sovereign tier: monitors run against the customer's dedicated Parallel sub-account if `DEPLOYMENT_MODE=sovereign` (see WO-J — Parallel client uses customer-supplied key from BYOK vault); no events leak to the shared B2C runtime.
- Health check `/api/health/ready` returns `parallel: { ok: true }` when Parallel API is reachable; `degraded` when not.

**Tests required (must fail without the fix).**

- `parallelMonitorService.test.ts` — `registerMonitor` is idempotent on `(reportId, monitorKind)`: calling twice with same args returns existing monitor row, calls Parallel API exactly once. **Must fail if duplicate row inserted or duplicate Parallel call made.**
- `parallel.test.ts` (webhook) — three scenarios: valid signature → 200 + revision enqueued; invalid signature → 400 + zero DB writes (asserted by querying both `report_monitor_events` and `report_revision_requests` row counts); replayed valid event → 200 + zero new DB writes (idempotency unique index honored). **Must fail if signature verification is bypassed, idempotency unique index missing, or signature verification done on parsed JSON instead of raw body.**
- `monitors.test.ts` (API) — auth: anon caller → 401; cross-user caller → 403; valid caller → 200. Free Demo tier → 403 with upgrade path. **Must fail if any tier check is missing.**
- `livingReportRevisionWorker.test.ts` — given an enqueued revision job, calls `reportRevisionService.runRevisionPipeline` exactly once. On pipeline failure, writes `revision_failed` event and does NOT retry indefinitely (max 3 attempts via BullMQ config). **Must fail if pipeline gets called twice or retries unbounded.**
- Integration test `report_monitor_lifecycle.test.ts` — full end-to-end with mocks for Stripe and Parallel: Checkout completes → registerMonitor called → webhook arrives → revision runs → user gets notified → user cancels → Parallel cancelled → Stripe cancelled → row in cancelled state. **Must fail if any step in the lifecycle doesn't write its corresponding event row.**
- Regression test `revision_via_monitor_uses_same_prompts.test.ts` — runs a monitor-triggered revision and a user-triggered revision against the same report state and asserts the same agent prompts are invoked (verified via prompt-spy). **Must fail if any code path uses a different prompt for monitor-triggered revisions.** This is the WO-M epistemic-friction guarantee captured in code: monitor-triggered revisions cannot bypass PolicyOne discipline.

**Critical reminders.**

1. **Stripe is the source of truth for "is this monitor paid for."** The route `POST /api/reports/:id/monitors` does NOT write to `report_monitors` directly — it returns a Checkout URL. Only the Stripe webhook handler (after `subscription.created` fires) creates the `report_monitors` row by calling `registerMonitor`. This is the same discipline as WO-E's wallet credit logic: never trust client-side claims of payment.
2. **The Parallel webhook must use the WO-F generalized webhook discipline.** Reuse `verifyAndDispatchWebhook` from `backend/src/api/webhooks/_shared/`. Do not duplicate signature-verification or idempotency code. Per Cursor rule 17, this is a deliberate dependency on WO-F's refactor; running this WO before WO-F's webhook generalization is merged means re-implementing the same security-critical primitive twice.
3. **Never auto-pause on `invoice.payment_failed`.** Stripe's dunning runs for 3 retries before issuing `subscription.deleted`. Pausing a monitor on first failure would lose ~7 days of revisions a user is still entitled to receive while their card is being retried.
4. **Revisions auto-triggered by monitors honor the same PolicyOne epistemic discipline as user-triggered revisions.** This is enforced both by WO-M's preambles (which apply to all revisions) and by the regression test in this WO. Per Cursor rule 20, no revision pipeline path may bypass the Skeptic stage based on the trigger source. **Monitor-triggered revisions are NOT a backdoor for cheaper or faster revisions; they are the same revision pipeline running automatically.**
5. **Sovereign deployments do not share monitors.** When `DEPLOYMENT_MODE=sovereign`, Parallel API calls use the customer's BYOK Parallel key (from WO-I's generalized key vault). Monitor data never crosses the shared B2C runtime, satisfying the Sovereign opt-out contractually enforced in WO-J. Acceptance test: in a sovereign-config test, assert the Parallel API client used the BYOK key, not the platform key.
6. **Reverse-Citation Watch is a thinner monitor variant.** It uses the same infrastructure but its query def is "watch the citation graph of these specific DOIs" rather than "watch the open web for these falsification criteria." The Parallel API endpoint may be the same with a narrower query body — confirm against Parallel's docs at implementation time. From the schema's perspective, it's just a different `monitor_kind` value.
7. **Notification UX is socket-driven, not polling-driven.** When a revision completes, emit `revision:completed` on the existing socket channel; the frontend listens and updates the panel. Do not poll. This matches the existing research-run socket discipline in `researchOrchestrator.ts`.

**Effort estimate.** 5 days for one engineer. Schema + service layer + webhook is 2 days. API routes + Stripe-handler additions + worker is 1 day. Frontend (`MonitorToggle`, `MonitorsPage`, socket integration) is 1 day. Tests and end-to-end integration is 1 day. Add 0.5–1 day for the first real-world Parallel webhook smoke test (network/timing variability).

**Sequencing.** Post-launch, month 2. Hard dependencies: WO-E (Stripe products provisioned by `stripe-bootstrap.ts`), WO-F (webhook discipline + Stripe handler with subscription event handlers), WO-G (tier rules table including new quota fields), WO-K (RLS on the new tables — added to WO-K's RLS migration list per the WO-K patch in the previous response), WO-M (epistemic-friction prompt updates merged so monitor-triggered revisions use the right prompts). Soft dependency: WO-S (the `parallelMonitorService` may share an HTTP client with `parallelSearch.ts` — refactor opportunity, not a blocker).
