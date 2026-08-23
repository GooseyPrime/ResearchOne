# WO-AF — Run Workspace & Active-Run Navigation

**Handoff to a new Cowork session.** Read this whole file before touching code.
It carries one standing task that never completes, and one new goal.

Repo: `GooseyPrime/ResearchOne` · Branch point: `main` @ `fdd81e5`
Previous work order: `WO-AE_COPILOT_BRIEF.md` (merged as PR #224)

---

## 0. Working constraints — these are not negotiable

| Rule | What it means in practice |
|------|---------------------------|
| **Rule 32** | Never commit to `main`. Branch + PR, always. Including docs. |
| **Review protocol** | **Do not merge until both Codex and Copilot have reviewed AND you have replied to every finding in the PR thread.** A previous session merged before reviews landed. Do not repeat that. |
| **Fix only what's appropriate** | Answer every finding, but only *implement* the ones that are right for the system. A verified false positive gets a reasoned reply in-thread, not a compliance change. Say so plainly. |
| **Free tier until revenue** | Supabase, Clerk — free tier everywhere. Make the free tier behave like Pro at lower volume. Do not propose paid upgrades. |
| **Rule 44** | Run the full self-check before requesting review. See §1. |

The operator's standing instruction on scope: *"you need to suck it up and complete them ONLY if they are appropriate to the function of the system."*

---

## 1. STANDING TASK — the Codex/Copilot defect log

**This task never completes. It is part of every PR from now on.**

`.cursor/rules/44-pre-review-self-check.mdc` is a living log of the *themes* of
defects automated review keeps catching. Its purpose is stated in the file and
worth restating, because it is easy to mistake for tidiness:

> A reviewer spending its pass on a dead import and an ASCII-only regex is a
> reviewer **not** spending it on the architecture. Shallow defects crowd out
> deep review.

The operator's framing: *"if you are the one constantly making the shallow
errors, then that's all they will catch."*

### Your obligations

1. **Before requesting review on any PR**, work the self-check at the bottom of
   Rule 44. All of it. Not a subset because the change is small — several logged
   defects came from one-line changes.
2. **After every review round**, add any *new* theme to Rule 44 with the concrete
   evidence (file, what it did, what it broke) and a check that would have caught
   it. Reference the PR number.
3. **Do not let the log become a list of individual bugs.** It is a list of
   *classes*. If a new finding fits T1–T9, add it as a bullet under that theme
   rather than inventing T10.

### Current themes (T1–T9) — check your own diff against these

| | Theme | The check |
|---|---|---|
| **T1** | Verification shaped like the fix | Which new test fails if you revert the fix? Run the failing case *first* and watch it fail. When you revert a bad change, grep for every test edited in the same commit. Testability is part of the fix. |
| **T2** | A cheap syntactic proxy for a semantic property | Name the property in a sentence. If the sentence is about meaning and the code measures length, position, or ASCII shape — which real input breaks it? |
| **T3** | Incomplete enumeration | Grep for every producer and consumer. "The ones I know about" is not the list. |
| **T4** | Substituting a check without preserving what it protected | Write down what the old check prevented. Does the new one prevent it too? |
| **T5** | One condition doing two jobs | Two reasons to fire = two conditions. |
| **T6** | Reversing the instruction while implementing it | Re-read the work order's own words *after* writing the change. Disagree in the PR, don't overrule silently. |
| **T7** | Recreating a shared object from a remembered subset | Start from the current definition text. Diff old vs new mechanically. |
| **T8** | Ops code that cannot fail loudly | What does it log on non-2xx? What if it throws before the first try/catch? What does it exit with? `&& … \|\| …` is error laundering. |
| **T9** | Untrusted config reaching a privileged sink | Trace values to where they're *used*. And check the sanitizer's `catch` — a third outcome that hands the input back means it only *usually* sanitizes. |

### Why this matters for WO-AF specifically

**T3 is already live in production on the code you are about to touch.** See §2.4:
the trace-event dedup fix was applied to one of the two trace renderers and not
the other. That is incomplete enumeration, shipped, and the operator is looking
at the result.

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

### 2.2 What the operator asked you to do

1. **Plan** what pages, information, and functions should exist on a research
   run's page — treating each run as its own workspace.
2. **Implement** a better user flow for moving around the site during active
   runs, with proper links to the main request page and to active run pages
   **without going through the Dossiers page**.

Plan first. Show the plan. Then build it.

### 2.3 Observed evidence (two screenshots from the operator, production)

**`/app/run/36b25d18-…`** — the page the status pill leads to:

- The **entire raw research prompt** is rendered as an `<h1>` in bold. Thousands
  of characters. Literal markdown (`#`, `**`, `---`) shown as text, unrendered.
  No truncation, no collapse, no derived title.
- The left ~45% of the viewport is **empty black**; all content is jammed into the
  right portion. The layout is broken, not merely ugly.
- No trace panel visible above the fold at all.
- Run identity is a raw uppercase UUID.
- No link back to the request page. No link to any other run.

**`/app/run/2d45d698-…`** scrolled down — the agent activity list:

- Events are **duplicated**. `Report section 6/25` at `3:58:28 PM` appears at
  least three times, along with 5/25, 4/25, 3/25, 2/25 — same text, same
  timestamps, repeated.
- Events are **out of chronological order**. `9/25` at `3:59:06` renders between
  `1/25` at `3:57:18` and `8/25` at `3:58:51`.
- It is an unbounded flat list of bordered rows — the "table" the operator
  describes — with **no scroll container**. It grows the page instead of
  scrolling within a panel.

### 2.4 What the code actually says — and a discrepancy you must resolve first

**There are two live-trace renderers, and only one of them got the fix.**

| | `LiveResearchTraceLog.tsx` | `LiveRunPanel.tsx` |
|---|---|---|
| Where | `components/research/` — on the **request page**, the one the operator likes | `components/r1-dashboard/` — on **`/app/run/:runId`**, the broken one |
| Dedup | Uses `utils/traceEventWindow.ts` (`mergeTraceEvents`, `traceEventKey`) | **None.** `setActivities((prev) => [progressToActivity(raw), ...prev])` |
| Ordering | Handled by the merge window | Naive prepend; no sort |
| Scroll | Scrollable window | Flat list, no `max-h` / `overflow-y-auto` |

`traceEventWindow.ts` exists precisely because duplicate trace events were fixed
once already. That fix never reached `LiveRunPanel`. **This is Rule 44 T3.**

**⚠️ Discrepancy — verify before you plan.** The code in `LiveRunPanel.tsx` on
`main` caps activities at 12 (`.slice(0, 12)`) and centres content in a
`max-w-[1400px] mx-auto` container. Neither matches the screenshots, which show
dozens of rows and an off-centre layout. Either the deployed build is behind
`main`, or a different component is rendering. **Reproduce in the browser and
confirm which code is actually serving `/app/run/:runId` before designing
anything.** Do not plan against a file you have not confirmed is the one running.

### 2.5 Concrete defects located in `LiveRunPanel.tsx`

Verify each yourself; do not take this list on faith.

1. **`<h1>{run.query}</h1>`** at ~line 133, `text-xl sm:text-2xl font-bold`. This
   is the wall of bold text. A run needs a *display title*, not its raw prompt.
   Note the backend already has `deriveGeneratedReportTitle` in
   `services/reasoning/reportGenerator.ts` — but it derives from report markdown,
   which does not exist while the run is in flight. Deciding what titles an
   in-flight run is a real design question, not a formatting tweak.
2. **Trace history is never rehydrated.** `activities` initialises to `[]` and
   fills only from socket events received *while the component is mounted*.
   Navigate away and back and the history is gone. This — not the styling — is
   the actual "loses view of the live research trace" bug. Check whether
   `run_progress_events` is queryable from the API for backfill.
3. **`onCompleted` force-navigates to `/app/dossiers`** after 1.5s, yanking the
   user off the page they were reading.
4. **No dedup or ordering** on incoming events (§2.4).
5. **No navigation affordances** — no link to `/app/research`, no list of other
   active runs, no breadcrumb.

### 2.6 Routing as it stands today

```
/app/research            → ResearchPage      (the good trace lives here)
/app/run/:runId          → LiveRunPage       → LiveRunPanel (broken)
/app/dossiers            → DossiersPage
/app/dossiers/:id        → DossierDetailPage
/app/reports/run/:runId  → FailedRunReportPage
```

`utils/researchRunRoutes.ts` is the canonical route-helper module. Use it; do not
hand-roll paths alongside it.

**The routing loop you need to untangle:**

- `ActiveRunBadge.tsx` (the header status pill) links to
  `liveResearchUrl(runId)` = **`/app/research?runId=<id>`**
- but `ResearchPage` **redirects `?runId=` to `/app/run/:runId`**
  (asserted in `__tests__/pages/ResearchPage.test.tsx`)
- so the pill always lands the user on the broken page, and there is no path
  back to the good trace view.

Decide deliberately which surface is canonical for a live run. Right now the
codebase asserts both and the redirect silently wins.

### 2.7 Concurrency — plan for it now, even if it ships later

`store/useStore.ts` exposes a **singular** `activeRun`, and `ActiveRunBadge`
returns `null` unless `activeRun?.runId` is set. That models exactly one run.
The higher tier the operator described needs *N* concurrent runs.

Whatever you design should not require a second rewrite to support concurrency.
That does not mean building the paid tier now — it means not baking the
single-run assumption any deeper than it already is.

### 2.8 Questions the plan must answer

Answer these explicitly in the plan before writing code:

- **What is a run workspace?** A route? A tab? A persistent panel? What does its
  URL look like, and is it shareable and bookmarkable?
- **What does a run page show** while queued / plan-pending / running / complete /
  failed? Each state needs a real answer, not a spinner.
- **Where does the trace history come from** after a remount? If the API cannot
  serve past progress events for a run, that is backend work and belongs in the
  plan.
- **What titles an in-flight run?** And what does the user see instead of the raw
  prompt — is the prompt available on demand, collapsed, rendered as markdown?
- **How does a user move between runs** without going through Dossiers? What does
  the header show when there are three active runs, not one?
- **What happens on completion?** The current forced redirect is wrong. What
  replaces it?
- **What is the canonical live-run surface**, and what happens to the other one?
  Consolidating two renderers into one is likely the correct answer — but if you
  consolidate, Rule 44 T4 applies: write down what the surface you delete
  protected, and confirm the survivor still does it.

### 2.9 Definition of done

1. A user can start a run, navigate anywhere in the app, and return to a **full**
   live trace — including the events that arrived while they were away.
2. Every trace event appears **exactly once**, in chronological order, in a
   scrollable panel that does not grow the page.
3. No run page displays a raw prompt as its heading.
4. Active runs are reachable from the header **without** going through Dossiers,
   and the path from the pill lands somewhere useful and stays there.
5. Run completion does not navigate the user away from what they are reading.
6. The design supports more than one concurrent run without a rewrite.
7. Both trace renderers share one dedup/ordering implementation, or one of them
   no longer exists.
8. Rule 44 self-check run in full; new themes logged; both bots reviewed and every
   finding answered in-thread before merge.

---

## 3. Starting checklist

```bash
git checkout main && git pull
git checkout -b <feature-branch>          # Rule 32 — never main

# Gates (Rule 44). Run from repo root, both workspaces.
cd backend  && npx tsc --noEmit && npx eslint src --quiet && npx vitest run
cd frontend && npx tsc --noEmit && npx eslint src --quiet && npx vitest run
```

Baseline on `main` @ `fdd81e5`: backend 1325 tests pass, frontend 308 pass, lint
clean in both.

**Environment notes for the next session**

- The working clone is on the operator's Windows machine at
  `C:\Users\brand\Projects\ResearchOne` — reachable via the desktop bridge, not
  the cloud container. `device_bash` cannot reach github.com; use PowerShell via
  Desktop Commander for `git`, `gh`, and `npm`.
- PowerShell mangles complex inline quoting. Write a `.ps1` file and execute it,
  or write commit messages to a file and use `git commit -F`.
- Set `NODE_ENV=test` before `npm test` in the backend or `loadEnv` fails.
- GitGuardian scans **every commit in a PR**, not just the head. A secret-shaped
  string removed in a later commit still fails the check — squash it out.

---

## 4. First actions, in order

1. Read `.cursor/rules/44-pre-review-self-check.mdc` in full.
2. Reproduce both screenshots in the browser and **resolve the §2.4 discrepancy** —
   confirm which component actually serves `/app/run/:runId` in production.
3. Verify each defect in §2.5 against the confirmed source.
4. Write the plan answering every question in §2.8. Show it to the operator
   before implementing.
5. Implement. Gates. Rule 44 self-check. PR. Both reviews. Reply to every
   finding. Then merge.
