# Wave 5.0 — Dossier data model (scope contract)

This document is the binding scope for the Wave 5.0 dossier surface. Implementation must match migration `034_dossier_data_model.sql` (renumbered from an earlier spec that said “033” because `033_research_run_citation_style.sql` already exists).

## Artifact

A **Dossier** is one row in `v_dossier` per `research_runs.id` (`dossier_id` equals `run_id`). It bundles:

- **Request** — query, supplemental fields, created time (from the run).
- **Plan** — row from `research_plans` joined when `status IN ('confirmed', 'legacy')` (Wave 5.1 may extend visibility for pending plans).
- **Report** — latest `reports` row for the run (by `created_at DESC`).
- **Statistics** — row from `dossier_statistics` when present.

## API

- `GET /api/dossiers` — paginated list; filters: `page`, `pageSize`, `intent`, `status`, `dateFrom`, `dateTo`.
- `GET /api/dossiers/:id` — full dossier; `:id` is UUID (`dossier_id` / `run_id`).
- `GET /api/dossiers/:id/request|plan|report|stats` — sections.

Report **body** remains on `GET /api/reports/:reportId` when `report.reportId` is non-null.

## Rule 32

Canonical reads: `dossierReadService.ts` → `SELECT` from `v_dossier` only. See `.cursor/rules/32-dossier-canonical-read-path.mdc`.

## Telemetry

`aggregateAndPersistDossierStatistics` runs on successful run completion; failures are logged and must not fail the run.
