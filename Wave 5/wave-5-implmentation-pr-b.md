# Wave 5.0 Implementation — Cursor Agent Work Order (PR-B)

You are working on the GooseyPrime/ResearchOne monorepo. This PR
implements the Wave 5.0 Dossier data model contract defined in
`docs/wave-5-0-dossier-data-model-scope.md` (merged in PR-A) and
governed by Rule 32 (`.cursor/rules/32-dossier-canonical-read-path.mdc`).

## Standing instruction (in effect for the entire work order)

On any rule conflict, stop. Quote the rule by ID and line. State
the discrepancy. Ask for (a) founder override, (b) rule amendment,
or (c) defer. Wait for the founder reply. No silent deferral. Do
not proceed past a conflict on your own judgment.

## Mandatory pre-read

Before touching any file, read these in full:

1. `docs/wave-5-0-dossier-data-model-scope.md` — the contract this
   PR executes.
2. `.cursor/rules/32-dossier-canonical-read-path.mdc` — Rule 32
   discipline. v_dossier is the canonical read path for all
   dossier surfaces.
3. `.cursor/rules/20-research-policy-guardrails.mdc` — immutability
   fence. Do not approach.
4. `.cursor/rules/10-state-machine-and-multi-writer.mdc` — state
   machine remains unmodified in Wave 5.0.
5. `.cursor/rules/13-deploy-skew-and-schema.mdc` — schema/deploy
   ordering. Migration deploys before frontend ships.
6. `.cursor/rules/24-canonical-path-after-mutation.mdc` — Rule 24
   discipline mirrored by Rule 32.
7. `.cursor/rules/29-marketing-scope-doc-contracts.mdc` — scope-
   doc parity. PR-B must not exceed PR-A inventory.
8. `.cursor/rules/30-vercel-prerender-spa-routing.mdc` — sitemap
   and catch-all alignment.
9. `.cursor/rules/31-evidence-vs-source-vocabulary.mdc` —
   vocabulary discipline applies to all new copy.
10. `backend/src/db/migrations/001_initial_schema.sql` —
    research_runs and reports tables.
11. `backend/src/db/migrations/021_rls_setup.sql` and
    `022_rls_policies.sql` — RLS pattern to mirror.
12. `backend/src/db/pool.ts` and `backend/src/db/migrate.ts` —
    migration mechanism.
13. `backend/src/api/routes/` — existing route patterns. Mirror the
    shape of the existing routes for auth, validation, and error
    handling.

## Hard fence — do not touch

- `backend/src/constants/prompts.ts`
- `backend/src/services/reasoning/reasoningModelPolicy.ts`
- `backend/src/services/reasoning/researchOrchestrator.ts` (Wave
  5.1 will modify; not this wave)
- Any V2 model defaults, agent prompts, retrieval logic, ranking
  logic
- The five backend tier identifier strings as identifiers
- `frontend/tailwind.config.js` tier color tokens
- `frontend/src/index.css` `.badge-*` tier classes
- `frontend/src/components/landing/visual/pipelineLayout.ts`
- Existing report state-machine logic in
  `backend/src/services/reasoning/runStateMachine.ts`

If you find yourself about to edit any of the above, STOP and
apply the standing instruction.

## Deliverables for PR-B

Eight logical commits, in this order. Conventional Commits format.

---

### Commit 1 — `feat(db): add dossier data model migration 034`

File: `backend/src/db/migrations/034_dossier_data_model.sql`

Migration contents per the scope doc. Specifically:

1. `CREATE TABLE research_plans` with all columns, CHECK
   constraint, indexes, unique partial index, and trigger.
2. `CREATE TABLE plan_revisions` with all columns and indexes.
3. `CREATE TABLE dossier_statistics` with all columns.
4. `CREATE OR REPLACE VIEW v_dossier` per the scope doc.
5. RLS enablement and policies for all three tables, mirroring
   `022_rls_policies.sql` patterns for `research_runs`.
6. Idempotent back-fill:

