# Agent rules for this repo

If you are an AI coding agent working in this repository, **read
`.cursor/rules/00-pre-commit-review.mdc` before starting any work.** It
is the master pre-commit checklist and links out to the topic-specific
rules.

The rules in `.cursor/rules/` exist because the agent shipped 22
reviewer-caught bugs across PRs #36–#40 and the user asked for a
self-update so those patterns do not recur. The retrospective that
drove the rules is at
[`docs/retrospectives/2026-04-28-pr36-40-review-findings.md`](docs/retrospectives/2026-04-28-pr36-40-review-findings.md).

## Rule index

| File | Topic |
|---|---|
| [`.cursor/rules/00-pre-commit-review.mdc`](.cursor/rules/00-pre-commit-review.mdc) | Master checklist. Always read. |
| [`.cursor/rules/10-state-machine-and-multi-writer.mdc`](.cursor/rules/10-state-machine-and-multi-writer.mdc) | Single-writer / single-reader for state. |
| [`.cursor/rules/11-error-paths-and-logging.mdc`](.cursor/rules/11-error-paths-and-logging.mdc) | Don't lose logs / fallbacks when narrowing an error path. |
| [`.cursor/rules/12-event-window-math.mdc`](.cursor/rules/12-event-window-math.mdc) | `[...prev, new].slice(-N)` — newest-at-bottom, drop oldest. |
| [`.cursor/rules/13-deploy-skew-and-schema.mdc`](.cursor/rules/13-deploy-skew-and-schema.mdc) | Code must tolerate migrations not being applied yet. |
| [`.cursor/rules/14-third-party-api-contracts.mdc`](.cursor/rules/14-third-party-api-contracts.mdc) | Read library / API contracts; centralize input normalization. |
| [`.cursor/rules/15-doc-pr-and-code-parity.mdc`](.cursor/rules/15-doc-pr-and-code-parity.mdc) | Re-read the PR body / docs against the final commit. Verify external claims live. |
| [`.cursor/rules/16-tests-must-fail-without-the-fix.mdc`](.cursor/rules/16-tests-must-fail-without-the-fix.mdc) | A test that passes both with and without the fix is worse than no test. |
| [`.cursor/rules/17-ripple-and-grep-callers.mdc`](.cursor/rules/17-ripple-and-grep-callers.mdc) | When you change a primitive, grep every caller. |
| [`.cursor/rules/20-research-policy-guardrails.mdc`](.cursor/rules/20-research-policy-guardrails.mdc) | Repo-specific: `ResearchOne PolicyOne` + V2 model selection criteria. |
| [`.cursor/rules/21-billing-and-webhook-contracts.mdc`](.cursor/rules/21-billing-and-webhook-contracts.mdc) | Metadata key parity, UUID generation, Date overflow, dead-wiring prevention. |
| [`.cursor/rules/22-out-of-scope-discovery.mdc`](.cursor/rules/22-out-of-scope-discovery.mdc) | Out-of-scope findings must be addressed or scheduled, never dismissed. |
| [`.cursor/rules/23-early-return-resource-cleanup.mdc`](.cursor/rules/23-early-return-resource-cleanup.mdc) | Early returns must clean up staged files, temp resources, locks. |
| [`.cursor/rules/24-canonical-path-after-mutation.mdc`](.cursor/rules/24-canonical-path-after-mutation.mdc) | After file delete/move/compress, update all path references (vars, DB, downstream). |

## Repo-specific reading list (in priority order)

1. [`ResearchOne PolicyOne`](ResearchOne%20PolicyOne) — **the binding
   epistemic policy.** Read first.
2. [`docs/V2_MODEL_SELECTION_CRITERIA.md`](docs/V2_MODEL_SELECTION_CRITERIA.md)
   — V2 model rules and currently-approved primaries.
3. [`docs/V2_STATE_MACHINE_AND_PROVIDER_PLAN_2026-04-28.md`](docs/V2_STATE_MACHINE_AND_PROVIDER_PLAN_2026-04-28.md)
   — V2 state machine + provider-routing reasoning.
4. [`docs/V2_RELIABILITY_PLAN_2026-04-26.md`](docs/V2_RELIABILITY_PLAN_2026-04-26.md)
   — Earlier V2 reliability work. Historical but still in force.
