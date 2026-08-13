# Agent rules for this repo

## ⛔ RULE 41 — FIX EVERYTHING YOU SEE. NO SCOPE EXCUSES. ⛔

> **Binding. No exceptions.**
>
> If you encounter a failing test, lint error, type error, or build error
> while doing your work — **fix it. Right now. In this PR.** Not later.
> Not in a follow-up. Not because "it was pre-existing." You fix it.
>
> **These phrases are banned** from every commit message, PR description,
> and response. Using them is a critical failure:
> - "still fails from pre-existing unrelated docs issues"
> - "pre-existing unrelated issues" / "out of scope"
> - "not caused by this change" / "left for a future PR"
>
> Full rule: `.cursor/rules/41-fix-all-failures-no-excuses.mdc`

---

## Do not commit on `main` (binding — Rule 32)

Unless the user **explicitly** says in the **same message** that you may push
to `main` / skip a PR, follow the **ordered integration strategy**:

1. **PREFERRED — use the pre-assigned branch.** If the environment already
   supplies a non-main branch, use it with `--reuse`:
   `bash scripts/git/prepare-work-branch.sh <topic-slug> --reuse`
2. **NORMAL — create a new PR branch** (if ref creation is permitted):
   `git fetch origin && bash scripts/git/prepare-work-branch.sh <topic-slug>`
3. **RESTRICTED — GH013 ref-creation blocked.** Stop retrying. Report
   the `BLOCKED_GITHUB_REF_CREATION` block (see Rule 32) and ask the user
   for a pre-created branch or direct-main authorization.
4. **EXPLICIT DIRECT-MAIN.** Only when the user authorizes it in the same
   message — include `[direct-main]` in every commit to `main`.

Do all commits on that branch; push the branch; **open or update a PR** into
`main` (draft is fine).
**Never** `git push origin main` for scoped implementation work unless
authorized direct-main.

**This does not slow delivery to `main`.** Merging the PR **is** how work lands
on `main` (and deploy). When done, always say: **PR link + "Merge PR #N to ship."**
Do **not** ask permission before starting routine work.

**When you must involve the user (clear, short):** emergencies without
same-message direct-main authorization; cannot open a PR; or `main` / protection
CI blocked. Use the escalation block in
[`.cursor/rules/32-pr-branch-workflow.mdc`](.cursor/rules/32-pr-branch-workflow.mdc)
— offer **(A) merge PR** or **(B) user replies "push to main"** with `[direct-main]`.
Never leave work on a branch with no PR and no merge instruction.

Enforcement: `scripts/git/assert-not-on-main-branch.sh`, CI job
`main-push-gate` in `.github/workflows/ci-guards.yml` (allows normal PR merges;
blocks mistaken direct pushes), and (recommended) branch protection per
[`docs/RUNBOOKS/github-branch-protection.md`](docs/RUNBOOKS/github-branch-protection.md).

Authorized rare direct-main: user says so in the same request; commits on
`main` must include **`[direct-main]`** in the message.