```sql
   -- Back-fill legacy plans for every existing run
   INSERT INTO research_plans (run_id, org_id, user_id, status,
                               intent, plan_payload, plan_summary,
                               confirmed_at, created_at)
   SELECT rr.id, rr.org_id, rr.user_id, 'legacy', 'legacy',
          '{}'::jsonb, NULL, rr.completed_at, rr.created_at
   FROM research_runs rr
   WHERE NOT EXISTS (
     SELECT 1 FROM research_plans rp WHERE rp.run_id = rr.id
   );

   -- Back-fill dossier_statistics best-effort from existing data
   INSERT INTO dossier_statistics (run_id, total_duration_ms,
                                   refinement_rounds, computed_at)
   SELECT rr.id,
          EXTRACT(EPOCH FROM (rr.completed_at - rr.created_at))*1000,
          0,
          NOW()
   FROM research_runs rr
   WHERE rr.completed_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM dossier_statistics ds WHERE ds.run_id = rr.id
     );
```

   Token counts, source counts, and per-stage durations remain
   NULL for legacy runs where the data is not retrievable from
   existing tables. Do NOT fabricate values.

7. Reversibility: include a commented-out `DOWN` block at the
   bottom of the migration file with `DROP VIEW`, `DROP TABLE`
   statements in reverse dependency order. Keep it commented per
   existing migration conventions; if no convention exists, ask.

Run `npm run migrate` against a fresh database with seed data and
confirm clean apply. Run again to confirm idempotency.

---

### Commit 2 — `feat(api): add dossier read routes and v_dossier service`

New service:
`backend/src/services/research/dossierReadService.ts`

This service is the ONLY backend module that issues SELECT queries
against the dossier surface. Per Rule 32, all reads go through
v_dossier. No route handler builds dossier objects by joining
research_runs, reports, research_plans, and dossier_statistics
directly. Service exports:

- `getDossierById(dossierId: string, ctx: AuthContext): Promise<Dossier | null>`
- `listDossiers(filters: DossierListFilters, ctx: AuthContext): Promise<DossierListResult>`
- `getDossierRequest(dossierId: string, ctx: AuthContext): Promise<DossierRequest | null>`
- `getDossierPlan(dossierId: string, ctx: AuthContext): Promise<DossierPlan | null>`
- `getDossierReportLink(dossierId: string, ctx: AuthContext): Promise<{ reportId: string } | null>`
- `getDossierStats(dossierId: string, ctx: AuthContext): Promise<DossierStats | null>`

All queries:
- Select from `v_dossier` (not from underlying tables).
- Apply RLS context (org_id, user_id) via the existing auth
  middleware pattern.
- Use parameterized queries via the existing `query` /
  `queryOne` helpers from `backend/src/db/pool.ts`.

New route file:
`backend/src/api/routes/dossiers.ts`

Routes per scope doc:
- `GET /api/dossiers` — list with pagination (page, pageSize,
  intent filter, status filter, dateFrom, dateTo).
- `GET /api/dossiers/:id` — full four-section response.
- `GET /api/dossiers/:id/request`
- `GET /api/dossiers/:id/plan`
- `GET /api/dossiers/:id/report` — returns the linked report's
  metadata + `reportId`. The report body is still fetched via
  the existing `/api/reports/:id` endpoint to avoid duplicating
  the report-rendering surface.
- `GET /api/dossiers/:id/stats`

All routes:
- Validate `:id` as UUID via existing express-validator pattern.
- 404 when the dossier is not visible to the auth context (do not
  leak existence).
- Return shapes match the TypeScript interfaces defined in the
  service module.
- Mirror the error-handling and logging patterns of existing
  routes in `backend/src/api/routes/`.

Register the new router in the existing router-registration site
(typically `backend/src/api/index.ts` or similar — locate it via
how `reports` routes are registered).

New types file:
`backend/src/types/dossier.ts`

Exported interfaces:
- `Dossier` — the full four-section payload
- `DossierRequest`, `DossierPlan`, `DossierStats`,
  `DossierReportLink`
