# WO-AE — Catch-up and completion brief

**Repo:** `GooseyPrime/ResearchOne` · **Base:** `main` at `13a203b` or later
**Author:** handoff from a Claude session that ran #218–#222
**Out of scope:** the shared ResearchOne/TruVector corpus. Do not start it. It has
its own work order coming and touching the corpus schema here will conflict.

---

## 0. Read these first, in this order

1. `AGENTS.md` — repo conventions and the rules index.
2. `.cursor/rules/44-pre-review-self-check.mdc` — **new, and written because of
   this exact work.** Automated review raised 18 findings across #217–#222 that
   were five mistakes made repeatedly. The rule names them and gives the check.
   You are expected to run that check before every push. If you do not, Codex
   and Copilot will spend their review passes on dead imports instead of your
   architecture, and the work will take three times as long. It already has.
3. `.cursor/rules/40-corpus-competence-gate.mdc` — Rule 40. The corpus is sealed
   by design until thresholds pass. A sealed partition returning zero citable
   chunks is a NORMAL state, not a failure. A previous agent (me) got this
   wrong and had to be corrected by review.
4. `.cursor/rules/41-fix-all-failures-no-excuses.mdc` and
   `.cursor/rules/42-deliverable-integrity.mdc`.
5. `.cursor/rules/32-pr-branch-workflow.mdc` — **never commit to `main`.**
   Branch, PR, wait for Codex AND Copilot review, respond to every finding in
   the PR thread, then merge. Do not merge the moment CI goes green; the bots
   review a minute or two after. That mistake is already in this repo's history.

---

## 1. Where things stand

Merged and deployed as of `13a203b`:

- **#218** — zero-evidence runs are honest now. Corpus gate self-source metric
  corrected, source-origin classification fixed, synthesis telemetry restored,
  phase timing double-billing fixed, Stripe raw-body fallback removed, Featured
  Report admin-gated.
- **#219 / #220** — Clerk key checked at build time, not module scope. A missing
  key fails every build; a `pk_test_*` key is an accepted, logged trade-off
  while on Clerk's free plan; `REQUIRE_LIVE_CLERK_KEY=1` flips it to enforcing.
- **#221** — retrieval query construction no longer prefixes the whole objective
  onto every query. `services/reasoning/retrievalQueryPlan.ts` is new and owns
  seed extraction, composition and the diversity guard.
- **#222** — Rule 44.

Backend suite: **1196 passed / 7 skipped**. Both workspaces typecheck and lint
clean. Backend deploys to Emma on push to `main`; frontend deploys via Vercel.

### The live run that defines the remaining work

Run `b8265303-7492-4ff9-bbd5-cbbf387da7e2`, 22 Aug 2026, comparative intent,
six-item contract. **11m 49s, 233,563 prompt tokens, COMPLETED DEGRADED.** The
report itself was good — exactly six distinct methods, one real sortable table,
all six ranked, and it stated its own evidence limits without being asked.

What it exposed is below.

---

## 2. Work items, in priority order

### WO-AE-1 — Citations do not link. **Top priority; this is the demo blocker.**

**Evidence.** In run `b8265303`, the dossier Sources tab shows nine sources,
every one `FETCH SUCCESS / INGEST COMPLETED`, 10,319 chunks between them —
and **`CITED: NO` on all nine**, including
`https://www.ncbi.nlm.nih.gov/pmc/articles/PMC13082540/`, the MedDiscover paper
the report leans on entirely. The report cites "Chunk 11"; nothing connects
Chunk 11 to that URL.

So the evidence is real, the reasoning is sound, and a reader cannot follow a
single reference back to a source. For a product whose whole proposition is
verifiable research, that is the thing that has to work. It was invisible while
retrieval was returning zero chunks.

**Where to look.**

- `backend/src/services/research/dossierReadService.ts` ~line 517 computes the
  `cited_in_report` column: `EXISTS (SELECT 1 FROM report_citations rc WHERE
  rc.report_id = $2 AND (rc.source_id = s.id OR (rc.chunk_id IS NOT NULL AND
  rc.source_id IS NULL AND EXISTS (SELECT 1 FROM chunks c WHERE c.id =
  rc.chunk_id AND c.source_id = s.id))))`. So `NO` means: no `report_citations`
  row for that report resolves to that source.
- `backend/src/services/reasoning/citationMapper.ts` — `mapAndPersistCitations`,
  inserts at lines ~177 and ~199.
