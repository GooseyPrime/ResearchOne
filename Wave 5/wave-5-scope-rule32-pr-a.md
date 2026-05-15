# Wave 5.0 Scope Doc + Rule 32 — Cursor Agent Work Order (PR-A)

You are working on the GooseyPrime/ResearchOne repository (backend +
frontend monorepo). This PR establishes the scope contract for Wave
5.0: the Dossier data model and the Dossiers page. It mirrors the
Rule 29 / PR #119 → #120 / Wave 4 PR-A → PR-B pattern.

Implementation lands in PR-B (Wave 5.0 implementation), NOT this PR.

## Standing instruction (in effect for the entire work order)

On any rule conflict, stop. Quote the rule by ID and line. State
the discrepancy. Ask for (a) founder override, (b) rule amendment,
or (c) defer. Wait for the founder reply. No silent deferral. Do
not proceed past a conflict on your own judgment.

## Mandatory pre-read

Before writing anything, read these in full:

1. `.cursor/rules/20-research-policy-guardrails.mdc` — Immutability
   fence. `alwaysApply: true`. Hard boundary for Wave 5.0: the
   preamble, RED_TEAM_V2_SYSTEM_PREFIX, model defaults, and
   inference paths are untouched in this wave.
2. `.cursor/rules/10-state-machine-and-multi-writer.mdc` — Run-
   state-machine discipline. Wave 5.0 does NOT modify state
   transitions. Adding the Plan stage is Wave 5.1; this wave
   leaves the state machine alone.
3. `.cursor/rules/13-deploy-skew-and-schema.mdc` — Schema/deploy
   skew discipline. Wave 5.0 adds tables and a column; rollout
   ordering matters.
4. `.cursor/rules/24-canonical-path-after-mutation.mdc` — Reads
   after writes follow canonical paths. Dossier reads must use the
   canonical view defined in this wave.
5. `.cursor/rules/29-marketing-scope-doc-contracts.mdc` — Scope-doc
   contract pattern. Wave 5.0 conforms.
6. `.cursor/rules/30-vercel-prerender-spa-routing.mdc` — Routing
   discipline. Renaming /reports → /dossiers requires sitemap and
   catch-all updates.
7. `.cursor/rules/31-evidence-vs-source-vocabulary.mdc` (assuming
   Wave 4 merged first; if not, STOP and report) — Vocabulary
   discipline applies to all new copy in this wave.
8. `docs/governance.md` — Founder-override registry.
9. `docs/wave-4-evidence-vocabulary-scope.md` — Format reference
   plus dependency check (Wave 4 must be merged before this).
10. `backend/src/db/migrations/001_initial_schema.sql` lines
    243-290 — current `research_runs` and `reports` tables.
11. `backend/src/services/reasoning/researchOrchestrator.ts` —
    confirm orchestrator stages and progress events. Wave 5.0 does
    NOT modify the orchestrator. It only adds read-side views.
12. `frontend/src/pages/ReportsPage.tsx` and
    `frontend/src/pages/ReportDetailPage.tsx` — current report
    surfaces. Wave 5.0 renames and restructures.

## Dependency gate

Wave 5.0 depends on Wave 4 being merged. Specifically:
- Rule 31 file present at `.cursor/rules/31-evidence-vs-source-vocabulary.mdc`
- Wave 4 vocabulary applied across marketing surfaces
- `EvidenceProvenancePanel.tsx` renamed to `SourceProvenancePanel.tsx`

If any of those is missing: STOP, report, ask for founder direction
(proceed anyway, defer, or block on Wave 4 completion).

## What Wave 5.0 is

ResearchOne currently produces Reports as the user-facing artifact.
The conceptual upgrade in the Wave 5 plan reframes the output unit
as a **Dossier**: a four-part bundle of {original query as
confirmed by user + the confirmed Plan + the Report + run
Statistics}. This wave establishes the data model and the user-
facing surface for the Dossier without yet changing pipeline
behavior (Plan generation, intent classification, and the
Confirmation Gate all land in Wave 5.1).

In effect: the existing `research_runs` row plus the `reports` row
plus run progress and cost telemetry already constitute most of a
Dossier. Wave 5.0 makes that bundle a first-class concept with its
own table, its own URL, its own page, and a forward-compatible
schema for the Plan that 5.1 will populate.

## Definitions (lock these into the doc)

- **Dossier**: the canonical user-facing artifact produced by a
  research run. Contains four sections — Request, Plan, Report,
  Statistics — each independently navigable.
- **Request**: the original natural-language query as confirmed by
  the user, plus any uploaded supplemental context.