- `DossierListFilters`, `DossierListResult`
- `DossierStatus`, `PlanStatus`, `Intent` (Wave 5.0: `'legacy'`
  only; Wave 5.1 will expand)

Zod schemas:
- Add `backend/src/schemas/dossierSchemas.ts` with request-body
  and response-body schemas. Validate at route boundaries.

Tests:
- `backend/src/api/routes/__tests__/dossiers.test.ts`
  - GET /api/dossiers returns paginated results scoped to auth.
  - GET /api/dossiers/:id returns four sections.
  - GET /api/dossiers/:id returns 404 when not visible to auth
    context (different org).
  - Legacy plans render as `intent: 'legacy'` with empty
    plan_payload.
  - All read queries verified to use v_dossier (grep test:
    assert no route handler imports the underlying tables
    directly).

---

### Commit 3 — `feat(frontend): add dossier routes, list page, and detail page`

Routing:
- `frontend/src/main.tsx` (or wherever the router is configured)
  — add two new routes:
  - `/dossiers` → `DossiersPage`
  - `/dossiers/:id` → `DossierDetailPage`

Pages:
- `frontend/src/pages/DossiersPage.tsx` — list view.
  - Grid of `DossierCard` components, paginated.
  - Filter bar: intent (placeholder, only `Legacy` available in
    5.0), status, date range.
  - Empty state: friendly message + link to start a new research
    run.
  - Page header: "Your Dossiers" + count + filter UI.
  - Apply Rule 31 vocabulary throughout: "sources" not
    "evidence" in any prose. No "Reports" in user-facing copy
    on this page.

- `frontend/src/pages/DossierDetailPage.tsx` — four-section view.
  - Header: dossier title (truncated request query), intent
    badge, status badge, created date, link to "View the
    original request".
  - Tabs: Request | Plan | Report | Statistics. Default: Report.
  - URL hash deep-link: `#request`, `#plan`, `#report` (default),
    `#statistics`.
  - Each tab renders the corresponding `DossierXSection`
    component.
  - 404 redirect to `/dossiers` with toast if not found.

New components in `frontend/src/components/dossiers/`:

- `DossierCard.tsx` — for the list page.
  - Title: truncated request query.
  - Intent badge (uses `IntentBadge`).
  - Status badge (uses `DossierStatusBadge`).
  - Date.
  - Citation count (from stats).
  - Sources cited count (from stats).
  - Click → navigate to detail page.
  - Accessibility: full-card click target with proper aria-label.

- `IntentBadge.tsx` — forward-compatible badge component.
  - Wave 5.0: only renders `Legacy`.
  - Implement with a map keyed by intent string for future
    extension by Wave 5.1.
  - Tooltip on hover/focus explaining "Plan metadata is captured
    for runs created after the Plan Confirmation Gate launches."
    Apply Rule 31 vocabulary.

- `DossierStatusBadge.tsx` — renders run status (running, completed,
  failed, etc.). Uses existing status colors from the report
  surface — locate them, do not invent new tokens.

- `DossierRequestSection.tsx` — renders the original request.
  - The natural-language query.
  - Any supplemental context (uploaded files, prior context).
  - Timestamp.
  - Read-only.

- `DossierPlanSection.tsx` — renders the plan.
  - Wave 5.0: shows the legacy stub with explainer copy:
    "This dossier was created before the Plan Confirmation Gate
    was introduced. Plan metadata is not available for legacy
    dossiers. New dossiers will include the confirmed plan,
    refinement history, and the orchestration profile used."
  - Forward-compatible: structure the component to render the
    full plan_payload object when Wave 5.1 ships, using
    placeholder sections for Intent / Topic Analysis /
    Orchestration Profile / Source Strategy / Output Shape.

- `DossierReportSection.tsx` — thin wrapper around the existing
  report rendering primitives. Reuse the components from the
  existing `ReportDetailPage.tsx`. Do not duplicate rendering
  logic; refactor the existing report renderer into a shared
  component if necessary, but keep the surface area minimal in
  this commit.