5. [`README.md`](README.md) — runtime topology.

## Etiquette

- Do not modify `REASONING_FIRST_PREAMBLE` or `RED_TEAM_V2_SYSTEM_PREFIX`
  in `backend/src/constants/prompts.ts` and
  `backend/src/services/reasoning/reasoningModelPolicy.ts` without an
  explicit user request to do so.
- Do not silently swap a V2 default to an RLHF refusal-aligned model —
  the forbidden-defaults regression test will fail first, but the rule
  exists upstream of the test for a reason.
- When a code review surfaces a finding the agent missed, treat it as a
  data point: extend the relevant rule (or add a new one) so the
  pattern doesn't recur.
- **CSP (`vercel.json`):** If `script-src` includes `'unsafe-inline'`
  for Clerk (or similar), keep **`script-src-attr 'none'`** so inline
  event-handler attributes stay blocked (PR #84). See
  `.cursor/rules/00-pre-commit-review.mdc` § G2.
- **Migrations:** Before referencing a column in new DDL, grep prior
  migrations for which table owns that column (`sources` vs `documents`,
  etc.). See `.cursor/rules/13-deploy-skew-and-schema.mdc` (PR #83).
  Partial reruns: guard data-fix SQL on column **type** (TEXT-only
  expressions break after `ALTER TYPE`); scope `pg_constraint` checks to
  the target table — PR #102 (Codex/Copilot).
- **Postgres error branching:** Many distinct failures share the same
  `sqlstate`. Do not trigger alternate query paths on code alone (e.g.
  `42883`) — match the **message** for the specific operator mismatch you
  handle — PR #102 (Copilot).
- **OpenRouter:** Route chat + embeddings through
  `buildOpenRouterAppHeaders` so runtime matches preflight — PR #102
  (Copilot).
- **Dependencies:** Do not add npm packages that no code path imports;
  remove unused deps when review flags them.
- **Docs vs runtime env:** README and deployment checklists must match what
  the backend actually reads (`grep process.env` / `config`). BullMQ/ioredis
  uses `REDIS_HOST` + `REDIS_PORT` (`backend/src/queue/redis.ts`), not
  `REDIS_URL` — PR #103 (Copilot). When documenting `VITE_*`, apply “origin
  only” to API base URLs (`VITE_API_BASE_URL`, etc.), never to
  `VITE_CLERK_PUBLISHABLE_KEY` — PR #103 (Codex).
- **Query state coverage:** When writing a query that acts on "all X of
  type Y," enumerate every state/source that qualifies. PR #91 review
  caught two instances: (1) cascade-cancel queried `status='active'`
  but paused monitors also have Stripe subscriptions attached; (2)
  `resolveUserIdFromStripeSubscription` only checked `user_subscriptions`
  but add-on subscriptions live in `report_monitors`. Both were
  incomplete scope bugs. List the sources, confirm completeness.
- **Internal link targets:** When a CTA or anchor link points to a
  fragment (e.g. `/pricing#living-reports`), verify the target
  `id="..."` attribute exists on the destination page. PR #93 review
  caught a link to a non-existent anchor. Grep for the fragment before
  pushing.
- **Copy-code parity on interactions:** If marketing copy describes a
  user interaction ("hover to see…", "click to expand…"), the
  corresponding behavior must actually be implemented. PR #93 review
  caught copy promising hover-driven card highlighting that was never
  wired. See `.cursor/rules/15-doc-pr-and-code-parity.mdc`.
- **Early-return cleanup:** When adding an early-return path (dedup,
  validation skip, etc.), check whether the caller allocated resources
  (staged files, temp buffers, DB locks) that the normal exit path
  cleans up. PR #92 review: dedup early-return skipped staged file
  cleanup. See `.cursor/rules/23-early-return-resource-cleanup.mdc`.
- **Canonical path after file mutation:** After deleting, moving, or
  compressing a file, update every variable and DB column that stored the
  old path. PR #92 review: atlas export deleted the JSONL but DB still
  stored the deleted path; backup/upload code also used the stale
  variable. See `.cursor/rules/24-canonical-path-after-mutation.mdc`.
- **Sovereign/exempt guard symmetry:** When adding a guard (sovereign
  exempt, dry-run skip, Living Report check) to a sweep function,
  apply the same guard to every sibling function in the sweep. PR #92
  review: atlas export purge lacked the sovereign guard that the other
  three sweep functions had.
- **Bootstrap / find-or-create must also update:** Any "find-or-create"
  pattern against an external API (Stripe products, etc.) must apply
  mutable field changes (name, description) on the existing-resource
  path, not just on create. Returning the existing ID without checking
  for drift means renames never propagate on re-runs. PR #95 review
  (Codex) caught this on `findOrCreateProduct`. Compare spec fields
  against the live resource and call update when they differ.
- **Check deferred features before listing on public pages:** Before
  rendering a product or feature on a public-facing page (pricing,
  landing), grep `docs/roadmap/phase-2-deferred-features.md`. Features
  listed there must show a "Coming soon" placeholder (badge + mailto),
  never a live price or CTA. PR #95 review (Codex) caught Provenance
  Ledger being presented as a $29/mo add-on while the roadmap doc
  explicitly reserved it as Phase 2 with no backend implementation.
- **Tier/subscription loading-state safety:** When deriving UI state
  from an async tier/subscription query, never fall back to `free_demo`
  while the query is loading or errored — paid users see a flash of
  restricted UI. Either show all options until the tier is resolved
  (permissive-until-known) or show a loading state. Use `getQueryData`
  from the query client to read data already fetched by `Layout.tsx`
  rather than creating a duplicate `useQuery` with potentially
  different options. See PR #94 review (Codex P2 + Copilot ×3).
- **Admin override parity:** When gating UI on tier access (e.g.
  `hasProAccess`), always include the admin override check (`isAdmin`
  from `/auth/me`), matching the pattern in `Layout.tsx`. PR #94
  review: `BillingPage` computed `hasProAccess` purely from Stripe
  subscription, hiding admin-only content from allowlisted admins.
- **Conditional query `enabled`:** When UI gates rendering on a
  condition (e.g. `hasProAccess`), set `enabled` on the backing
  `useQuery` so it does not fire unnecessary requests for users who
  will never see the result. PR #94 review: `monitorsQuery` fired for
  all users despite the UI only showing results for pro+.
- **Use `extractApiError` for error display:** When rendering error
  messages from Axios/API responses, use the repo's `extractApiError`
  helper (already imported) instead of `error instanceof Error ?
  error.message : ...`. Axios wraps server `{error}` bodies; the
  helper unwraps them.
- **RLS-first legacy NULL rows:** With migration 029-style policies, Postgres
  evaluates RLS before route SQL. Rows with `user_id IS NULL` do not satisfy
  `user_id = current_setting('app.user_id')`, so they stay invisible to normal
  authenticated traffic even if a route adds `OR user_id IS NULL`. Backfill
  (`docs/RUNBOOKS/backfill-user-scopes.md`) is what restores access; migration
  headers and internal docs must not imply route predicates bypass RLS for NULL
  owners. PR #98 review (Copilot) clarifies PR #96 wording.
- **Multi-path ownership:** When restricting an action to "the user who
  created this resource," enumerate every path through which ownership
  is established. A source can be owned via `discovered_by_run_id` (auto
  discovery) or via `ingestion_jobs.source_id` (manual ingest). Checking
  only one path locks out users who created the resource through the
  other. PR #96 review (Codex P2).
- **Production env validation ↔ runtime:** When README or `.env.*.example`
  documents alternate connection variables (e.g. `REDIS_URL` vs `REDIS_HOST`),
  boot-time production guards must accept those variables as explicit
  configuration, and connection code must actually honor them — never validate
  one shape while the client ignores it. PR #105 review (Codex).
- **Readiness vs degraded health:** If the API could serve authenticated
  requests without intended RLS isolation (e.g. missing Postgres role
  `application_role`), core health must be **`down`** so `/health/ready`
  returns **503**, not merely `degraded` / 200. PR #104 review (Codex).
  When changing `buildHealth`’s DB probe SQL, grep test mocks for stale row
  shapes (`SELECT 1` vs `application_role_exists`).