- **Plan**: the structured orchestration intent for the run.
  Populated in Wave 5.1; in Wave 5.0, persists as nullable and
  back-fills as `legacy` for existing runs.
- **Report**: the generated long-form document. Unchanged from
  current behavior in Wave 5.0.
- **Statistics**: run telemetry — duration, tokens, sources
  retrieved/cited, source-class breakdown (populated in 5.3), tier
  distribution, agents that ran.
- **Dossier ID**: a stable UUID that surfaces in the URL as
  `/dossiers/:id`. Aliases the underlying `research_run_id` 1:1 in
  Wave 5.0; can diverge in future waves if multi-report-per-run
  ever becomes a feature.

## In Scope

### Data model

New migration: `034_dossier_data_model.sql` (renumbered from an earlier “033” label; repo file `033` is citation_style). Contents:

1. New table `research_plans`:
```
   id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
   run_id          UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE
   org_id          UUID NOT NULL REFERENCES orgs(id)
   user_id         UUID NOT NULL REFERENCES users(id)
   status          TEXT NOT NULL DEFAULT 'legacy'
                   CHECK (status IN ('legacy', 'draft', 'pending_confirmation',
                                     'confirmed', 'superseded'))
   intent          TEXT NOT NULL DEFAULT 'legacy'
   intent_confidence NUMERIC(4,3)  -- nullable for legacy
   plan_payload    JSONB NOT NULL DEFAULT '{}'::jsonb
                   -- forward-compatible structured plan; empty in 5.0,
                   -- populated by Wave 5.1
   plan_summary    TEXT             -- human-readable plan summary, nullable in 5.0
   refinement_rounds INTEGER NOT NULL DEFAULT 0
   confirmed_at    TIMESTAMPTZ
   superseded_at   TIMESTAMPTZ
   created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

   Indexes:
   - `idx_research_plans_run_id` on (run_id)
   - `idx_research_plans_org_user` on (org_id, user_id)
   - Unique partial: `uniq_research_plans_run_active` on (run_id)
     WHERE status IN ('draft', 'pending_confirmation', 'confirmed')
     — at most one active plan per run.

   Trigger:
   - `trg_research_plans_updated_at` mirroring existing pattern.

   RLS:
   - Match `research_runs` policies. Reads scoped to org+user;
     writes scoped to authenticated user with org membership.
     Mirror migration 022 patterns exactly.

2. New table `plan_revisions`:
```
   id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
   plan_id         UUID NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE
   revision_number INTEGER NOT NULL  -- 0 = initial plan, 1+ = refinements
   refinement_prompt TEXT             -- natural-language user instruction; null for revision 0
   prior_plan_payload JSONB           -- snapshot of plan_payload before this revision; null for revision 0
   new_plan_payload JSONB NOT NULL    -- snapshot of plan_payload after this revision
   diff_summary    TEXT               -- human-readable summary of what changed
   created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   created_by      UUID NOT NULL REFERENCES users(id)
```

   Indexes:
   - `idx_plan_revisions_plan_id` on (plan_id, revision_number)
   - Unique: `uniq_plan_revisions_plan_revision` on (plan_id, revision_number)

   RLS: inherit from research_plans policies.

3. New table `dossier_statistics`:
```
   id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
   run_id          UUID NOT NULL UNIQUE REFERENCES research_runs(id) ON DELETE CASCADE
   total_duration_ms BIGINT
   tokens_input    BIGINT
   tokens_output   BIGINT
   sources_retrieved_count INTEGER
   sources_cited_count INTEGER
   citation_density NUMERIC(6,3)      -- citations per claim
   skeptic_annotations_count INTEGER
   contradictions_count INTEGER
   refinement_rounds INTEGER
   agents_ran      JSONB              -- array of agent names that ran
   agents_skipped  JSONB              -- array of agent names that were skipped
   stage_durations JSONB              -- per-stage duration map
   models_used     JSONB              -- per-stage model identifiers
   estimated_cost_cents INTEGER       -- for BYOK/Sovereign
   actual_cost_cents INTEGER          -- for runs on customer keys
   computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

   This table is populated at run completion by a new
   `services/telemetry/dossierStatisticsAggregator.ts` service
   (added in PR-B implementation). For existing completed runs at
   migration time, the table is back-filled by the migration with
   computed fields from existing `research_run_progress` and
   `cost_telemetry` data where available, NULL where not.

   RLS: match research_runs.