- `backend/src/services/reasoning/researchOrchestrator.ts` ~line 2664 — the
  call site, inside `if (shouldRunPipelineStage(orchProfile,
  'epistemic_persistence'))` and inside a **`try`**.

**Diagnose before fixing.** Three candidate causes; do not guess between them:

1. The stage threw and the `try` swallowed it. The trace for `b8265303` DOES
   show `epistemic_persistence 97% Persisting claims, contradictions, and
   citations...`, so it started.
2. It ran and produced zero mappings — the model returned nothing usable, or
   `chunkContextLimit` (default `min(chunks.length, 40)`) or the 250-char chunk
   preview starved it.
3. Rows were written with a `report_id` that does not match, or with both
   `chunk_id` and `source_id` null.

Query the database for run `b8265303` and its report id, and settle it with
data rather than reasoning.

**Fix, then make it impossible to regress silently.** Whatever the cause, the
deeper defect is that a report can ship with zero resolvable citations and
nothing notices. Add a check that runs after citation mapping: if the report
markdown contains chunk references but `report_citations` has no rows resolving
to a source, that is a **failure of the deliverable**, and must fail the run's
gate status or at minimum record a specific, reader-facing failure reason — not
be swallowed. See Rule 42: a gate may never be satisfied by a stub.

**Acceptance.** A live run over a corpus with evidence produces a report whose
Sources tab shows `CITED: YES` for the sources it drew on, and a run that
produces no resolvable citations does not report success.

---

### WO-AE-2 — Retrieval yield: 2 sources of 9 used

**Evidence.** Same run. The ingest barrier timed out at `7/10 queryable,
pending=3` after ~2 minutes, then retrieval drew **13 chunks from 2 sources**
while 9 sources holding 10,319 chunks sat available.

Query construction was fixed in #221, so the remaining causes are elsewhere.
Two candidates, both worth measuring:

**(a) The similarity floor.** `backend/src/config/index.ts` ~line 297:

```ts
minSimilarityDefault: (() => {
  const parsed = parseFloat(process.env.RETRIEVAL_MIN_SIMILARITY || '0.55');
  return Number.isFinite(parsed) ? Math.max(0.55, parsed) : 0.55;
})(),
```

Note the `Math.max(0.55, parsed)` — it is a **hard floor**, so the threshold
cannot be configured below 0.55 even deliberately. For
`openai/text-embedding-3-small` that is aggressive; genuinely relevant passages
routinely score 0.35–0.55.

Do NOT just lower it. Measure: run the same query at 0.55, 0.45 and 0.35 and
record chunk count, source count, and whether the extra chunks are on-topic.
Changing a relevance threshold without measuring trades one silent failure for
another. If a lower floor is justified, remove the `Math.max` clamp so the value
is honestly configurable and document the measured basis in the commit.

**(b) The ingest barrier.** `backend/src/services/discovery/discoveryIngestBarrier.ts`
— released on timeout with 3 sources still pending, and those sources were never
picked up by the later retrieval pass. #216 changed this to release on
sufficiency; check whether "sufficient" is being reached too early, and whether
stragglers are genuinely re-retrieved afterwards or merely claimed to be.

**Acceptance.** A live run draws chunks from a majority of the sources it
ingested, with the numbers recorded in the PR.

---

### WO-AE-3 — Reports titled by a structural label

**Evidence.** Run `b8265303`'s report is titled **"Dimensions Table"** — the
first section heading became the document title. The dossier card, the report
list and the export all carry it.

Two defects: the outline still emits structural labels ("Dimensions Table")
where a subject-specific heading belongs, and the title is taken from the first
heading rather than derived from the objective.

- `backend/src/services/openrouter/openrouterService.ts` — the
  `outline_architect` system prompt, which appears in **two** places
  (`withPreamble` and `withStandardPreamble`). Both must be updated; a previous
  change to this prompt was verified by checking that exactly 2 occurrences
  matched, and you should do the same.
- `backend/src/services/reasoning/reportGenerator.ts` — where the title is
  chosen.

**Acceptance.** A report's title names its subject. Add a test asserting a
structural label ("Dimensions Table", "Comparison Table", "Recommendation") is
never accepted as a title.

---

### WO-AE-4 — Rate limiting: layer per-user on top of per-IP

