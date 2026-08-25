# WO-AF — Run workspace plan

Branch: `cursor/run-workspace` (base `origin/main` @ `cc177dd`).
Status: **plan for review. No product code changed yet.**

---

## 1. §2.9 resolved — there is no deploy skew

The handoff offered two explanations for the screenshots not matching `main`
("the deployed build is behind `main`, or something else is rendering that
route"). Both are wrong. There is a third, and it is the actual one.

**What serves the route.** `App.tsx:90` maps `run/:runId` → `LiveRunPage`,
which renders `LiveRunPanel` and nothing else. It is the only mapping in the
router.

**The deployed build is current.** Vercel project `research-one`
(`prj_IjJpVRg7BXyUpqQnzNgDe3tE1CcL`) has production at
`dpl_BAUNFDhSYK1RwfdeuxUJ2QFQppDp`, READY, built from `main` @ `cc177dd`.
`LiveRunPanel.tsx` was last modified on 2026‑06‑02 (`c492db7`), months before
that deployment. The file on `main` **is** the file in production.

**So why do the screenshots show more than 12 rows?** Because `.slice(0, 12)`
bounds the *state array*, and the *DOM* is not bounded by it.

I wrote a throwaway reproduction against the real component (jsdom, mocked
socket + `getResearchRun`) and ran the failing cases before designing
anything. All five failed:

| Case | Asserted | Actual on `main` |
|---|---|---|
| A | persisted `progress_events` appear on mount | **nothing** — trace starts empty |
| B | one event delivered 3× renders once | **5 rows** from 3 duplicate emits |
| C | events render chronologically | reverse **arrival** order |
| D | 20 distinct events → 20 rows | 12 rows — the cap *does* hold |
| E | activity list sits in a scroll container | no scroll container |

Case B is the finding. Three duplicate emits produce **five** DOM rows, and
React says why:

```
Warning: Encountered two children with the same key,
`2026-08-23T15:58:28.000Z-reasoner`.
    at AnimatePresence (framer-motion/.../AnimatePresence/index.mjs:44:28)
    at LiveRunPanel (src/components/r1-dashboard/LiveRunPanel.tsx:36:55)
```

`progressToActivity` builds `id` as `` `${timestamp}-${stage}` `` — not unique
across a run. `AnimatePresence` keys its present/exiting maps on that id, so a
collision leaves ghost children mounted that no state update can remove. The
rendered list therefore grows past the 12-item cap and shows rows in stale
positions. **Duplicate keys, not just missing dedup, are the root cause of both
the duplication and the scrambled order in the screenshots.**

That matters for the fix: adding `mergeTraceEvents` to `LiveRunPanel` and
keeping the `AnimatePresence` list would leave the amplification in place.

### The off-centre layout — looked at production, does not reproduce

I opened the live app in your Chrome, clicked the header pill, and landed on
`/app/run/f1e74c06-53d3-44a6-b095-d15fb703dd99` (a queued V2 run). Measured DOM,
viewport 1681x1328:

```
main   left:180 clientW:1501 scrollW:1501 overflow-x:auto
wrap   leftInMain:51  width:1400  rightGap:51
h1     437 chars  scrollW:1352 == clientW:1352   (no overflow)
```

`leftInMain` 51 and `rightGap` 51 — **perfectly centred, no horizontal
overflow**. I had a hypothesis (a long unbroken token in the prompt forcing
`main` to scroll sideways; `overflow-y-auto` does compute `overflow-x` to
`auto`, so the mechanism is real) and tested it in headless Chromium: a
300-character token does produce overflow — `scrollWidth` 5372 vs 1680 — but
the `mx-auto` box stays at `left: 140px` regardless. **Hypothesis falsified,
and the symptom does not appear live.**

`mx-auto` centres symmetrically at every width, so this CSS cannot produce
"left 45% empty, jammed right" on any monitor. Something else was in that
screenshot — a horizontal scroll position, a crop, or a different state.

Could you re-share it? Meanwhile the real visual problems on that page, which
I did see, are in §2.

---

## 2. Other verified defects

Everything in §2.4–2.6 checks out, plus three the handoff did not list.

- `LiveRunPanel.tsx:75` — `[progressToActivity(raw), ...prev].slice(0, 12)`.
  No dedup, no sort, no backfill. Confirmed by cases A–D.
- `LiveRunPanel.tsx:82` — `setTimeout(() => navigate('/app/dossiers'), 1500)`.
- `LiveRunPanel.tsx:135` — `<h1 className="text-xl sm:text-2xl font-bold">{run.query}</h1>`.
- `ActiveRunBadge.tsx:28` → `liveResearchUrl()` → `/app/research?runId=` →
  `ResearchPage.tsx:51` → `<Navigate to={/app/run/:runId} replace />`. The pill
  takes two hops to reach a page with no way back.
- `useStore.ts:8` — `activeRun` is singular; `Layout.tsx:153-175` computes the
  **full** in-flight list and then discards all but the top-priority one. The
  data for concurrency is already being fetched and thrown away.

New, not in the handoff:

- **`ReportRevisionWorkspacePage.tsx:139` is a fourth surface, and it is half
  normalized** — it calls `mergeTraceEvents` but never sorts chronologically.
  The handoff's "three surfaces normalize and one does not" is off by one in
  both directions: three dedup, only two sort. T3 again.
- **`run.title` is not a title.** `backend/src/api/routes/research.ts:337` sets
  `const title = researchQuery.slice(0, 200)`. Any plan that reaches for
  `run.title` as a display title is reaching for the raw prompt, truncated. A
  shipped T2: a length proxy standing in for "what is this run about".
- **The raw prompt is not only the run page's problem — it is in the Dossiers
  library too.** Live, the dossier cards read `# Research Objective: Identify
  and Rank the 20 Best Affiliate Comparison-Site…`, markdown `#` and all. Four
  separate surfaces each reach for `query`/`title` and each get the prompt.
  This is why titling cannot be a client-side patch (see §3).
- **`mapApiRunToVaultRun` fabricates three fields.** `sourcesRetrieved: 0`,
  `contradictionsDetected: 0`, `evidenceTier: 'supported'` are hardcoded, and
  the run page renders that last one as a live "Source corroboration tier:
  SUPPORTED" badge for every run. That is a confident claim about evidence
  quality that no evidence produced. **Confirmed live:** the queued run above,
  0% progress and zero sources retrieved, displays
  `Source corroboration tier: SUPPORTED`.

---

## 3. The plan — answers to §2.10

### What is a run workspace?

**A route.** `/app/run/:runId`, unchanged — it is already linked from four
places and bookmarked. Shareable and bookmarkable, one run per URL. Not a tab,
not a modal: concurrency then costs nothing, because N runs are N URLs.

`/app/run/:runId` becomes **the** canonical live surface for every run state,
including plan review. `/app/research` goes back to being what its name says:
where you compose a new request.

*T4 write-down — what the surface I am demoting protects.* Today
`/app/research?runId=…#plan` renders `ResearchStandardPage` / `ResearchDeepPage`,
which own: the plan confirmation gate, trace normalization, the run summary
report, failure UI, and engine-specific (v1/v2) behaviour. Those are
capabilities, not a page. The migration **moves** them to the workspace; it
does not delete them. The redirect in `ResearchPage.tsx` stays as permanent
back-compat for old links, and its test stays.

### Where does normalization live?

**One hook: `useRunTraceStream(runId)`**, and the pages stop owning trace state
entirely.

It owns hydration from `GET /api/research/:id` `progress_events` (reusing
`eventsFromRunRow`), the socket subscription, the poll merge, `mergeTraceEvents`
for dedup, and chronological sort — the local `sortEventsChronological`
duplicated in `ResearchStandardPage` and `ResearchDeepPage` moves into it.
Backed by the react-query cache so the buffer survives unmount and remount.

This is the §2.4 trap handled properly. Swapping in `LiveResearchTraceLog`
alone fixes nothing, because the renderer never did this work. Making the
*state* shared is what fixes it — and it makes T3 structurally impossible here,
since a surface can no longer diverge from an implementation it does not own.

It is also per-`runId` by construction, so N concurrent runs need no new
mechanism.

### One renderer

`LiveResearchTraceLog` — already presentational, already owns its scroll
container (`max-h` + `overflow-y-auto`), already keys rows uniquely
(`${timestamp}-${stage}-${idx}`). `LiveRunPanel`'s inline `AnimatePresence`
list is **deleted**, which is what removes the ghost rows.

### What titles an in-flight run?

Neither `query` nor `title` — both are the raw prompt
(`backend/src/api/routes/research.ts:337`). And the title is **persisted on the
run, not derived per client.**

You pushed back on my first answer here and you were right. A run's title is a
property of the run. Deriving it client-side means the run page, the Dossiers
cards, the header popover, and anything later (email, notification, export)
each implement it separately — four consumers of one mapping with four
implementations, which is T3 by construction, and the Dossiers screenshot shows
the cost of that pattern already shipped.

So: **`research_runs.display_title`**, migration 057.

- Written when the planner produces topic analysis (the plan gate already has
  a topic summary, so nothing new is computed).
- Backfilled at report generation from the existing
  `deriveGeneratedReportTitle`, so completed runs converge on the report title.
- `NULL` until planning produces one; every reader falls back to `run_ref`
  (`R1-20260823-1557-XXXXX-C`), already assigned to every run and already the
  value a user quotes to support.
- Exposed on `GET /api/research/:id` and the run list. The frontend reads one
  field, in every surface, and no client derives anything.

The raw prompt moves into a collapsed **"Request"** disclosure below the
heading: rendered as markdown, `break-words`, own max-height and scroll.
Available on demand, never the page heading.

Dossiers cards read the same field, which fixes those titles as a side effect.

### What does the page show in each state?

| State | Primary content | Primary action |
|---|---|---|
| `queued` | position, request summary, trace (empty state names what happens next) | Cancel |
| `plan_pending_confirmation` | the plan gate, inline | Confirm / Edit |
| `running` | stage pipeline + live trace | — (trace is the content) |
| `completed` | completion banner, full trace retained | **Open report** |
| `failed` | failure reason + retryable badge, trace retained | Retry / Open diagnostics |
| `cancelled` / `aborted` | why it stopped, trace retained | Start a new run from this request |

No state is a bare spinner.

### How does a user move between runs?

- The header pill links **straight to `/app/run/:runId`**. `liveResearchUrl()`
  is changed to build that path, so there is one canonical builder and the
  two-hop redirect stops happening for new links.
- With more than one in-flight run, the pill becomes a **popover list** (your
  call) — count badge, one row per run (title, stage, percent), plus "New
  request". With exactly one it click-throughs as today.
- The workspace itself gets a rail: **New request** (`/app/research`), other
  in-flight runs, and **Open dossier** once complete. Dossiers is never on the
  path between two runs.
- `useStore` gains `activeRuns: ActiveRunSummary[]` with a derived
  `primaryActiveRun` selector, so existing consumers keep working while the
  singular assumption goes away. `Layout.tsx` already computes this list — it
  stops discarding it.

### What happens on completion?

Nothing navigates. The forced `navigate('/app/dossiers')` is replaced by an
in-place transition: a "Report ready" banner and an **Open report** button
(`dossierReportUrlForRun`). The trace stays on screen and stays scrollable.

*T4:* the redirect protected nothing, but it did guarantee the user reached the
report. The banner and button preserve that reachability without stealing the
page they were reading.

---

## 4. Definition of done → how each item is met

| # | Item | Met by |
|---|---|---|
| 1 | full trace after navigating away and back | `useRunTraceStream` hydrating from `progress_events` |
| 2 | each event once, chronological, scrollable | shared merge+sort; `LiveResearchTraceLog`; the duplicate-key list deleted |
| 3 | no raw prompt as heading | `runDisplayTitle` + collapsed Request disclosure |
| 4 | active runs reachable from header, path lands and stays | `liveResearchUrl` → `/app/run/:runId`; popover for N runs |
| 5 | completion does not navigate away | banner + Open report |
| 6 | supports concurrency without a rewrite | per-`runId` hook; `activeRuns` list in the store |
| 7 | one normalization implementation | the hook; all four surfaces consume it |
| 8 | Rule 44 self-check, both reviews, every finding answered | before requesting review, and before merge |

## 5. Sequencing

1. Migration 057 `research_runs.display_title`; write at plan confirmation;
   backfill at report generation; expose on the run read paths. Backend tests.
2. `useRunTraceStream` + tests (the five reproduction cases become the
   regression suite — each currently fails, which is the point).
3. `LiveRunPanel` rewritten onto the hook and `LiveResearchTraceLog`; title
   from `display_title`, Request disclosure, completion behaviour, and the
   fabricated corroboration-tier badge removed.
4. `ResearchStandardPage` / `ResearchDeepPage` / `ReportRevisionWorkspacePage`
   migrated onto the hook; the two local `sortEventsChronological` copies and
   the unsorted merge deleted.
5. Store `activeRuns`; header popover; workspace rail; `liveResearchUrl`.
   Dossiers cards switched to `display_title`.
6. Plan gate moved into the workspace (scope depends on Question A).
7. Gates, Rule 44 self-check, PR.

## 6. Decisions

- **A — open.** Does the plan-confirmation gate move to `/app/run/:runId`?
  See the explanation in chat. Everything else is unaffected either way.
- **B — decided.** Header: one pill with a popover list.
- **C — decided.** Server-side `display_title`, not client-side derivation.
- **D — closed.** Off-centre layout does not reproduce live; see §1.