- `DossierStatisticsSection.tsx` — renders stats from
  dossier_statistics.
  - Numeric stats as a clean grid.
  - Sources-by-tier breakdown as a small recharts donut or bar.
  - Models used per stage.
  - Refinement rounds (will be 0 for all Wave 5.0 dossiers).
  - Estimated/actual cost where available.
  - Apply Rule 31 vocabulary throughout.

Hooks:
- `frontend/src/hooks/useDossier.ts` — fetches single dossier via
  Tanstack Query.
- `frontend/src/hooks/useDossiers.ts` — paginated list.
- Cache keys: `['dossier', id]` and `['dossiers', filters]`.
- Invalidation on mutation patterns to be defined in Wave 5.1.

Per Rule 32: these hooks consume the dossier API response shape
directly. They do not assemble dossier views from separate report/
run/stats fetches.

---

### Commit 4 — `feat(frontend): add reports → dossiers redirect bridge`

Existing pages:
- `frontend/src/pages/ReportsPage.tsx` — replace body with a
  308-equivalent redirect via `<Navigate to="/dossiers"
  replace />`. Keep the file (deletion is Wave 5.4).
- `frontend/src/pages/ReportDetailPage.tsx` — replace body with
  a redirect to `/dossiers/:id` using the existing URL param.
  Keep the file.

The 308 status is the HTTP redirect semantics; React Router's
`<Navigate replace />` is the SPA equivalent. For prerendered HTML
(Vercel catch-all per Rule 30 and Wave 3 prerender), add a
server-side 308 redirect rule in `vercel.json`:

```json
{
  "redirects": [
    { "source": "/reports", "destination": "/dossiers", "permanent": true },
    { "source": "/reports/:id", "destination": "/dossiers/:id", "permanent": true }
  ]
}
```

Per Rule 30, also update:
- `frontend/public/sitemap.xml` — replace `/reports` entries with
  `/dossiers` entries.
- Catch-all exclusions (per Rule 30, anything prerendered must not
  be shadowed by the SPA catch-all) — confirm `/dossiers` is
  prerendered if any other content page is, and that `/reports` is
  removed from the prerender manifest.

Layout/navigation:
- `frontend/src/components/layout/Layout.tsx` — nav link "Reports"
  → "Dossiers". `to: '/reports'` → `to: '/dossiers'`. Update icon
  if the existing icon was specifically a "report" metaphor; use
  `Folder` or `FileStack` from lucide-react if a more dossier-
  appropriate icon exists. Otherwise leave the icon and just
  change the label.

Tests:
- A frontend test (Vitest + React Testing Library) confirming
  the redirect components return a `<Navigate>` and not the old
  page body.
- A Vercel-config integration check (manual verification logged
  in PR description): `curl -I https://www.researchone.io/reports`
  returns 308 to `/dossiers` after deploy.

---

### Commit 5 — `feat(marketing): surgical 'reports' → 'dossiers' copy pass`

Surgical means: where the copy refers to the *user-facing
artifact*, swap to "dossier" or "research dossier". Where it
refers to the *document inside*, keep "report".

Apply Rule 31 vocabulary discipline alongside.

Files to audit (read each, decide per-match):

- `frontend/src/pages/LandingPage.tsx`
- `frontend/src/pages/MethodologyPage.tsx`
- `frontend/src/pages/FaqPage.tsx`
- `frontend/src/pages/PricingPage.tsx`
- `frontend/src/pages/AboutPage.tsx`
- `frontend/src/pages/ComparePage.tsx`
- `frontend/src/pages/GuidePage.tsx`
- `frontend/src/lib/marketingDocumentHead.ts` — per-route meta
  descriptions. Apply the artifact-vs-document distinction.