4. Canonical view `v_dossier`:
```
   CREATE OR REPLACE VIEW v_dossier AS
   SELECT
     rr.id                AS dossier_id,
     rr.id                AS run_id,
     rr.org_id,
     rr.user_id,
     rr.query             AS request_query,
     rr.supplemental_context AS request_supplemental,
     rr.created_at        AS dossier_created_at,
     rr.status            AS run_status,
     rp.id                AS plan_id,
     rp.intent            AS plan_intent,
     rp.plan_summary      AS plan_summary,
     rp.plan_payload      AS plan_payload,
     rp.status            AS plan_status,
     rp.refinement_rounds AS plan_refinement_rounds,
     rep.id               AS report_id,
     rep.title            AS report_title,
     rep.status           AS report_status,
     rep.finalized_at     AS report_finalized_at,
     ds.total_duration_ms,
     ds.tokens_input,
     ds.tokens_output,
     ds.sources_retrieved_count,
     ds.sources_cited_count,
     ds.citation_density,
     ds.skeptic_annotations_count,
     ds.contradictions_count,
     ds.stage_durations,
     ds.models_used,
     ds.estimated_cost_cents,
     ds.actual_cost_cents
   FROM research_runs rr
   LEFT JOIN research_plans rp
     ON rp.run_id = rr.id
    AND rp.status IN ('confirmed', 'legacy')
   LEFT JOIN reports rep
     ON rep.run_id = rr.id
   LEFT JOIN dossier_statistics ds
     ON ds.run_id = rr.id;
```

   This view is the canonical read path for the Dossiers page.
   Any frontend reads of Dossier data must go through this view
   per Rule 24. Direct joins against the four underlying tables
   are not permitted in API responses.

5. Back-fill in the migration body:
```
   -- Back-fill research_plans with a legacy row for every existing run
   INSERT INTO research_plans (run_id, org_id, user_id, status, intent,
                               plan_payload, plan_summary, confirmed_at,
                               created_at)
   SELECT id, org_id, user_id, 'legacy', 'legacy',
          '{}'::jsonb, NULL, completed_at, created_at
   FROM research_runs
   WHERE id NOT IN (SELECT run_id FROM research_plans);

   -- Back-fill dossier_statistics from existing telemetry
   -- (best-effort; NULL where data unavailable)
   INSERT INTO dossier_statistics (run_id, total_duration_ms,
                                   tokens_input, tokens_output, ...)
   SELECT ... FROM research_runs LEFT JOIN ... ;
```

   Back-fill must be idempotent.

### Backend API

New API routes under `backend/src/api/routes/dossiers.ts`:

- `GET /api/dossiers` — list dossiers for the authenticated user/
  org. Pagination, filtering by intent (in Wave 5.0 always
  `legacy`), status, date range. Reads from `v_dossier`.
- `GET /api/dossiers/:id` — single dossier. Returns the full
  four-section payload.
- `GET /api/dossiers/:id/request` — Request section only.
- `GET /api/dossiers/:id/plan` — Plan section only. In 5.0, this
  returns the legacy stub plan.
- `GET /api/dossiers/:id/report` — Report section only. Aliases
  the existing `GET /api/reports/:id` for the report linked to
  this run.
- `GET /api/dossiers/:id/stats` — Statistics section only.

The existing `/api/reports` routes continue to work. Wave 5.0 adds
the `/api/dossiers` routes alongside as a forward-compatible
surface. Deprecation of the `/api/reports/:id` URL is NOT in this
wave's scope.

### Frontend

Routing:
- New route: `/dossiers` (list page).
- New route: `/dossiers/:id` (detail page).
- Existing `/reports` and `/reports/:id` remain functional and
  308 → redirect to the corresponding `/dossiers` URL.
- `public/sitemap.xml` updated to include `/dossiers` and remove
  `/reports` (catch-all alignment per Rule 30).

Pages:
- New `frontend/src/pages/DossiersPage.tsx` — list view. Card
  layout. Each card shows the Request as the title, the plan
  intent badge (`Legacy` in 5.0), the date, citation count, and a
  small statistics preview (duration, sources cited).
- New `frontend/src/pages/DossierDetailPage.tsx` — four-section
  view. Tabbed UI with Request / Plan / Report / Statistics tabs.
  Default tab is Report. URL hash `#request`, `#plan`,
  `#statistics` deep-links to each tab.
- Old `frontend/src/pages/ReportsPage.tsx` and
  `ReportDetailPage.tsx` — kept as thin redirect components that
  308 to the Dossier URLs. Not deleted in 5.0 to avoid breaking
  external bookmarks or in-flight customer links. Deletion in
  Wave 5.4.

