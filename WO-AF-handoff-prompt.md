# WO-AF — Run Workspace & Active-Run Navigation

You are picking up work on **ResearchOne** (`GooseyPrime/ResearchOne`), a
multi-agent research platform. Read this whole prompt before touching code.
It carries one standing task that never completes, and one new goal.

Repo state at handoff: `main` @ `60bfd6f`. Previous work order:
`WO-AE_COPILOT_BRIEF.md` (merged as PR #224).

---

## 0. Working constraints — not negotiable

| Rule | What it means in practice |
|------|---------------------------|
| **Rule 32** | Never commit to `main`. Branch via the helper (see §3), then PR. |
| **Review protocol** | **Do not merge until both Codex and Copilot have reviewed AND you have replied to every finding in the PR thread.** A previous session merged before reviews landed. Do not repeat that. |
| **Fix only what's appropriate** | Answer every finding, but only *implement* the ones that are right for the system. A verified false positive gets a reasoned reply in-thread, not a compliance change. |
| **Free tier until revenue** | Supabase, Clerk — free tier everywhere. Make the free tier behave like Pro at lower volume. Do not propose paid upgrades. |
| **Rule 44** | Run the full self-check before requesting review. See §1. |

The operator's standing instruction on scope: *"you need to suck it up and
complete them ONLY if they are appropriate to the function of the system."*

---

## 1. STANDING TASK — the Codex/Copilot defect log

**This never completes. It is part of every PR from now on.**

`.cursor/rules/44-pre-review-self-check.mdc` is a living log of the *themes* of
defect that automated review keeps catching. Its purpose, from the file itself:

> A reviewer spending its pass on a dead import and an ASCII-only regex is a
> reviewer **not** spending it on the architecture. Shallow defects crowd out
> deep review.

The operator's framing: *"if you are the one constantly making the shallow
errors, then that's all they will catch."*

### Your obligations

1. **Before requesting review on any PR**, work the self-check at the bottom of
   Rule 44. All of it — not a subset because the change is small. Several logged
   defects came from one-line changes.
2. **After every review round**, add any *new* theme to Rule 44 with concrete
   evidence (file, what it did, what it broke) and a check that would have caught
   it. Reference the PR number.
3. **Do not let the log become a list of individual bugs.** It is a list of
   *classes*. If a finding fits T1–T9, add a bullet under that theme rather than
   inventing T10.

### Current themes — check your own diff against these

| | Theme | The check |
|---|---|---|
| **T1** | Verification shaped like the fix | Which new test fails if you revert the fix? Run the failing case *first* and watch it fail. When you revert a bad change, grep for every test edited in the same commit. Testability is part of the fix. **And: a documented command is a verification artifact — run it before you paste it.** |
| **T2** | A cheap syntactic proxy for a semantic property | Name the property in a sentence. If the sentence is about meaning and the code measures length, position, or ASCII shape — which real input breaks it? |
| **T3** | Incomplete enumeration | Grep for every producer and consumer. "The ones I know about" is not the list. |
| **T4** | Substituting a check without preserving what it protected | Write down what the old check prevented. Does the new one prevent it too? |
| **T5** | One condition doing two jobs | Two reasons to fire = two conditions. |
| **T6** | Reversing the instruction while implementing it | Re-read the work order's own words *after* writing the change. Disagree in the PR; don't overrule silently. |
| **T7** | Recreating a shared object from a remembered subset | Start from the current definition text. Diff old vs new mechanically. |
| **T8** | Ops code that cannot fail loudly | What does it log on non-2xx? What if it throws before the first try/catch? What does it exit with? `&& … \|\| …` is error laundering. |
| **T9** | Untrusted config reaching a privileged sink | Trace values to where they're *used*. Check the sanitizer's `catch` — a third outcome that hands the input back means it only *usually* sanitizes. |

### Two live examples in the code you're about to touch

- **T3 is shipped to production here.** See §2.4: three surfaces normalize trace
  events; the run page does not.
- **T1 bit this very handoff.** Its first draft copied Rule 44's gate commands
  verbatim, and both reviewers caught that the block was broken — the commands
  had never been executed by anyone. Rule 44 has since been fixed. Treat every
  snippet you paste as unverified until you run it.

---

## 2. NEW GOAL — the research run workspace

### 2.1 The complaint, in the operator's words

> Currently, the user loses view of the live research trace if the user visits
> another page within the site and the only way to view the activity again is to
> click the status pill button in the header menu beside the user icon. Even then
> a horribly formatted page opens where the original request is written unstyled
> in large bold font. The agent activity shown at the bottom of the page is
> appending to a table as opposed to a nice scrollable view window that was on
> the request page when the active run started.

And the forward-looking requirement:

> Each new request should spawn into its own window workspace, especially since
> we may be adding concurrent report runs for a new higher tier of user.

### 2.2 What you are being asked to do

1. **Plan** what pages, information, and functions should exist on a research
   run's page — treating each run as its own workspace.
2. **Implement** a better user flow for moving around the site during active
   runs, with proper links to the main request page and to active run pages
   **without going through the Dossiers page**.

Plan first. Show the plan to the operator. Then build.

### 2.3 Observed evidence (production screenshots)

**`/app/run/36b25d18-…`** — where the status pill leads:

- The **entire raw research prompt** renders as an `<h1>` in bold. Thousands of
  characters, literal markdown (`#`, `**`, `---`) shown as text. No truncation,
  no collapse, no derived title.
- The left ~45% of the viewport is **empty**; content is jammed right. The
  layout is broken, not merely ugly.
- No trace panel visible above the fold.
- Run identity is a raw uppercase UUID.
- No link back to the request page. No link to any other run.

**`/app/run/2d45d698-…`** scrolled down — the agent activity list:

- Events are **duplicated**. `Report section 6/25` at `3:58:28 PM` appears at
  least three times, along with 5/25, 4/25, 3/25, 2/25 — same text, same
  timestamps.
- Events are **out of chronological order**. `9/25` at `3:59:06` renders between
  `1/25` at `3:57:18` and `8/25` at `3:58:51`.
- It is an unbounded flat list of bordered rows — the "table" the operator
  describes — with **no scroll container**. It grows the page instead of
  scrolling within a panel.

### 2.4 Where trace normalization actually lives — read this before designing

There is a shared dedup/ordering utility, `frontend/src/utils/traceEventWindow.ts`
(`mergeTraceEvents`, `traceEventKey`). **It is called by the state owners, not by
the renderer.**

| | Request-page path (works) | `/app/run/:runId` (broken) |
|---|---|---|
| State owner | `pages/ResearchStandardPage.tsx`, `pages/ResearchDeepPage.tsx` — both import `mergeTraceEvents` and define a local `sortEventsChronological` | `components/r1-dashboard/LiveRunPanel.tsx` — owns its own state |
| Dedup | `mergeTraceEvents` on both the socket and poll paths | **None.** `setActivities((prev) => [progressToActivity(raw), ...prev].slice(0, 12))` |
| Ordering | `sortEventsChronological` before render | Naive prepend, newest-first, no sort |
| Renderer | `components/research/LiveResearchTraceLog.tsx` — **presentational only**; takes a `traceEvents` prop and owns the scroll container (`max-h` + `overflow-y-auto`) | Inline flat list, no scroll container |

`ReportRevisionWorkspacePage.tsx` also uses `mergeTraceEvents`. So **three
surfaces normalize and one does not** — textbook Rule 44 T3.

**The trap this creates:** swapping `LiveRunPanel` to render
`LiveResearchTraceLog` will *not* fix duplicates or ordering, because the
renderer never did that work. You must move or share the parent-level
normalization too. Codex flagged exactly this risk on the first draft of this
handoff.

### 2.5 Trace backfill — the read path already exists

Do **not** design a new endpoint. `GET /api/research/:id` already returns the run
row including a **`progress_events`** array (typed on `ResearchRun` in
`frontend/src/utils/api.ts`), and `frontend/src/hooks/useAttachResearchRun.ts`
already hydrates trace state from it via `eventsFromRunRow(run)`.

`LiveRunPanel` simply does not use any of this: `activities` initialises to `[]`
and fills only from socket events received *while the component is mounted*.
Navigate away and back and the history is gone. **That — not the styling — is
the actual "loses view of the live research trace" bug**, and the fix is reusing
an existing read path, not building one.

### 2.6 Other concrete defects in `LiveRunPanel.tsx`

Verify each yourself; don't take this list on faith.

1. **`<h1>{run.query}</h1>`** at ~line 133, `text-xl sm:text-2xl font-bold` —
   the wall of bold text. A run needs a *display title*. Note the backend has
   `deriveGeneratedReportTitle` in `services/reasoning/reportGenerator.ts`, but
   it derives from report markdown, which doesn't exist mid-run. What titles an
   in-flight run is a real design question, not a formatting tweak.
2. **`onCompleted` force-navigates to `/app/dossiers`** after 1.5s, yanking the
   user off the page they were reading.
3. **No navigation affordances** — no link to `/app/research`, no list of other
   active runs, no breadcrumb.

### 2.7 Routing as it stands

```
/app/research            → ResearchPage      (the good trace lives here)
/app/run/:runId          → LiveRunPage       → LiveRunPanel (broken)
/app/dossiers            → DossiersPage
/app/dossiers/:id        → DossierDetailPage
/app/reports/run/:runId  → FailedRunReportPage
```

`frontend/src/utils/researchRunRoutes.ts` is the canonical route-helper module.
Use it; don't hand-roll paths alongside it.

**The loop you need to untangle:**

- `components/research/ActiveRunBadge.tsx` (the header pill) links to
  `liveResearchUrl(runId)` = **`/app/research?runId=<id>`**
- but `ResearchPage` **redirects `?runId=` to `/app/run/:runId`**
  (asserted in `frontend/src/__tests__/pages/ResearchPage.test.tsx`)
- so the pill always lands the user on the broken page, with no path back.

Decide deliberately which surface is canonical. Right now the codebase asserts
both and the redirect silently wins.

### 2.8 Concurrency — plan for it now, even if it ships later

`frontend/src/store/useStore.ts` exposes a **singular** `activeRun`, and
`ActiveRunBadge` returns `null` unless `activeRun?.runId` is set. That models
exactly one run. The higher tier the operator described needs *N* concurrent runs.

Your design should not require a second rewrite to support concurrency. That
doesn't mean building the paid tier now — it means not baking the single-run
assumption any deeper than it already is.

### 2.9 A discrepancy to resolve before you plan

`LiveRunPanel.tsx` on `main` caps activities at 12 (`.slice(0, 12)`) and centres
content in `max-w-[1400px] mx-auto`. **Neither matches the screenshots**, which
show dozens of rows and an off-centre layout. Either the deployed build is behind
`main`, or something else is rendering that route.

**Reproduce in the browser and confirm which code actually serves
`/app/run/:runId` before designing against it.** Do not plan against a file you
have not confirmed is running.

### 2.10 Questions the plan must answer

Answer these explicitly before writing code:

- **What is a run workspace?** A route? A tab? A persistent panel? What does its
  URL look like, and is it shareable and bookmarkable?
- **What does a run page show** while queued / plan-pending / running / complete /
  failed? Each state needs a real answer, not a spinner.
- **What titles an in-flight run?** And what does the user see instead of the raw
  prompt — is it available on demand, collapsed, rendered as markdown?
- **Where does normalization live** once there's one canonical surface? A shared
  hook, a context, or the store? (See the §2.4 trap.)
- **How does a user move between runs** without going through Dossiers? What does
  the header show with three active runs instead of one?
- **What happens on completion?** The current forced redirect is wrong. What
  replaces it?
- **What is the canonical live-run surface**, and what happens to the other one?
  Consolidating is likely right — but Rule 44 T4 applies: write down what the
  surface you delete protected, and confirm the survivor still does it.

### 2.11 Definition of done

1. A user can start a run, navigate anywhere, and return to a **full** live trace
   — including events that arrived while they were away.
2. Every trace event appears **exactly once**, in chronological order, in a
   scrollable panel that does not grow the page.
3. No run page displays a raw prompt as its heading.
4. Active runs are reachable from the header **without** going through Dossiers,
   and the path from the pill lands somewhere useful and stays there.
5. Run completion does not navigate the user away from what they are reading.
6. The design supports more than one concurrent run without a rewrite.
7. All live-run surfaces share one normalization implementation, or only one
   surface remains.
8. Rule 44 self-check run in full; new themes logged; both bots reviewed and
   every finding answered in-thread before merge.

---

## 3. Starting checklist

Branch via the repo helper — `AGENTS.md:26-30` makes this binding. A bare
`git checkout -b` discards a pre-assigned branch and skips the restricted-ref
handling.

```bash
git fetch origin
bash scripts/git/prepare-work-branch.sh <topic-slug>        # add --reuse if a branch is pre-assigned
```

Gates, from the repo root. Each workspace in its own subshell — chaining
`cd backend && …` then `cd frontend && …` leaves the shell inside `backend/`
and the second line silently looks for `backend/frontend`:

```bash
( cd backend  && NODE_ENV=test npm run typecheck && npm run lint && npm run test )
( cd frontend && npm run typecheck && npm run lint && npm run test )
```

Use the repo's own npm scripts, not hand-rolled `npx` equivalents — frontend
lint is `eslint src --report-unused-disable-directives --max-warnings 0`, so
`npx eslint src --quiet` passes on exactly the warnings CI fails on.

Baseline on `main`: backend **1325 tests** pass, frontend **308** pass, lint clean
in both.

### Environment notes

- The working clone is on the operator's Windows machine at
  `C:\Users\brand\Projects\ResearchOne` — reachable via the desktop bridge, not
  the cloud container. `device_bash` cannot reach github.com; use PowerShell via
  Desktop Commander for `git`, `gh`, and `npm`, or Git Bash at
  `C:\Program Files\Git\bin\bash.exe` for shell scripts.
- PowerShell mangles complex inline quoting badly (`&&`, `$?`, nested quotes).
  Write a `.ps1` or `.sh` file and execute it. Write commit messages to a file
  and use `git commit -F`.
- Backend tests need `NODE_ENV=test` or `loadEnv` throws on the missing `.env`.
- A full gate run per workspace takes ~45–60s; the tool call will time out if you
  chain both. Run them separately or in the background and poll.
- GitGuardian scans **every commit in a PR**, not just the head. A secret-shaped
  string removed in a later commit still fails the check — squash it out.

---

## 4. First actions, in order

1. Read `.cursor/rules/44-pre-review-self-check.mdc` in full.
2. Reproduce both screenshots in the browser and **resolve the §2.9 discrepancy** —
   confirm which component actually serves `/app/run/:runId` in production.
3. Verify each defect in §2.4–2.6 against the confirmed source.
4. Write the plan answering every question in §2.10. Show it to the operator
   before implementing.
5. Implement. Gates. Rule 44 self-check. PR. Both reviews. Reply to every
   finding. Then merge.
