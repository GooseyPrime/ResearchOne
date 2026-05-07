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