Layout/navigation:
- `frontend/src/components/layout/Layout.tsx` — nav link "Reports"
  changes to "Dossiers". `to: '/reports'` becomes `to: '/dossiers'`.
- Sidebar/menu icons updated where relevant.

New components:
- `frontend/src/components/dossiers/DossierCard.tsx`
- `frontend/src/components/dossiers/DossierRequestSection.tsx`
- `frontend/src/components/dossiers/DossierPlanSection.tsx` —
  renders the legacy stub plan with copy explaining that Plan
  metadata is captured for runs started after Wave 5.1.
- `frontend/src/components/dossiers/DossierReportSection.tsx` —
  reuses existing report rendering primitives. Thin wrapper.
- `frontend/src/components/dossiers/DossierStatisticsSection.tsx`
- `frontend/src/components/dossiers/DossierStatusBadge.tsx`
- `frontend/src/components/dossiers/IntentBadge.tsx` — renders
  `Legacy` for Wave 5.0; the badge component is forward-
  compatible with the full intent taxonomy in 5.1.

Hooks:
- `frontend/src/hooks/useDossier.ts` — fetches single dossier via
  `/api/dossiers/:id`.
- `frontend/src/hooks/useDossiers.ts` — paginated list.

State:
- Zustand slice or Tanstack Query cache for dossier data. Follow
  whichever pattern the existing reports surface uses for cache
  invalidation.

Statistics rendering:
- Read-only display in Wave 5.0. Numbers presented as a clean
  table or small card grid. Apply Rule 31 vocabulary (sources, not
  evidence).
- Charts: simple bar/donut for sources-by-tier breakdown using
  recharts (already in the dep tree).

### Marketing surfaces

Public copy that references "reports" as the artifact name must
be audited:

- `frontend/src/pages/LandingPage.tsx`
- `frontend/src/pages/MethodologyPage.tsx`
- `frontend/src/pages/FaqPage.tsx`
- `frontend/src/pages/PricingPage.tsx`
- `frontend/src/lib/marketingDocumentHead.ts`
- `frontend/index.html` meta tags

Decision pattern: where the copy refers to the *user-facing
artifact*, change to "dossier" or "research dossier". Where the
copy refers to the *document inside* the artifact, keep "report".
Example:

- Before: "ResearchOne generates citation-grade research reports."
- After: "ResearchOne generates citation-grade research dossiers,
  each containing your request, the executed plan, the long-form
  report, and the run statistics."

Marketing copy updates in Wave 5.0 are surgical, not comprehensive.
The full marketing pass over the Dossier framing is part of Wave
5.4 (when the full intent taxonomy and Plan UI are live and the
product narrative shifts to match).

## Out of Scope (enumerate the fence explicitly)

- The Plan Confirmation Gate — Wave 5.1
- Intent classification — Wave 5.1
- Plan-generation LLM and refinement LLM — Wave 5.1
- Any orchestrator changes — Waves 5.1, 5.2, 5.3
- Steelman agent — Wave 5.3
- Source-class dimension on claims/citations — Wave 5.3
- Auto-confirm logic — Wave 5.4
- Saved profiles, profile sharing — Wave 5.4
- Deletion of `/reports` URL — Wave 5.4 (kept as 308 redirect
  through 5.0–5.3)
- `backend/src/constants/prompts.ts` — Rule 20 fence
- All V2 inference paths and model defaults — Rule 20 fence
- Backend tier identifier strings (Rule 28 fence)
- `frontend/src/components/landing/visual/pipelineLayout.ts` —
  Rule 27 fence

## Acceptance Criteria (measurable)

- Migration `034_dossier_data_model.sql` present, idempotent, and
  reversible (companion `down` script or in-migration rollback
  block).
- Three new tables and one view present.
- Back-fill executes cleanly on a database containing existing
  research_runs and reports. Verified with seed data.
- `/api/dossiers` routes operational and protected by existing
  auth middleware.
- `v_dossier` view is the only read path used by the new dossier
  routes (verified by grep on the routes file).
- `/dossiers` and `/dossiers/:id` render in the frontend.
- `/reports` and `/reports/:id` return 308 redirects to the
  matching `/dossiers` URLs.
- All four sections (Request, Plan, Report, Statistics) render on
  the detail page. Plan section shows the legacy stub gracefully.
- Sitemap updated.
- Existing report-detail and reports-list UX continues to work
  via the redirects.