---

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
| [`.cursor/rules/21-billing-and-webhook-contracts.mdc`](.cursor/rules/21-billing-and-webhook-contracts.mdc) | Metadata key parity, UUID generation, Date overflow, dead-wiring prevention, **no mocks in app `src/` (CI)**. |
| [`.cursor/rules/22-out-of-scope-discovery.mdc`](.cursor/rules/22-out-of-scope-discovery.mdc) | Out-of-scope findings must be addressed or scheduled, never dismissed. |
| [`.cursor/rules/23-early-return-resource-cleanup.mdc`](.cursor/rules/23-early-return-resource-cleanup.mdc) | Early returns must clean up staged files, temp resources, locks. |
| [`.cursor/rules/24-canonical-path-after-mutation.mdc`](.cursor/rules/24-canonical-path-after-mutation.mdc) | After file delete/move/compress, update all path references (vars, DB, downstream). |
| [`.cursor/rules/25-cost-sidecar-and-unit-economics.mdc`](.cursor/rules/25-cost-sidecar-and-unit-economics.mdc) | Cost telemetry sidecar: single emit site, run scope, idempotency, deploy skew. |
| [`.cursor/rules/26-landing-persona-and-visual.mdc`](.cursor/rules/26-landing-persona-and-visual.mdc) | Landing persona detection + lab-notebook visual (WO-V invariants). |
| [`.cursor/rules/27-animated-pipeline-hero.mdc`](.cursor/rules/27-animated-pipeline-hero.mdc) | WO-W animated pipeline hero + persona beams. |
| [`.cursor/rules/28-academic-formatting-engine.mdc`](.cursor/rules/28-academic-formatting-engine.mdc) | Academic formatting engine (Pandoc + CSL + LaTeX + evidence aliases). |
| [`.cursor/rules/29-marketing-scope-doc-contracts.mdc`](.cursor/rules/29-marketing-scope-doc-contracts.mdc) | Contract-style marketing / a11y scope docs (conditional re-scan, cwd, Lighthouse gates, F-42 boundary). |
| [`.cursor/rules/30-vercel-prerender-spa-routing.mdc`](.cursor/rules/30-vercel-prerender-spa-routing.mdc) | Vercel SPA catch-all must not shadow prerendered `dist/<segment>/`; sync exclusions with `public/sitemap.xml`. |
| [`.cursor/rules/31-evidence-vs-source-vocabulary.mdc`](.cursor/rules/31-evidence-vs-source-vocabulary.mdc) | Marketing / public copy: evidence vs. sources vocabulary (Wave 4). |
| [`.cursor/rules/32-dossier-canonical-read-path.mdc`](.cursor/rules/32-dossier-canonical-read-path.mdc) | Dossier reads must use `v_dossier` / dossierReadService (Wave 5.0). |
| [`.cursor/rules/32-pr-branch-workflow.mdc`](.cursor/rules/32-pr-branch-workflow.mdc) | All work ships via a PR branch by default unless user directs otherwise. |
| [`.cursor/rules/33-plan-confirmation-gate.mdc`](.cursor/rules/33-plan-confirmation-gate.mdc) | Plan gate writes, sockets, parked `plan_pending_confirmation` state (Wave 5.1). |
| [`.cursor/rules/34-run-url-sync-and-live-polling.mdc`](.cursor/rules/34-run-url-sync-and-live-polling.mdc) | `?runId=` detach suppression, attach hydration, stable socket subs, layout polling backoff (PR #140). |
| [`.cursor/rules/35-revision-spinoff-dossier-timeline.mdc`](.cursor/rules/35-revision-spinoff-dossier-timeline.mdc) | In-place revision URLs, research spinoffs, dossier timeline (Wave 5.4+). |
| [`.cursor/rules/36-two-audience-copy.mdc`](.cursor/rules/36-two-audience-copy.mdc) | Tier A plain language vs Tier B technical depth; CI banned-jargon grep. |
| [`.cursor/rules/37-intent-driven-report-contracts.mdc`](.cursor/rules/37-intent-driven-report-contracts.mdc) | Intent is the pipeline contract; hypothesis/falsification conditional on intent family; deliverable contract auditor. |
| [`.cursor/rules/38-ez-research-and-lab-mode.mdc`](.cursor/rules/38-ez-research-and-lab-mode.mdc) | EZ Research / Research Lab UX split; intake flow; plan preview; Research Lab preservation. |
| [`.cursor/rules/39-redesign-phase-checklist.mdc`](.cursor/rules/39-redesign-phase-checklist.mdc) | Every redesign-phase PR must update `docs/redesign-phase-status.md` and include the phase checklist in the PR description. |
| [`.cursor/rules/40-corpus-competence-gate.mdc`](.cursor/rules/40-corpus-competence-gate.mdc) | Corpus is sealed by default; unlocks per topic partition on independence + density thresholds; self-referential source guard. |
| [`.cursor/rules/42-deliverable-integrity.mdc`](.cursor/rules/42-deliverable-integrity.mdc) | Gates are never satisfied by stubs; degraded modes modify synthesis instead of replacing it; LLM-derived control values need deterministic fallbacks. |
| [`.cursor/rules/25-pm2-and-bootstrap-secrets.mdc`](.cursor/rules/25-pm2-and-bootstrap-secrets.mdc) | Emma deploy: do not export bootstrap-only DB URLs before PM2; `ALTER DEFAULT PRIVILEGES FOR ROLE`. |

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
6. [`docs/revision-spinoff-dossier-timeline-scope.md`](docs/revision-spinoff-dossier-timeline-scope.md)
   — gated work plan for revision URL fixes, research spinoffs, dossier timeline.
7. [`docs/WO-Z-REPORT-TYPE-FIDELITY.md`](docs/WO-Z-REPORT-TYPE-FIDELITY.md)
   — **OPEN work order.** Report-type fidelity: intent declaration parsing,
   verifier rubric scoping, corpus competence gate, evidence-sufficiency
   gate. Read before touching the classifier, verifier prompts, or retrieval.

## Autonomous agent entry point

AI coding agents (Copilot, Cursor, Codex) bootstrap from
[`.github/copilot-instructions.md`](.github/copilot-instructions.md). It
carries the active work-order table, the non-negotiable guardrails, and the
definition of done. Keep it in sync when a work order opens or closes.

## Production application source — no test mocks (CI enforced)

`backend/src/**` and `frontend/src/**` (excluding `__tests__/**` and
`*.test.*` / `*.spec.*` files) must **not** contain Vitest/Jest mock APIs
(`vi.mock`, `vi.fn`, `jest.mock`, etc.). Mocks belong only in unit test
files and other CI-local harnesses — they are not part of runtime
deployments, and must never be introduced into application modules that
ship on `main`.

**Enforcement:** `scripts/ci/assert-no-test-mocks-in-app-src.sh` runs in
`.github/workflows/ci-guards.yml` (PRs / all branches) and again in
`deploy-backend-emma.yml` before production SSH deploy to `main`.

## Recurring review themes (WO-AA — deliverable integrity, run `6c59b711`)

- **A green metric is not a delivered artifact.** The run reported
  `opportunitiesDelivered: 20 / opportunitiesRequested: 20` while shipping
  twenty byte-identical placeholder blocks. When adding a completeness check,
  ask what the cheapest way to satisfy it is — and make that way impossible.
- **Degraded modes must modify synthesis, not replace it.** The low-evidence
  path was a string template with no model call that was assigned straight to
  the report, so the synthesis stage ran **0 ms**. Any branch that assigns
  prebuilt markdown to the deliverable is a defect (Rule 42 R42-2).
- **Two safety features can deadlock each other.** Rule 40 seals the corpus by
  design; `assessEvidenceSufficiency` required `citableChunkCount > 0`.
  Together they made *every* run permanently "insufficient". When adding a
  gate that consumes a value another gate deliberately zeroes, pass the
  designed-state flag through.
- **A failed LLM call must never silently disable a pipeline stage.** The
  discovery planner threw, the catch set `discovery_queries: []`, and the
  orchestrator early-returned — zero web searches for the entire run. Any
  model-derived value that controls stage execution needs a deterministic
  fallback that logs, persists, and emits progress (Rule 42 R42-3).
- **Grep for hardcoded copy before rewriting prompts.** "This report
  synthesizes evidence from 0 sources and 0 evidence chunks" was a string
  literal in `researchOrchestrator.ts`, not agent output. No prompt change
  could ever have fixed it.
- **Internal identifiers leak.** `market_scout: zero relevant opportunities
  extracted` and `No citable corpus evidence cleared the competence gate`
  both reached a customer-facing report. Diagnostics belong in run metadata.
- **Write work-order phases so the wrong implementation is not permitted.**
  WO-Z Phase 5 said "proceed to synthesis under a low-evidence mode"; it was
  implemented as a template that bypassed synthesis. State explicitly whether
  an artifact is model-generated or code-generated, and name the anti-pattern
  in the exit gate.

Work order: [`docs/WO-AA-DELIVERABLE-INTEGRITY.md`](docs/WO-AA-DELIVERABLE-INTEGRITY.md).

## Recurring review themes (WO-Z — report-type fidelity, run `178fea66`)

- **Normalize captured tokens before map lookup.** `resolveIntentAlias()`
  received `**opportunity_discovery**` (markdown bold survived the capture
  group), missed every alias-map lookup, returned `null`, and the user's
  explicit intent declaration was silently discarded. Classification fell
  through to lexical matching and picked `comparative`. Whenever a regex
  capture feeds a dictionary lookup, strip markdown, quotes, backticks, and
  trailing punctuation first — and test the decorated forms, not just the
  bare one.
- **A "universal" prompt footer defeats per-type contracts.**
  `buildVerifierPromptForIntent()` injected the correct per-intent rubric
  and then appended evidence-tier-tag requirements "for all report types",
  which put adjudicative vocabulary into every deliverable. Scrubbing
  vocabulary from display surfaces (PR #198) cannot work while a backend
  prompt still mandates it at generation time. Grep for shared footers when
  a per-type contract appears not to be taking effect.
- **Default arguments pick the strict path.** `isAdjudicative = true` as a
  default parameter means any missed call site silently gets the
  adjudicative prompt set. Prefer `false` defaults for
  behavior-broadening flags, and pass explicitly.
- **Low similarity floors manufacture false authority.**
  `retrieveChunks({ minSimilarity: 0.3 })` matched the operator's own
  project notes to an unrelated market query; every citation in the failed
  report was the user's own documentation. See Rule 40.
- **Specialists reporting zero data must halt synthesis.** All four
  specialists reported "Relevant Data Points Extracted: 0"; synthesis ran
  anyway and produced a 6,000-word essay explaining why the report could
  not be written. Two bounded repair passes then failed identically —
  repair cannot fix data absence. Route to re-discovery.
- **Refusal must be a FAIL criterion.** Only
  `intent_opportunity_discovery` treated "refused to rank because evidence
  is imperfect" as failure. The `comparative` rubric passed the refusal on
  6 of 8 criteria.

Work order: [`docs/WO-Z-REPORT-TYPE-FIDELITY.md`](docs/WO-Z-REPORT-TYPE-FIDELITY.md).

## Recurring review themes (private corpus / ResearchOne consent / supplemental site crawl)

- **`corpusAccess` ≠ Pro nav:** `/app/ingest` and ingestion POST routes use `tierHasCorpusAccess` / `requirePrivateCorpus` (pro, team, byok, sovereign, admin). Atlas/corpus browse may still use broader `hasProAccess`.
- **ResearchOne shared corpus (Pipeline B):** opt-in only — no `user_ingestion_consent` row ⇒ `false` on GET and `user_opted_out` in eligibility; toggling off stops new contributions; past data is not deleted.
- **Supplemental site crawl:** `supplementalUrlCrawl` on standard/deep research and spinoff (`AttachmentDropZone` + `SiteCrawlControls`); not gated by private corpus (run-scoped URLs). Ingest workspace crawl remains on `/app/ingest` for private-corpus tiers.

## Recurring review themes (Codex / Copilot, PR #164 — private ingest + supplemental crawl)

- **Admin allowlist parity:** Any UI gate that uses `/auth/me` `isAdmin` or `ADMIN_USER_IDS` must have a matching backend bypass (`isAllowlistedAdminUserId` in `requirePrivateCorpus`, `requireAdmin`, tier routes). Grep both sides before merge.
- **Tier gate loading vs error:** `tierGateUnknown` = subscription query **loading** only. `subscriptionUnavailable` = `isError && !data` — route guards must show Billing/error UI, not infinite “Loading subscription…”.
- **Shared UI copy per surface:** Reused components (`SiteCrawlControls`) need a `crawlTarget` (or explicit label) when behavior differs — run-scoped supplemental crawl vs private-corpus Ingest.
- **Parse errors match failure mode:** Discriminated parse results (`invalid_json` vs `invalid_crawl_layers`) and `*ErrorMessage()` helpers — do not return `undefined` for both JSON and validation failures (400 message must name the actual problem).

## Recurring review themes (revision / spinoff / dossier timeline — Rule 35)

- **`cursor/revision-spinoff-dossier-timeline-fa53`:** frontend-only draft; do not merge until Gate 2 spinoff API exists on `main`.
- **Revision URL:** sync `fetchUrl` + scoped `retrieveChunks` in revision pipeline — placeholder-only inline text is a regression.
- **Spinoff tier gate:** `POST /api/research/spinoff` must mirror `checkTierAccess` / wallet path from `POST /api/research` (`isDeep` for V2; admin override on UI).
- **Cherry-pick fa53:** reconcile with unified research console (PR #149); spinoff submit → `/app/research?runId=`.
- **Migration numbers:** spinoff lineage = **046**; `v_dossier` activity = **047** (039 is saved orchestration profiles).

## Recurring review themes (Codex / Copilot, PR #169 — ingestion / nginx upload)

- **nginx 413 masquerades as CORS:** Reverse-proxy body limits that reject before the app must include CORS on error responses *or* raise `client_max_body_size` above app `MAX_FILE_SIZE_MB` and sync on every Emma deploy (`scripts/sync-nginx-api-site.sh`). Fail deploy if sync script missing or `client_max_body_size 64m` absent after sync when nginx is installed.
- **CORS www↔apex aliases:** Only expand for **apex** hosts (two DNS labels, not localhost/IP). Never emit `www.localhost` or `www.<preview-subdomain>.vercel.app` from `expandCorsOriginAliases` — grep `corsOrigins.test.ts` when changing alias logic.
- **Multer HTTP mapping:** `LIMIT_FILE_SIZE` → 413 `payload_too_large`; other `MulterError` codes → 400 `invalid_upload`.
- **Multipart axios:** Do not set `Content-Type` on `FormData` uploads — browser boundary must stay intact.
- **Deploy script checks:** Prefer `[[ -f script.sh ]]` + `bash script.sh` over `[[ -x script.sh ]]` when the script is not executed directly.

Retrospective: [`docs/retrospectives/2026-06-04-pr169-ingestion-nginx-review.md`](docs/retrospectives/2026-06-04-pr169-ingestion-nginx-review.md).
## Recurring review themes (Codex / Copilot, PR #168 — product gaps review)

- **Third-party widget SDK contracts:** Read the **shipped** bundle or type defs before calling globals (SheerID v1: `window.sheerid.loadInlineIframe`, not `loadIncentive` / `setFormElement`). Grep the CDN file when docs drift.
- **SheerID success payloads:** Accept lowercase `currentStep: 'success'`, `rewardData`, and `rewardCode` — not only uppercase `SUCCESS`. Centralize in `sheerIdPayloadIndicatesSuccess()`.
- **CSP parity for new embeds:** When adding script tags or iframes, update `vercel.json` in the same PR (`script-src`/`script-src-elem` for CDN hosts; `frame-src` for iframe origins).
- **One-time verification binding:** External proof ids (`sheerid_verification_id`) must be checked for cross-user reuse before persist — grep other identity-binding flows when adding verify endpoints.
- **Ingestion job row vs queue:** If BullMQ `add()` fails after inserting `ingestion_jobs`, mark the row `failed` in the catch block (research + revision supplemental paths).
- **Async copy accuracy:** Toasts and notifications must say **queued** when work is enqueued, not **ingested** / **complete**.
- **Dev-only bypass UI:** Server exposes `devBypassAvailable`; client gates bypass controls with `import.meta.env.DEV && devBypassAvailable` — never show dev bypass in production builds.
- **Nullable admin metrics:** When denominator is zero (`distinctRuns === 0`), return `null` for averages — not `0`.
- **Object spread order:** In error/report payloads, put explicit fields (`message`, `route`, `runId`) **after** `...context` so they are not overwritten.
- **Production webhooks without secrets:** Return **503** when required webhook secret env is unset in production — do not accept unsigned traffic.

Retrospective: [`docs/retrospectives/2026-06-04-pr168-review-findings.md`](docs/retrospectives/2026-06-04-pr168-review-findings.md).

## Recurring review themes (Codex / Copilot, PR #166 — add-ons billing wiring)

- **Wallet holds vs `creditCtx.type`:** `consumeHold` / `releaseHold` in `researchOrchestrator` must key off `holdId` + `userId`, not only `creditCtx.type === 'wallet'`. Subscription-quota runs with add-on wallet surcharges still place holds — grep `releaseHold` / `consumeHold` when changing credit paths.
- **Deploy-skew `42703` on INSERT:** Do not blanket `return false` for every missing column on authenticated inserts. Fail closed when the error names `user_id` / `org_id`; only fall through to narrower INSERTs for optional columns (e.g. `selected_addons`, lineage). Never insert ownerless rows when `userId` is set — see `spinoffInsertSkew.test.ts`.
- **Charge-without-effect add-ons:** Run add-ons that bill must change pipeline behavior (`applyAdversarialTwinToSkepticMode` un-skips `challenge`, enables `skepticMode` gate; `buildRunAddonPipelineEffects` for retrieval/citations). Grep `agentsToSkip` / `hasRunAddon` when wiring new keys.
- **Eligibility vs waiver:** `computeRunCost` / `creditEnforcement` — `eligibilityFeature` (who may purchase) can differ from `includedFeature` (plan waives surcharge). Example: `adversarial_twin` uses `deepResearchAccess` for eligibility, `adversarialTwinIncluded` for waiver — do not gate purchase on `provenanceLedgerIncluded` when the UI sells on Pro/deep.
- **Monitor status vs Stripe subscription:** Token-based Living Reports use `report_monitors.status === 'active'` only for “already subscribed” UI — `paused` must not block re-activation. Stripe add-ons remain subscription-shaped; copy on `AddOnsPage` should say “monitor(s)” vs “subscription(s)” per product type.

Retrospective: [`docs/retrospectives/2026-06-03-pr166-add-ons-billing-review.md`](docs/retrospectives/2026-06-03-pr166-add-ons-billing-review.md).

## Recurring review themes (Codex / Copilot, PR #165 — Rule 36 Tier A copy)

- **`assert-tier-a-no-banned-jargon.sh`:** use **grep -H** (single-file matches omit the path prefix), **grep/find/sed only** — GitHub `ubuntu-latest` has no `ripgrep`; mirror `assert-no-test-mocks-in-app-src.sh`.
- **Manifest/pattern parsing:** trim comments/blanks with POSIX `[[:space:]]` — do not rely on `\s` in `grep` for `#` lines.
- **Contract exemptions (Codex P2):** strip `id`/`value`/`runAddonKey` assignments and `'general-epistemic':` slug prefix, then re-test the **remainder** for banned display copy — never drop an entire matched line because a contract key appears on it.
- **Manifest completeness:** include Tier A **child components** rendered by manifest pages (e.g. `LandingPage` → `AnimatedProcessFlow`), not just the page file.
- **Objective labels:** use `researchObjectiveLabel(value)` (value-keyed lookup), not `RESEARCH_OBJECTIVE_OPTIONS[n]` array indices in guide pages.
- **Copy + interaction tests:** updating display-string assertions must **keep** behavior tests (e.g. mode tab click → `onModeChange`) — copy and wiring regress independently.

## Recurring review themes (Codex / Copilot, PR #141 — unified research + plan confirm queue)

- **`resumeJid` ripple:** Extracting plan-confirm enqueue into `enqueueResearchResumeAfterPlan` must keep `researchResumeJobId(runId)` in the route for confirm rollback (`getJob` / `remove`).
- **BullMQ dedupe races:** After `add()` fails or `remove()` is skipped (locked job), re-fetch by `jobId` and assert `data.confirmedPlanId` matches — do not treat “any job exists” as success (PR #141 Codex P1).
- **Reopen request hydrate:** Reset supplemental URLs/files/tags and `modelRows` before applying run data; empty run fields must not leave prior form state (PR #141 Copilot/Codex).

## Recurring review themes (Codex / Copilot, PR #140 — plan review navigation)

- **`?runId=` detach:** suppress auto-reattach after intentional `detachRun`; clear query param in the same path (`dismissUrlReattach` + `setUrlRunId(null)`).
- **`attachRun` hydration:** set queued placeholder **before** `await attachRun`; never regress API progress in `.then()` (Rule 34).
- **Socket `useEffect` deps:** do not list polled `runs` arrays; use refs for pathname / engine lookup.
- **Duplicate toasts:** if `PlanConfirmationPanel` already `onNotify` on cancel, socket `plan_cancelled` must not repeat (Rule 11).
- **Layout polling:** `refetchInterval` only while `hasInFlightResearchRuns`; one `['research-runs']` query shared with banner (no duplicate poll).

## Recurring review themes (Codex / Copilot, PR #124 — Stripe tier sync)

- **`setUserTier` is not a mirror of `syncSubscription`.** Only update
  `user_tiers` from Stripe when the subscription status grants paid access
  and tier resolution succeeds; never write `free_demo` on non-granting
  updates (preserves admin/sovereign/manual entitlements).
- **Add-on subs use `metadata.monitor_kind`:** when present
  (`living_report` / `reverse_citation_watch`), never drive `user_tiers`
  — unpaid add-on webhooks are not “monitor-only” (no grant) but still
  carry that metadata and must not fall through to plan-tier logic.
- **Unit tests that `vi.mock` a module:** the mock factory must export
  every **named** symbol the production module imports, or Vitest fails at
  load time — still test-only; never move that pattern into `src/` outside
  `__tests__` / `*.test.*` (see “Production application source” above).
- **V2 tier gate:** `POST /api/research` must pass `isDeep: true` into
  `checkTierAccess` when `engineVersion === 'v2'` so `monthlyDeepReportCap`
  is enforced (Copilot PR #124).

## Recurring review themes (Codex / Copilot, PR #135–#136 — billing quota + WO-Y)

- **`incrementReportCount` must mirror `checkTierAccess` `isDeep`:** V2 run
  completion passes `engineVersion === 'v2'` so `monthly_deep_reports`
  increments; always grep callers when tier gates change (PR #135).
- **`user_tiers` UPSERT:** on conflict, set
  `current_period_resets_at = COALESCE(existing, EXCLUDED)` so legacy NULL
  rows get a reset boundary (PR #135).
- **Checkout confirm idempotency:** `eventId: checkout_confirm:${sessionId}`
  on `syncStripeSubscriptionToUser` (PR #136).
- **Wallet credit guard:** only `mode === 'payment'` + `complete` +
  `payment_status` `paid` or `no_payment_required` (`checkoutSessionPaymentSettled`)
  before `creditWalletFromCheckoutSession` (PR #136).
- **100% Stripe coupons:** subscription (and payment) Checkout Sessions must
  set `payment_method_collection: 'if_required'` via
  `stripeCheckoutSessionParams.ts` builders — otherwise Hosted Checkout errors
  when a promotion code zeroes amount due.
- **Add-on Stripe subs:** early return when `metadata.monitor_kind` is set —
  do not call plan-tier `syncSubscription` (PR #136).
- **Invoice webhooks:** `invoice.payment_succeeded` only — not `invoice.paid`
  (PR #136).

## Recurring review themes (Codex / Copilot, PR #137 — knowledge graph UX)

- **Claim publisher color/domain:** use the `contains` edge map
  (`claimSourceDomain.get(claimId)`), not `resolveNodeGroupKey(claim)` —
  claims lack source URLs (PR #137 Copilot).
- **D3 selection vs rebuild:** do not put `selected?.id` in `buildGraph` deps;
  update labels/focus via refs so node click does not restart the simulation
  (PR #137 Copilot).
- **`nodeFill` `type` mode:** explicit `#60a5fa` / `#a78bfa` branch — do not
  fall through to tier colors (PR #137).
- **`computeFitViewTransform`:** clamp viewport dimensions and minimum `k`
  for zero-size containers (PR #137).
- **Graph API types:** `title` / `url` nullable in SQL row types;
  `graphGroupKeyFromUrl` accepts `null | undefined` (PR #137).

## Recurring review themes (Codex / Copilot, PR #127 — Dossier / Wave 5 reads)

- **`v_dossier` + RLS:** define the view with `WITH (security_invoker = true)` (Postgres 15+) when it selects from RLS-protected tables so policies run as the querying role, not the migration owner.
- **Refreshing `v_dossier`:** when extending the dossier contract, preserve the **single-plan** `LATERAL` join from migration 035 (run status gates which plan statuses qualify; prefer `confirmed` over `legacy`); a plain `LEFT JOIN research_plans … IN ('confirmed','legacy')` can duplicate rows per run.
- **Dossier read/list deploy skew:** catch Postgres `42P01` / `42703` in `dossierReadService` and return null / empty list (debug-log), not 500 — Rule 32 + Rule 13.
- **List query dates:** validate `dateFrom` / `dateTo` as parseable timestamps in Zod before SQL `::timestamptz` casts so bad query strings return 400.
- **Nullable rollup semantics:** do not write sentinel `0` into nullable stats columns when the source row is missing (e.g. `refinement_rounds` when no `research_plans` row); use SQL `NULL` so `COALESCE` preserves existing values.

## Recurring review themes (Codex / Copilot, PR #112)

- **Child state vs DOM-only reads:** When a parent updates `data-*` or
  similar only after `useEffect`, children that read the DOM once on
  mount stay stale — pass the resolved value as a React prop when the
  parent already owns it (e.g. `resolvedPersona` into pipeline hero surfaces).
- **`display:none` is not a perf off-switch:** Heavy animated subtrees
  (Framer Motion beam loops) should not rely on CSS hiding alone — gate
  mounting or `active` from `matchMedia` / layout, without dropping the
  whole desktop shell if that would break SSR hydration.
- **Duplicated a11y strings:** Share `role="img"` labels via one exported
  constant so static and animated paths cannot drift.
- **SVG `<defs>` ids:** Use `useId()` (or equivalent) so duplicate mounts
  do not collide on `url(#…)`.
- **Test global hygiene:** Restore `globalThis.IntersectionObserver`,
  `window.matchMedia`, etc. after tests that polyfill them.

## Recurring review themes (Codex / Copilot, PR #120 — F-42 prerender)

- **Production build must run prerender:** `npm run build` must invoke the prerender step (or Vercel never ships nested `dist/<route>/index.html`).
- **Prerender readiness:** Do not rely on a fixed sleep alone — wait for **`#root > *`** (and bounded `networkidle` where safe) before `page.content()`.
- **Bounded preview probes:** Health-check `fetch` to `vite preview` must use **per-request timeouts** (`AbortController`) so CI cannot hang forever.
- **Vercel catch-all vs static HTML:** SPA rewrite must exclude prerendered path segments (see rule 30).

## Recurring review themes (Wave 2.5 scope / a11y contract PRs)

- **Conditional secondary verification:** Re-scan extra marketing routes only when shared shell or cross-route imports change; page-local `landing/*` fixes should not automatically trigger full-route axe matrices — declare the bucket in the implementation PR.
- **Fenced command cwd:** Contract docs must state the assumed working directory (`frontend/` vs repo root) and use explicit `cd .. &&` for repo-root paths (`docs/`, `audit-snapshots/`).
- **Lighthouse + axe together:** If the contract lists axe rule IDs *and* a Lighthouse Accessibility threshold, a flat score after fixes is a **Rule 22** signal, not an automatic merge.
- **markdownlint on scope files:** When `markdownlint-cli2` is listed for a scope doc, run it before merge; root `.markdownlint-cli2.yaml` may define shared defaults.

## Recurring review themes (Codex / Copilot, PR #114 — billing UI)

- **Single observer for `['billing-subscription']`:** Use
  `useBillingSubscriptionQuery()` everywhere; do not register the same
  key with different `queryFn` / options (TanStack ambiguity on refetch).
- **Query error is not "free_demo resolved":** With `retry: false`, a
  failed subscription fetch leaves `isLoading` false — keep tier-dependent
  UI in an unresolved / permissive state unless there is success data (or
  stale success data), aligned with PR #94 tier-loading guidance.
- **Stripe return + `invalidateQueries`:** Prefer
  `invalidateQueries(filters, { cancelRefetch: false })` when the page
  mount may already be fetching the same queries.

## Recurring review themes (Codex / Copilot, PR #128 — Wave 5 plan gate + `v_dossier`)

- **Late migration overwrites `CREATE OR REPLACE VIEW`:** Filename order can apply an older migration after a newer one and drop `security_invoker` / columns — add a **trailing repair migration** (see `038_v_dossier_reapply_after_late_035.sql`) and document in Rule 33 §7.
- **`async` + deploy-skew `catch`:** Use **`return await queryOne(...)`** inside `try` so Postgres rejections hit `catch` (Rule 33 §9).
- **Sensitive sockets:** Plan payloads and gate events belong in **`job:${runId}`** only — not global `io.emit` (dashboards use minimal events like `runs:updated`).
- **Queue-before-confirm for resume jobs:** Enqueue BullMQ **before** marking the plan confirmed so Redis outages never persist "confirmed with no worker" (Rule 33 §8).

## Etiquette

- Do not modify `REASONING_FIRST_PREAMBLE` or `RED_TEAM_V2_SYSTEM_PREFIX`
  in `backend/src/constants/prompts.ts` without an explicit user request
  to do so. Agent `SYSTEM_PROMPTS` (`openrouterService.ts`),
  `modeOverlays.ts`, and `reasoningModelPolicy.ts` are outside that
  fence — edit under normal policy + review, not a preamble gate.
- Do not silently swap a V2 default to an RLHF refusal-aligned model —
  the forbidden-defaults regression test will fail first, but the rule
  exists upstream of the test for a reason.
- When a code review surfaces a finding the agent missed, treat it as a
  data point: extend the relevant rule (or add a new one) so the
  pattern doesn't recur.
- **PR #115 / academic exports (recurring review themes):** verify SQL
  column names against real migrations (`section_order` vs invented
  `position`; no fictional `reports.body_markdown`). Routes using
  `adminQuery` must require a non-null authenticated user and must not
  treat `NULL` user id as a wildcard. `tsc`-only backend builds must
  copy non-TypeScript runtime assets (CSL, DOCX) into `dist/` — see
  `backend/scripts/copy-formatting-templates.mjs`. UI docstrings and
  marketing copy must match implemented behavior (for example the export
  engine-status probe before enabling Export). Prefer `detail` alongside
  `error` in JSON error bodies surfaced to users.
- **CSP (`vercel.json`):** If `script-src` includes `'unsafe-inline'`
  for Clerk (or similar), keep **`script-src-attr 'none'`** so inline
  event-handler attributes stay blocked (PR #84). See
  `.cursor/rules/00-pre-commit-review.mdc` § G2.
  PostHog reverse-proxy rewrites must include **`/static`**, **`/array`**
  (remote config), then the API catch-all **before** the SPA fallback
  (PR #107 Codex). Prefer minimal **`font-src`**: `fonts.gstatic.com` for
  Google Fonts; `cdn.scite.ai` only for in-app Scite assets — not extra CDNs
  to silence browser extensions (PR #107 Copilot).
- **Emma deploy / PM2:** Never `export` bootstrap-only secrets (e.g. `DATABASE_ADMIN_URL`)
  for the whole `deploy-runtime.sh` session before `pm2 … --update-env` — scope them to
  the bootstrap command only, then `unset` before PM2 (PR #110 Codex/Copilot). See
  `.cursor/rules/25-pm2-and-bootstrap-secrets.mdc`.
- **Postgres default privileges:** When a privileged session repairs grants, use
  `ALTER DEFAULT PRIVILEGES FOR ROLE <migration/runtime login>` if that role owns new
  objects — not bare `ALTER DEFAULT PRIVILEGES` as the admin user (PR #110 Copilot).
- **Migrations:** Before referencing a column in new DDL, grep prior
  migrations for which table owns that column (`sources` vs `documents`,
  etc.). See `.cursor/rules/13-deploy-skew-and-schema.mdc` (PR #83).
  Partial reruns: guard data-fix SQL on column **type** (TEXT-only
  expressions break after `ALTER TYPE`); scope `pg_constraint` checks to
  the target table — PR #102 (Codex/Copilot). **`CREATE TRIGGER`** has no
  `IF NOT EXISTS` — use `DROP TRIGGER IF EXISTS …` before `CREATE` so a
  migration can replay after a partial failure (PR #109 Codex).
- **Cost telemetry (`agent_executions`):** Idempotency keys must include
  per-invocation entropy (`telemetryInvocationId` from `callRoleModel`) so
  parallel LLM calls never collide on `UNIQUE(idempotency_key)`. After
  `research_runs.report_id` is assigned at completion, backfill
  `agent_executions.report_id` (`patchAgentExecutionsReportIdForRun`, PR #109).
  Keep `.cursor/rules/25-cost-sidecar-and-unit-economics.mdc` aligned with the
  hash formula in `costSidecar.ts` (PR #109 Copilot — doc/code drift).
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
- **Landing persona + sample links (PR #108):** Persona CTAs to
  `/sample-report` must use `topic=` (see `resolveSampleReportTopic`).
  Anonymous persona beacons must use `publicApi`, not the Clerk JWT
  `api` client; mount `/api/landing` before `clerkAuthMiddleware` in
  `app.ts`. In Vitest jsdom, prefer `history.replaceState` over
  redefining `window.location`.
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

## Cursor Cloud specific instructions

### Infrastructure services (Docker)

Docker must be running before starting the backend. The development
environment uses `docker compose up -d postgres redis` from the repo
root to start PostgreSQL 16 (pgvector) on port 5432 and Redis 7 on
port 6379. The Docker daemon requires the fuse-overlayfs storage
driver and iptables-legacy in Cursor Cloud VMs (nested container
environment). After starting containers, wait for health checks to
pass before running migrations.

### Starting the application

1. `docker compose up -d postgres redis` — start infrastructure
2. `cd backend && npm run migrate` — apply all DB migrations
3. `cd backend && npm run dev` — start backend (Express + BullMQ workers on port 3001)
4. `cd frontend && npm run dev` — start frontend (Vite on port 5173)

The backend needs the exports directory to be writable:
`sudo mkdir -p /opt/researchone/exports && sudo chmod 777 /opt/researchone/exports`

### Environment files

- Backend: copy `backend/.env.development.example` → `backend/.env`. Update
  `DB_PASSWORD` to `devpassword` (matching docker-compose.yml).
- Frontend: copy `frontend/.env.example` → `frontend/.env.local`. Leave
  `VITE_API_BASE_URL` and `VITE_SOCKET_URL` blank for same-origin mode.

### Key commands

| Action | Command | Directory |
|--------|---------|-----------|
| Backend lint | `npm run lint` | `backend/` |
| Backend tests | `npm run test` | `backend/` |
| Backend typecheck | `npm run typecheck` | `backend/` |
| Frontend lint | `npm run lint` | `frontend/` |
| Frontend tests | `npm run test` | `frontend/` |
| Frontend typecheck | `npm run typecheck` | `frontend/` |
| Run migrations | `npm run migrate` | `backend/` |
| Backend build | `npm run build` | `backend/` |
| Frontend build | `npx vite build` | `frontend/` |

### Authentication

Most API routes require Clerk JWT authentication (`requireAuth` middleware).
The `ADMIN_RUNTIME_TOKEN` in `.env` only works for `requireAdmin`-protected
routes (admin panel, model overrides, cost analytics). To test authenticated
user routes, you need valid Clerk keys configured.

Required secrets (injected as env vars via Cursor Cloud Secrets):
- `CLERK_PUBLISHABLE_KEY` — Clerk frontend + backend auth
- `CLERK_SECRET_KEY` — Clerk backend JWT verification
- `OPENROUTER_API_KEY` — LLM inference for the research pipeline

Inject these into `backend/.env` and `frontend/.env.local` at startup.
The `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local` should match `CLERK_PUBLISHABLE_KEY`.

### Gotchas

- The `EXPORTS_DIR` path (`/opt/researchone/exports`) must exist and be
  writable; otherwise the health check reports `status: "down"`.
- **`NODE_ENV=production` in the developer's shell breaks local setup.** npm
  silently omits devDependencies (no `typescript`, no `vitest`), and 45 test
  files fail with `Missing required env file for production: backend/.env`.
  Run installs and tests with `NODE_ENV=development` / `NODE_ENV=test`.
  Symptom: `npm install` reports "up to date" while `node_modules/typescript`
  does not exist.
- **Dependency lifecycle scripts can fail on Windows** with
  `ERR_INVALID_ARG_TYPE: The "file" argument must be of type string`
  (`msgpackr-extract` install, `@clerk/shared` postinstall). `npm install
  --ignore-scripts` is sufficient for typecheck/lint/test.
- Backend lint has pre-existing warnings/errors (unused vars in test files);
  these are not from agent changes.
- Frontend lint uses `--max-warnings 0` so even one pre-existing warning
  fails the command.
- The `docker-compose.yml` `version` key triggers a deprecation warning
  from Docker Compose v2+ — it is harmless.
- **Fresh-database migration gotcha:** Migrations 035 and 036 use
  `CREATE OR REPLACE VIEW v_dossier` with new columns inserted in the
  middle of the SELECT list. PostgreSQL rejects column renames via
  `CREATE OR REPLACE VIEW`. On a fresh database, run:
  `docker compose exec postgres psql -U researchone -d researchone -c "DROP VIEW IF EXISTS v_dossier;"`
  after migration 034 fails on 035, then re-run `npm run migrate`.
  The same drop-and-retry is needed if 036 fails after 035 succeeds.
  Once both 035 and 036 are recorded in `schema_migrations`, subsequent
  runs are clean.
- Also update `DATABASE_URL` in `backend/.env` to use `devpassword`
  (the template ships with `changeme`).
