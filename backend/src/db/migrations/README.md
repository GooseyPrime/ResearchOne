# SQL migrations

Migrations run in **lexicographic filename order** (`migrate.ts` uses `.sort()` on the basename).

## Duplicate numeric prefixes

Early in the repo history two pairs of files share the same numeric prefix:

- `004_report_revisions_and_model_policy.sql` then `004_runtime_model_overrides.sql`
- `005_research_run_progress_columns.sql` then `005_research_supplemental_attachments.sql`

Order is therefore determined by the **full filename**, not only the `00N_` prefix.

**Do not rename migrations** that may already be recorded in `schema_migrations` on deployed databases; that would cause double-application or skipped DDL. New migrations should use the next unused sequence number (e.g. `030_…` after `029_…`).