- Lighthouse Accessibility ≥ 95 on `/dossiers` and `/dossiers/:id`.
- Lighthouse SEO ≥ 90 on `/dossiers` (matches Wave 3 target).
- Wave 4 vocabulary (Rule 31) applied throughout all new copy:
  zero use of "evidence" outside the reserved phrase set.
- All new tables have RLS enabled with policies mirroring the
  research_runs model.

## Rule References

- Rule 10 (state machine) — invoked, NOT modified (Wave 5.1 will
  modify)
- Rule 13 (deploy/schema skew) — invoked. Migration deploy
  ordering: deploy migration before frontend ships.
- Rule 20 (immutability fence) — invoked, NOT modified
- Rule 22 (out-of-scope discovery) — explicit fence sections
  satisfy
- Rule 24 (canonical read path) — invoked. v_dossier is the
  canonical path.
- Rule 27 (pipeline stage names) — invoked, NOT modified
- Rule 28 (tier identifier stability) — invoked, NOT modified
- Rule 29 (this scope-doc contract) — followed
- Rule 30 (sitemap and catch-all alignment) — invoked. Sitemap
  updated.
- Rule 31 (evidence-vs-source vocabulary, assumes Wave 4 merged)
  — applies to all new copy
- Rule 32 (new) — drafted in this PR, see Deliverable 2

## Rule 32 — Dossier Canonical Read Path

This rule codifies the v_dossier view as the canonical read path
for Dossier surfaces, mirroring the discipline of Rule 24 but
specific to the four-section bundle. The rule prevents future
contributors from bypassing the view and joining the underlying
tables directly in API responses, which would create denormalized
read paths that drift from the canonical schema.

Trigger: any PR that adds a new dossier-related route, query, or
component that reads dossier data.

Body must require:
1. New API routes reading dossier data MUST select from v_dossier.
2. Frontend components MUST consume the dossier route response
   shape, not assemble dossier views from separate report/run/
   stats fetches.
3. If a future feature needs a field not in v_dossier, the view
   is updated in the same PR, not bypassed.
4. Cross-references: Rule 24 (canonical-path-after-mutation),
   Rule 13 (deploy/schema skew).

## Open Questions

List anything ambiguous you encounter while drafting the doc. If
none, state "None."

## Deliverables for PR-A (this PR)

You will produce exactly four files. No implementation changes.

1. `docs/wave-5-0-dossier-data-model-scope.md` — this scope doc
   in full, with all sections above filled in. Mirror the format
   of `docs/wave-4-evidence-vocabulary-scope.md`.

2. `.cursor/rules/32-dossier-canonical-read-path.mdc` — new rule
   file. Front-matter `alwaysApply: true`. Globs include
   `backend/src/api/routes/dossiers*.ts`,
   `frontend/src/hooks/useDossier*.ts`,
   `frontend/src/pages/Dossier*.tsx`. Body per the Rule 32 spec
   above.

3. `docs/governance.md` — appended entry. Wave 5.0 founder
   approvals:
   - Bless Rule 32 as new always-apply discipline rule.
   - Confirm the table layout (research_plans + plan_revisions +
     dossier_statistics + v_dossier view).
   - Confirm /reports → /dossiers URL rename with 308 redirect
     bridge through Wave 5.3.
   - Confirm marketing copy "report" → "dossier" surgical pass.
   - Reaffirm Rule 20, 27, 28 fences untouched.

4. PR description. Title:
   `docs: wave 5.0 dossier data model scope + rule 32 (PR-A)`

   Body sections: Summary, Files changed, Rules invoked/added,
   Acceptance criteria, Out of scope, Follow-up PR (Wave 5.0
   implementation PR-B).

## Constraints

- No changes outside `docs/` and `.cursor/rules/` in PR-A.
- No edits to `backend/src/constants/prompts.ts`.
- No backend tier identifier changes.
- No orchestrator changes.
- Confirm Wave 4 (Rule 31 file present) before drafting any new
  vocabulary; if Rule 31 absent, stop and report.
- Conventional commits.

## Stop conditions (apply standing instruction)

- If Wave 4 is not merged (Rule 31 absent, Wave 4 scope doc
  absent): stop, report status, ask whether to proceed with
  scope-doc-only or defer.
- If `001_initial_schema.sql` differs materially from the
  research_runs/reports structure assumed in the data model:
  stop, surface the discrepancy, ask for adjusted schema.
- If a referenced rule has been updated since the last reading:
  stop, re-read, ask whether the scope still holds.
- If you find any existing migration that already created similar
  tables: stop, report, ask whether to extend the existing tables
  or proceed with the new ones.

Proceed.