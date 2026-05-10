# PR #98 retrospective — RLS vs route-layer `OR user_id IS NULL`

Copilot flagged that migration `029_user_scoped_research_data.sql` described legacy rows with `user_id IS NULL` as still readable because Express queries included `OR user_id IS NULL`.

**Actual behavior:** Row-Level Security runs before the query’s own `WHERE`. Policies that require `user_id = current_setting('app.user_id')` yield unknown (filtered out) when the stored `user_id` is NULL, so those rows are not visible through `application_role` regardless of the route predicate.

**Fix:** Corrected the migration header, `AGENTS.md`, pre-commit rule 30, and the misleading isolation test title so operators expect a backfill (`docs/RUNBOOKS/backfill-user-scopes.md`) for continuity.

**Class:** Documentation and mental models must distinguish **application SQL** from **Postgres RLS** — route predicates cannot widen what RLS denies.