- `frontend/index.html` — meta tags.
- `frontend/src/content/marketingFaqItems.ts`
- `frontend/src/content/landingFeatureCards.ts`
- `frontend/src/components/landing/persona/personaContent.ts`
- `frontend/src/components/landing/LivingReportTimeline.tsx` —
  note: this component renders the lifecycle of the *report
  document* inside a dossier. Likely keep "report" here. Verify
  by reading the component context.
- `README.md` — marketing-facing lines only. Identifier strings
  and pipeline tables remain.

Heuristics:
- "research report" as the deliverable → "research dossier"
- "your reports" (nav, list page reference) → "your dossiers"
- "the report" referring to the document itself → keep "report"
- "report card" referring to a dossier list item → "dossier card"
- "report timeline" referring to the report document lifecycle
  → keep "report timeline"
- "evidence" → apply Rule 31 mapping concurrently

If ambiguous, STOP, surface the line, ask for founder
clarification.

---

### Commit 6 — `feat(stats): dossier statistics aggregation service stub`

New service:
`backend/src/services/telemetry/dossierStatisticsAggregator.ts`

This service computes and persists `dossier_statistics` rows when
runs complete. Wave 5.0 adds the service module and wires it as a
no-op at run completion in the orchestrator's final stage.
Actually populating non-null statistics for new runs is part of
Wave 5.2 (when intent-driven orchestration introduces the
agents-ran / agents-skipped data) and Wave 5.3 (source-class
breakdown).

For Wave 5.0:
- Service exports `aggregateAndPersist(runId: string): Promise<void>`.
- Implementation reads what it can from existing telemetry tables
  (`research_run_progress`, `cost_telemetry`, `reports`).
- Computes: `total_duration_ms`, `tokens_input`, `tokens_output`,
  `sources_retrieved_count`, `sources_cited_count` where the data
  exists; leaves the rest NULL.
- Upserts into `dossier_statistics` (insert with ON CONFLICT
  UPDATE on run_id).
- Idempotent: safe to call multiple times.

Wire-in:
- In `backend/src/services/reasoning/researchOrchestrator.ts`,
  identify the run-completion path (search for the
  `'research:completed'` socket emission or the `done` progress
  event near line 790). Add ONE call:
  `await aggregateAndPersist(runId).catch(err => logger.warn(...))`.
  Failure must NOT fail the run; stats aggregation is best-effort.

- This is the ONLY modification to the orchestrator in Wave 5.0.
  It is a single line addition at the run-completion path. It
  does not change the orchestrator's pipeline behavior, agent
  invocations, or state-machine semantics. Confirm this change is
  within Rule 10's allowed surface (state machine: untouched;
  agent flow: untouched; only a side-effect telemetry call is
  added).

Tests:
- Service unit test: aggregateAndPersist computes correct values
  from seeded telemetry data.
- Service unit test: idempotency.
- Service unit test: NULL values for missing telemetry.
- Integration test: completed run produces a dossier_statistics
  row.

---

### Commit 7 — `test(dossier): end-to-end dossier flow integration test`

A Playwright (or repo-equivalent) test that exercises:

1. Create a research run via existing API.
2. Wait for completion.
3. Fetch `/api/dossiers/:id` and confirm four-section payload.
4. Confirm `dossier_statistics` row exists.
5. Confirm `research_plans` row exists with `status='legacy'`.
6. Visit `/dossiers/:id` in the browser, confirm all four tabs
   render.
7. Visit `/reports/:id` (old URL) and confirm redirect to
   `/dossiers/:id`.
8. Visit `/dossiers` list and confirm the new dossier appears.

This is also the right place to add a Rule 32 enforcement test:
grep through `backend/src/api/routes/` for any route handler that
imports `research_runs`, `reports`, `research_plans`, or
`dossier_statistics` table queries directly without going through
`dossierReadService.ts`. Fail if found.

---

### Commit 8 — `chore: Wave 5.0 acceptance verification and PR description`

This commit is the documentation of acceptance criteria having
been met. Update PR description with:

