# GitHub Copilot — repository instructions

You are an autonomous coding agent working in **ResearchOne**, a multi-intent
deep-research platform. This file is loaded automatically on every request.
Read it fully before acting.

## ⛔ RULE 41 — FIX EVERYTHING YOU SEE. NO SCOPE EXCUSES. ⛔

> **Binding. No exceptions. This is the first thing you read.**
>
> If you encounter a failing test, lint error, type error, or build error —
> **fix it now, in this PR**, regardless of whether it was "caused by your
> change" or is "pre-existing." This is a one-person codebase. There is no
> team. There is no backlog. You are the last line of defence.
>
> **Banned phrases** — forbidden in any commit, PR body, or response:
>
> - "still fails from pre-existing unrelated docs issues"
> - "pre-existing unrelated issues" / "out of scope"
> - "not caused by this change" / "left for a future PR"
>
> Full rule: [`.cursor/rules/41-fix-all-failures-no-excuses.mdc`](../.cursor/rules/41-fix-all-failures-no-excuses.mdc)

## 0. Bootstrap (do this first, every session)

1. Read [`AGENTS.md`](../AGENTS.md) — binding agent rules, branch policy,
   recurring review themes.
2. Read [`.cursor/rules/00-pre-commit-review.mdc`](../.cursor/rules/00-pre-commit-review.mdc)
   — master pre-commit checklist; it links every topic rule.
3. Read [`ResearchOne PolicyOne`](../ResearchOne%20PolicyOne) — the binding
   epistemic policy.
4. Check for an **active work order** in the table below. If one is `OPEN`,
   it is your task list. Execute it phase by phase until every exit gate
   passes.

## 1. Active work orders

| ID | Status | Document | One-line scope |
| --- | --- | --- | --- |
| WO-Z | CLOSED | [`docs/WO-Z-REPORT-TYPE-FIDELITY.md`](../docs/WO-Z-REPORT-TYPE-FIDELITY.md) | Report-type fidelity. Shipped in PR #200. Phase 5 was implemented incorrectly — superseded by WO-AA. |
| **WO-AA** | **OPEN** | [`docs/WO-AA-DELIVERABLE-INTEGRITY.md`](../docs/WO-AA-DELIVERABLE-INTEGRITY.md) | Deliverable integrity: prompt echo and token bloat, objective resolution, evidence burden by claim class, E2E regression fixture. Phases 1–4 already done. |

**If a work order is `OPEN`, and the user's prompt does not name a different
task, execute it autonomously through every remaining phase without stopping
to ask for confirmation between phases.** Start at the first phase whose
Progress Log row is not `DONE`. Stop only at a declared BLOCKED condition (§5).

**Before implementing any phase, read [`.cursor/rules/42-deliverable-integrity.mdc`](../.cursor/rules/42-deliverable-integrity.mdc).**
It exists because a previous phase satisfied its exit gate with generated
filler: twenty identical placeholder blocks that passed a deliverable-count
check while delivering nothing. A green metric is not a completed phase.

## 2. Non-negotiable guardrails

These cause immediate rejection in review. Do not violate them even if a
work order appears to ask you to.

- **Never commit to `main` unless the user explicitly authorizes
  direct-main in the same message.** Otherwise use a PR branch:
  `bash scripts/git/prepare-work-branch.sh <topic-slug>`. See Rule 32.
  If direct-main is explicitly authorized, include `[direct-main]` in
  every commit message on `main`. If ref creation is blocked (GH013),
  stop and report `BLOCKED_GITHUB_REF_CREATION` — do not retry in a loop.
- **Never modify `REASONING_FIRST_PREAMBLE` or `RED_TEAM_V2_SYSTEM_PREFIX`**
  in `backend/src/constants/prompts.ts` without explicit user request in the
  same message. Changing *which roles receive* a preamble is routing and is
  permitted; changing the *text* of those two constants is fenced.
- **PolicyOne is preserved.** Work that scopes epistemic behavior to the
  intents that need it must not weaken, delete, or dilute PolicyOne for
  `adjudication`, `investigation`, `story_verification`, or any run whose
  `resolvedMethodology === 'policyone'`. Narrowing the blast radius is the
  goal; removing the capability is a regression.
