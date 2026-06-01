# Revision, spinoff, and dossier timeline — scope and gates

Master scope for in-place revision fixes, research spinoffs, and dossier visibility.
Read **only the gate section** for the work in progress. Rule: `.cursor/rules/35-revision-spinoff-dossier-timeline.mdc`.

## Product model

| Path | New `research_runs` row | Change engine/objective/models | Full discovery |
|------|-------------------------|--------------------------------|----------------|
| In-place revision | No | No | Scoped retrieval only |
| Research spinoff | Yes | Yes | Yes |

Migration numbers: **046** spinoff lineage, **047** `v_dossier` activity, **048** repair if needed (039 is saved orchestration profiles).

## Gate status

| Gate | Branch | PR | Status |
|------|--------|-----|--------|
| 0 | `cursor/revision-spinoff-docs-64de` | Docs | merged (#152) |
| 1 | `cursor/revision-url-retrieval-64de` | A hotfix | PR open |
| 2 | `cursor/research-spinoff-api-64de` | B backend | PR open |
| 3 | `cursor/research-spinoff-ui-64de` | B frontend | pending |
| 4 | `cursor/dossier-activity-history-64de` | C | pending |
| 5 | `cursor/dossier-timeline-table-64de` | C | pending |
| 6 | `cursor/revision-attachment-audit-64de` | D | pending |

Update this table at PR open/merge.

## API contract

| Endpoint | Gate | fa53 consumer |
|----------|------|---------------|
| `POST /api/reports/:id/revisions` (enhanced metadata) | 1 | existing |
| `POST /api/research/spinoff` | 2 | `api.startResearchSpinoff` |
| `GET /api/reports/:id/spinoff/prefill` | 2 | `api.fetchSpinoffPrefill` |
| `GET /api/dossiers/:id/report-history` | 4 | `api.getDossierReportHistory` |
| `GET /api/dossiers/:id/spinoffs` | 4 | `api.getDossierSpinoffs` |
| `GET /api/dossiers/timeline` | 5 | `api.fetchDossierTimeline` |
| `GET /api/dossiers/:id/sources` | 6 | `api.getDossierSources` |
| Revision attachment audit (TBD path) | 6 | `RevisionAttachmentAuditPanel` |

Do not merge UI for an endpoint until its gate backend is on `main`.

---

## Gate 0 — Docs (no product code)

Deliverables: this file, rule 35, `AGENTS.md`, `00-pre-commit-review.mdc` §F3.

---

## Gate 1 — Revision URL hotfix

**Allowlist:**

- `backend/src/services/research/reportRevisionSupplementalIngest.ts`
- `backend/src/services/reasoning/reportRevisionService.ts`
- `backend/src/services/ingestion/ingestionService.ts` (export fetchUrl if needed)
- `backend/src/services/retrieval/retrievalService.ts` (read-only / scoped helper)
- `backend/src/api/routes/reports.ts`
- `backend/src/__tests__/reportRevisionSupplementalIngest.test.ts` (new)
- `frontend/src/components/research/AttachmentDropZone.tsx`
- `frontend/src/pages/ReportDetailPage.tsx`
- `frontend/src/pages/ReportRevisionWorkspacePage.tsx`

**Acceptance:**

- Revision with URL → sync inline text OR explicit fetch failure in metadata/UI
- Scoped `retrieveChunks` merges into revision prompts
- Model ensemble snapshot + overrides replayed
- Tests fail if placeholder-only URL path returns

---

## Gate 2 — Spinoff API

**Allowlist:**

- `backend/src/db/migrations/046_research_spinoff_lineage.sql`
- `backend/src/api/routes/research.ts`
- `backend/src/api/routes/reports.ts` (prefill route)
- `backend/src/services/research/spinoffService.ts` (new, optional)
- `backend/src/__tests__/researchSpinoff.test.ts` (new)

**Acceptance:**

- Lineage columns written on spinoff INSERT
- Tier gate + billing parity with POST /research
- Prefill returns parent fields; supplemental includes prior-report block on submit

---

## Gate 3 — Spinoff UI

**Allowlist:**

- Cherry-pick/adapt from `origin/cursor/revision-spinoff-dossier-timeline-fa53`
- `frontend/src/pages/ReportSpinoffPage.tsx`
- `frontend/src/components/reports/ReportForkActions.tsx`
- `frontend/src/pages/ReportDetailPage.tsx`, `frontend/src/pages/DossierDetailPage.tsx`
- `frontend/src/components/research/ResearchRunRow.tsx`
- `frontend/src/utils/api.ts`, `frontend/src/App.tsx`

**Acceptance:**

- Fork CTAs: Edit in place vs New research spinoff
- Submit → `/app/research?runId=` with plan gate
- Open request with report_id → spinoff

---

## Gate 4 — Dossier activity

**Allowlist:**

- `backend/src/db/migrations/047_v_dossier_activity_spinoff.sql`
- `backend/src/db/migrations/048_v_dossier_reapply_after_047.sql` (if needed)
- `backend/src/services/research/dossierReadService.ts`
- `backend/src/api/routes/dossiers.ts`
- `frontend/src/pages/DossiersPage.tsx`, `frontend/src/pages/DossierDetailPage.tsx`

**Acceptance:**

- Sort by `last_activity_at`; badges v{N}, Spinoff
- Report history + Spinoffs tabs

---

## Gate 5 — Timeline table

**Allowlist:**

- `backend/src/services/research/dossierTimelineReadService.ts`
- `backend/src/api/routes/dossiers.ts` — register `GET /timeline` **before** `GET /:id` so Express does not treat `timeline` as a dossier id
- `frontend/src/components/dossiers/DossiersTimelineTable.tsx`
- `frontend/src/pages/DossiersPage.tsx`

**Acceptance:**

- Flat events: initial_run, report_revision, research_spinoff, plan_refinement
- Cards | Timeline toggle; CSV export optional

---

## Gate 6 — Attachment audit

**Allowlist:**

- Revision audit route + service
- `frontend/src/components/reports/RevisionAttachmentAuditPanel.tsx`
- `frontend/src/components/dossiers/DossierSourcesPanel.tsx`

**Acceptance:**

- Ingest/fetch/retrieve/cite flags per attachment
- Spinoff prior-context audit on run metadata

---

## Verification (end-to-end)

**In-place revision:** news URL in revision form → content in rewrite or visible failure.

**Spinoff:** change objective + URL → new dossier at top; timeline `research_spinoff` with parent link.

**Do not** force full orchestrator into in-place revision — spinoff is the parity path.