- All seven prior commits referenced.
- Manual verification log:
  - `npm run migrate` clean apply on fresh DB.
  - `npm run migrate` idempotent on second apply.
  - `npm run lint`, `npm run typecheck`, `npm run test` pass on
    both backend and frontend.
  - `npm run build` succeeds on frontend (with prerender).
  - Lighthouse Accessibility ≥ 95 on `/dossiers` and
    `/dossiers/:id`.
  - Lighthouse SEO ≥ 90 on `/dossiers`.
  - Curl check on `/reports` → 308 to `/dossiers`.
  - Curl check on `/reports/:id` → 308 to `/dossiers/:id`.
  - Sitemap regenerated and validates.
  - Existing report rendering continues to work via the
    DossierReportSection wrapper.
  - Wave 4 (Rule 31) vocabulary intact across all new copy.
  - Rule 32 enforcement test green.
  - Stats aggregation produces rows for newly-completed runs.
- Rules invoked:
  - 10 (state machine fence preserved)
  - 13 (deploy/schema skew: migration deploys before frontend)
  - 20 (preamble fence preserved)
  - 24 (canonical read path: v_dossier)
  - 27 (pipeline stage names fence preserved)
  - 28 (tier identifier fence preserved)
  - 29 (scope-doc parity)
  - 30 (sitemap and catch-all alignment)
  - 31 (Wave 4 vocabulary)
  - 32 (this wave's discipline)
- Out of scope confirmation: orchestrator pipeline behavior
  unchanged (except the single best-effort telemetry call at
  run completion); no intent classification yet; no Plan gate
  yet; no Steelman; no source-class dimension.
- Follow-up: Wave 5.1 scope doc opens next.

---

## Acceptance criteria for PR-B

- All eight commits land in the listed order.
- Migration 034 applies cleanly on a fresh DB and on the
  production schema snapshot.
- All new tables have RLS enabled with policies mirroring
  research_runs.
- `v_dossier` view is the only read path used by
  `dossierReadService.ts`; verified by grep test.
- `npm run lint`, `npm run typecheck`, `npm run test` all pass
  on backend and frontend.
- `npm run build` succeeds with Wave 3 prerender intact.
- Lighthouse Accessibility ≥ 95 on `/dossiers` and `/dossiers/:id`.
- Lighthouse SEO ≥ 90 on `/dossiers`.
- `/reports` and `/reports/:id` return 308 redirects to the new
  URLs (via vercel.json).
- All four sections (Request, Plan, Report, Statistics) render on
  detail page.
- Legacy plans render gracefully with the explainer copy.
- Stats aggregation populates dossier_statistics on new run
  completion.
- Zero residual "report" copy where "dossier" is correct;
  zero residual "evidence" copy outside the Rule 31 allow-list.
- The orchestrator changed in exactly one line (the
  best-effort stats aggregation call at run completion).

## Stop conditions (apply standing instruction)

- If migration 033 conflicts with an existing migration: stop,
  surface the conflict.
- If the orchestrator change requires touching anything beyond the
  single best-effort telemetry call (e.g., state machine, retry
  logic, agent flow): stop, surface the discrepancy, ask whether
  to defer the wire-in to Wave 5.1.
- If RLS policy patterns differ between research_runs and what
  the scope doc assumed: stop, surface, mirror whatever the
  existing pattern actually is.
- If the existing report rendering primitives are not cleanly
  reusable as DossierReportSection: stop, propose a refactor
  approach, ask for founder direction.
- If marketing copy contains an ambiguous "report" reference that
  could be either artifact or document: stop, surface, ask.
- If any rule conflict surfaces during implementation: apply
  standing instruction.

## PR description format

Title: `feat(dossiers): wave 5.0 dossier data model implementation (PR-B)`

Body sections:
- Summary (link to PR-A scope doc, Rule 32, governance entry)
- Commits list (the eight above) with one line each
- Files changed (count and high-level grouping)
- Verification log per Commit 8
- Rules invoked with status
- Out of scope confirmation
- Follow-up items: Wave 5.1 scope doc opens next.

Proceed.