- **No test mocks in application source.** `vi.mock` / `vi.fn` / `jest.mock`
  must not appear in `backend/src/**` or `frontend/src/**` outside
  `__tests__/**` and `*.test.*`. CI enforces this.
- **Tests must fail without the fix** (Rule 16). A test that passes both
  before and after your change is worse than no test. Verify by stashing the
  source change and re-running.
- **Grep every caller when you change a primitive** (Rule 17).
- **Never satisfy a deliverable check with generated filler** (Rule 42). If a
  count or field-presence gate passes while a human would call the output
  empty, the generator is broken — not the gate.
- **Degraded modes modify the synthesis prompt; they never replace the
  synthesizer** (Rule 42 R42-2). A completed non-adjudicative run whose
  synthesis stage took 0 ms is a bug.
- **Any LLM-derived value that controls whether a stage runs needs a
  deterministic fallback** that logs, persists, and emits progress (Rule 42
  R42-3). "Completed with zero sources" must never be a quiet success.
- **Out-of-scope findings are addressed or scheduled, never dismissed**
  (Rule 22). Record them in the work order's Findings Log.

## 3. Definition of done

A phase is complete only when **all** of the following pass from the
repo root unless noted:

| Check | Command | Directory |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | `backend/` |
| Lint | `npm run lint` | `backend/` |
| Tests | `npm run test` | `backend/` |
| Frontend typecheck (if FE touched) | `npm run typecheck` | `frontend/` |
| Frontend tests (if FE touched) | `npm run test` | `frontend/` |
| Docs lint (if docs touched) | `npx markdownlint-cli2 "docs/**/*.md"` | repo root |

Pre-existing backend lint warnings in test files are not yours to fix.
Frontend lint runs `--max-warnings 0`; do not introduce new warnings.

## 4. Working style

- **Do not ask permission to start routine work.** Read the work order and
  begin.
- Make small, focused commits with meaningful messages. One logical change
  per commit.
- Update the work order's **Progress Log** as you complete each phase —
  this is how state survives across sessions.
- When a review comment or CI failure reveals a pattern the rules do not
  cover, extend the relevant `.cursor/rules/*.mdc` file in the same PR.
- Keep doc and code in parity (Rule 15). If you change behavior described
  in `docs/HOW_RESEARCHONE_RESEARCHES.md`, `howResearchOneThinks.ts`,
  `howYourReportIsMade.ts`, or the Guide/Methodology pages, update them in
  the same change set.

## 5. When to stop and ask

Stop and report only for these. Everything else, decide and proceed.

- `BLOCKED_GITHUB_REF_CREATION` — cannot create a branch or open a PR.
- A guardrail in §2 conflicts with the work order instruction.
- A required secret or service is unavailable and no offline path exists.
- A phase exit gate cannot be met without changing a fenced constant or
  weakening PolicyOne.

Use the escalation block format in
[`.cursor/rules/32-pr-branch-workflow.mdc`](../.cursor/rules/32-pr-branch-workflow.mdc).

## 6. Repo orientation

- `backend/` — Express + BullMQ workers, the research pipeline.
  - `services/planning/` — intent classification, research brief, plan JSON.
  - `services/reasoning/researchOrchestrator.ts` — the pipeline spine.
  - `services/retrieval/retrievalService.ts` — corpus retrieval.
  - `services/discovery/` — external source discovery + ingestion.
  - `services/formatting/templates/intentOutputTemplates.ts` — **the
    canonical per-intent report contract** (sections, verifier rubric,
    required deliverables).
  - `services/openrouter/openrouterService.ts` — agent system prompts,
    `getSystemPrompt`, `buildVerifierPromptForIntent`.
  - `constants/prompts.ts` — shared preambles (partly fenced, see §2).
- `frontend/` — Vite + React app.
- `docs/` — scope docs, work orders, runbooks, retrospectives.
- `.cursor/rules/` — binding topic rules; `00-` is the master index.

Local dev startup, env files, and known gotchas are documented at the end of
[`AGENTS.md`](../AGENTS.md).