**Evidence.** `backend/src/api/app.ts` ~line 73: `/api/*` is 500 requests per
15 minutes, keyed by IP (express-rate-limit's default). Roughly a dozen React
Query hooks poll at 5–30s intervals, so **one tab watching one run consumes
most of its own budget** without the user doing anything.

Two independent problems, and the owner has already ruled on the design:

1. **Per-IP alone punishes shared egress.** Everyone behind one office NAT,
   university, or VPN exit shares a bucket.
2. **Per-user alone protects nothing** — anyone can create accounts. The owner
   was explicit: these are not mutually exclusive. **Layer both.** Keep the
   per-IP limit as the anti-abuse floor, and add a per-user ceiling for
   authenticated requests.

Also: `app.set('trust proxy', 1)` is correct for today's single Nginx hop, but
if Cloudflare is ever put in front of Emma it silently degrades to a single
global bucket. Add a comment stating the dependency, or derive it from config.

3. **Socket-aware polling backoff.** The Socket.IO connection already delivers
   live progress; the polling is redundant while it is healthy. Back the poll
   intervals off substantially when the socket is connected and receiving, and
   restore them when it is not. `frontend/src/utils/apiRateLimit.ts` already has
   `getAdaptiveRefetchIntervalMs`; extend it rather than adding a parallel
   mechanism.

**Acceptance.** One tab watching one run stays under 150 API requests per 15
minutes (WO-AD definition-of-done item 4, still unmet). Measure it in the
browser network panel and put the number in the PR.

---

### WO-AE-5 — Free-tier Supabase parity

**Context and constraint.** The owner is staying on Supabase's free plan until
there is revenue, and the requirement is explicit: **every app must behave
exactly as it would on Pro.** This is engineering work, not a compromise to
document.

Three free-tier behaviours differ from Pro. None of them changes how a feature
works; all three are operational properties to restore:

| Free-tier behaviour | Consequence | Mitigation |
| --- | --- | --- |
| Project pauses after 7 days idle | A paid Golden Goose Studio order arrives, Stripe fires its webhook at a paused project, the order never fulfils | A scheduled keep-alive that touches each project well inside the window |
| 1 day of log retention | Any incident older than 24 hours is unreachable — this already prevented a real investigation | A daily job exporting the log window to durable storage before it expires |
| No backups | Order and customer data has no recovery path | Scheduled `pg_dump` per project to storage the owner keeps |

Projects in scope: `golden-goose-studio` (Supabase project
`ftnhzjpyjvpyzetrcfht`, org `GoldenGooseTees`), plus the separate free accounts
for the other apps. **Note:** the free plan's two-project cap applies across
every organization where the owner is an owner or admin, which is why separate
accounts exist. Do not propose consolidating them.

Implement as scheduled jobs in whichever repo is the natural home, with the
schedule and the failure behaviour documented. A keep-alive that silently stops
running is worse than none.

**Also fix while you are in that project** (from a security-advisor pass):
leaked-password protection is disabled, and four `SECURITY DEFINER` functions
(`creator_handle`, `public_creator_points`, `public_design_counts`,
`qualifying_reuse_points`) are executable by `anon`. The
`rls_enabled_no_policy` findings on `generation_events` and `generation_quota`
are **intentional** — the migration deliberately does `REVOKE ALL … FROM anon,
authenticated` and the functions use `supabaseAdmin`. Leave those alone.

---

### WO-AE-6 — Run status surfaces disagree

**Evidence.** Run `b8265303` shows **`failed`** on the dossier card and
**`COMPLETED DEGRADED`** in the run summary. Both describe the same honest
outcome — fewer sources than the request required — but two surfaces give the
reader different words for it.

This is the same class of defect as #212, which `runStatusDisplay.ts` (backend
and frontend) was created to prevent. Find the surface that is not going through
those shared rules and route it through them.

**Acceptance.** Every surface showing a run's outcome derives it from the shared
display rules; add a test.

---

### WO-AE-7 — Verify the four unconfirmed definition-of-done items

These are from WO-AD and can only be closed by a live run against the current
`main`. Run one, and report each with evidence:

| # | Item | How to confirm |
| --- | --- | --- |
| 2 | Real citations with resolvable URLs/DOIs | Depends on WO-AE-1 |
| 5 | Live trace shows each event exactly once | The frontend dedup (`mergeTraceEvents`) only reached production at the end of the last run, so it has never actually been observed working. Watch the trace. |
| 6 | Phase timings match the event trace within 5% | Compare Run Summary phase durations against trace timestamps. The 2× double-billing is fixed; confirm. |
| 8 | Printing produces the report, all pages, no nav chrome | Print the report page. |

---

### WO-AE-8 — TruVector Core on Emma

`truvector-core` is application-ready and has no deployment path. It builds to
`dist/index.js`, listens on **port 3000**, and wants `DATABASE_URL` (Postgres +
pgvector) and `REDIS_URL` — the same shape as ResearchOne. It has a `Dockerfile`
and a single `ci.yml`. It has no PM2 entry, no deploy script, no deploy
workflow, and no nginx server block.

Model everything on ResearchOne, which already works:

1. **Own root and process.** `/opt/truvector` beside `/opt/researchone`, and its
   own `ecosystem.config.js` — app name `truvector-api`, port 3000,
   `max_memory_restart: '1G'`, own `logs/`. ResearchOne holds 3001, so no
   collision.
2. **Port the deploy script.** `scripts/deploy-runtime.sh` is the pattern: git
   sync, build, migrate, PM2 `startOrReload`, smoke test, preflight,
   `build-meta.json`. TruVector's pgvector table is created by
   `PgVectorStoreAdapter` at boot rather than by a migration runner, which
   simplifies this.
3. **Deploy workflow.** Copy `.github/workflows/deploy-backend-emma.yml` into
   the truvector-core repo. It already takes `EMMA_HOST`, `EMMA_USER`,
   `EMMA_SSH_KEY` and an overridable `EMMA_DEPLOY_PATH`, so the same VM
   credentials work pointed at the new root.
4. **Hostname.** A second nginx server block proxying to 3000 with its own
   certificate. Model on `scripts/nginx/researchone-api-site.conf`, which
   already sets `X-Real-IP` and `X-Forwarded-For` correctly and handles
   websocket upgrade.
5. **Separate data, shared servers.** Its own Postgres database and its own
   Redis logical DB (`redis://127.0.0.1:6379/1` — ResearchOne holds 0) on the
   same instances. Separate databases keep migrations and backups independent;
   shared servers keep the memory budget sane.

**Hardware.** Nobody has measured Emma. Run this on the VM and put the output in
the PR before proposing a resize:

```bash
free -h; nproc; df -h /
pm2 list
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size(current_database()));"
sudo -u postgres psql -c "SHOW shared_buffers; SHOW effective_cache_size;"
redis-cli info memory | head -5
vmstat 1 5
```

Derived estimate to check the measurements against, not to substitute for them:
two Node APIs at ~1–1.5 GB each, ResearchOne's 98k×1536 float vectors ≈ 604 MB
before the HNSW graph (which typically adds 1.5–2× again and wants to stay
resident), a second corpus, Redis, and OS headroom. That lands near **16 GB /
8 vCPU / 80–100 GB disk**, with 8 GB the tight minimum. texlive-xetex alone is
2–4 GB of that disk.

---

### WO-AE-9 — Housekeeping

Roughly **170 stale remote branches** on `ResearchOne`, mostly merged
`cursor/*` and `copilot/*` work. Prune the ones whose PRs are merged or closed.
Do this in its own PR and list what is being deleted.

---

## 3. Definition of done

1. A live run produces a report whose sources show `CITED: YES`, and a run with
   no resolvable citations cannot report success.
2. A live run draws chunks from a majority of the sources it ingested, with
   before/after numbers in the PR.
3. No report is titled by a structural label.
4. One tab watching one run stays under 150 API requests per 15 minutes,
   measured.
5. Per-IP and per-user rate limits are layered, not substituted.
6. Keep-alive, log export and backup jobs are running and their failure
   behaviour is documented.
7. Every run-outcome surface derives its wording from the shared display rules.
8. WO-AD items 5, 6 and 8 confirmed by observation, with evidence.
9. `truvector-core` deploys to Emma by workflow, serves on its own hostname,
   and Emma's real resource numbers are recorded.
10. Both workspaces pass, from the repository root:
    ```bash
    (cd backend  && npm run typecheck && npm run lint && npm test)
    (cd frontend && npm run typecheck && npm run lint && npm test)
    ```
11. Rule 32 respected throughout — branch and PR, never a direct push to
    `main`, and every Codex and Copilot finding answered in the PR thread before
    merge.
12. Rule 44's self-check run before each push, and the T1 question answered
    honestly for each new test: **does it fail if the fix is reverted?** Revert
    and run to find out. Do not reason about it — that is exactly how four of
    the eighteen findings above got through.

## 4. One piece of advice from the session that preceded you

The most expensive mistakes in this work were not wrong code. They were
verifications shaped like the fix: a test that ran the failing command and
recorded it as the guarantee, a regression test whose example took a different
branch than the defect it covered, a Unicode test that passed because both
inputs collapsed to the same single token. Each one produced *false confidence*,
which is worse than no coverage, because it stops anyone looking.

When you fix something, break it again on purpose and watch your test fail.
