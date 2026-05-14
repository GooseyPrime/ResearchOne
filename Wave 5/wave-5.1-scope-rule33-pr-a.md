# Wave 5.1 Scope Doc + Rule 33 — Cursor Agent Work Order (PR-A)

You are working on the GooseyPrime/ResearchOne monorepo. This PR
establishes the scope contract for Wave 5.1: the Plan Confirmation
Gate, the 12-intent taxonomy, the intent classifier, and the
plan-generation + refinement LLM services. It mirrors the Rule 29
contract pattern. Implementation lands in PR-B.

## Standing instruction

On any rule conflict, stop. Quote the rule by ID and line. State
the discrepancy. Ask for (a) founder override, (b) rule amendment,
or (c) defer. Wait for the founder reply. No silent deferral.

## Mandatory pre-read

1. `.cursor/rules/10-state-machine-and-multi-writer.mdc` — STATE
   MACHINE DISCIPLINE. Wave 5.1 ADDS a new canonical run state
   `plan_pending_confirmation`. This is the first state machine
   modification since the original module. Read the docstring on
   `runStateMachine.ts` in full before drafting the scope.
2. `.cursor/rules/11-error-paths-and-logging.mdc` — failure
   handling for the new plan generation stage.
3. `.cursor/rules/20-research-policy-guardrails.mdc` — immutability
   fence. The plan-generation and refinement LLM calls are NEW
   inference calls. They run BEFORE the existing pipeline, with
   their own system prompts. They are NOT in the REASONING_FIRST_
   PREAMBLE family and they do NOT modify the existing prompts.ts.
   They are governed by a separate new prompts file. Confirm this
   reading.
4. `.cursor/rules/14-third-party-api-contracts.mdc` — the
   plan-generation LLM call is a new API contract.
5. `.cursor/rules/16-tests-must-fail-without-the-fix.mdc` — test
   discipline for the new flows.
6. `.cursor/rules/17-ripple-and-grep-callers.mdc` — adding a state
   ripples through every read-side of run state. Audit required.
7. `.cursor/rules/22-out-of-scope-discovery.mdc` — the scope doc
   must explicitly enumerate the fence.
8. `.cursor/rules/24-canonical-path-after-mutation.mdc` — Plan
   reads go through v_dossier (Wave 5.0 view). Plan writes go
   through a new canonical service.
9. `.cursor/rules/29-marketing-scope-doc-contracts.mdc` — scope-
   doc contract pattern.
10. `.cursor/rules/31-evidence-vs-source-vocabulary.mdc` — Wave 4
    vocabulary discipline applies.
11. `.cursor/rules/32-dossier-canonical-read-path.mdc` — Wave 5.0
    Rule 32. v_dossier remains the canonical read path.
12. `docs/wave-5-0-dossier-data-model-scope.md` — Wave 5.0 contract
    that this wave extends.
13. `backend/src/services/reasoning/runStateMachine.ts` — the file
    being modified.
14. `backend/src/services/reasoning/researchOrchestrator.ts` — the
    file gaining a new Stage 0.5.
15. `backend/src/queue/workers/` — the worker layer that needs to
    handle the parked state.

## Dependency gate

Wave 5.1 depends on Wave 5.0 merged. Specifically:
- Migration **034** applied (`research_plans`, `plan_revisions`,
  `dossier_statistics`, `v_dossier` all present).
- /api/dossiers routes operational.
- Rule 32 file present.

If any dependency is missing: STOP and report.

## What Wave 5.1 is

ResearchOne currently treats every research query identically:
the orchestrator immediately decomposes the query, plans the
retrieval, and proceeds through all 10 pipeline stages. The user
discovers what kind of document was produced only at the end.

Wave 5.1 introduces a 12-intent taxonomy, an intent classifier
that detects which intent the user's query represents, a plan-
generation service that produces a structured plan, and a Plan
Confirmation Gate where the user reviews and confirms the plan
BEFORE the pipeline runs. The user can refine the plan via
natural-language instruction.

Wave 5.1 does NOT change pipeline behavior post-confirmation. The
orchestrator still runs all 10 stages with current logic after
Confirm. Intent-driven orchestration (skipping or gating stages
based on intent) is Wave 5.2.

In effect, Wave 5.1 is "intent + plan + gate." The plan is
captured, displayed, refinable, and persisted. The pipeline still
runs as it does today.

## Definitions (lock into doc)

- **Intent** — one of 12 named research-request types from the
  taxonomy. The intent classifies the speech act the user is
  performing (asking for a factual report, requesting a survey,
  challenging a claim, etc.).
- **Intent confidence** — numeric 0.000–1.000 representing the
  classifier's confidence in the detected intent.
- **Topic analysis** — a structural read of the topic produced by
  the plan-generation service: is the topic closed-record or
  multi-layer, settled or actively contested, within or outside
  the system's competence.
- **Orchestration profile** — the named recipe describing which
  agents will run, in what order, with what weights, against
  what tier prioritization, producing what document shape. In
  Wave 5.1, orchestration profiles are PLACEHOLDER metadata only;
  the orchestrator does not yet use them. Wave 5.2 wires them
  in.
- **Plan** — the structured artifact bundling intent, topic
  analysis, orchestration profile, source strategy, and output
  shape preview. Persisted in `research_plans.plan_payload`.
- **Plan refinement** — a natural-language instruction from the
  user describing how the plan should change. Processed by the
  refinement LLM. Each refinement creates a row in
  `plan_revisions`.
- **Plan Confirmation Gate** — the UI surface and the orchestrator
  stage at which the user reviews and confirms (or refines or
  cancels) the plan before the run proceeds.
- **plan_pending_confirmation** — new canonical run state. Run
  has been queued, planner has produced a plan, the run is
  awaiting user action. The worker has parked the job; it is
  not consuming compute.

## The 12-intent taxonomy

Lock these enum values:

1. `factual_report` — encyclopedic answer for closed-record topics
2. `survey` — layered exposition for multi-layer topics
3. `adjudication` — fact-check / verify a specific proposition
4. `investigation` — symmetric deep-dive on contested topics
5. `literature_review` — academic-register review of peer-reviewed
   sources
6. `comparative` — structured comparison along consistent
   dimensions
7. `how_to` — procedural / step-by-step
8. `recommendation` — decision support with elicited constraints
9. `exploratory` — discovery / serendipity / "show me something
   interesting"
10. `position_brief` — strongest case for a stated position
    (rhetorical aid)
11. `timeline` — chronological events ordering
12. `reference_lookup` — single-fact retrieval (lightest pipeline)

Each intent has, in the codebase:
- A canonical name
- A user-facing display label
- A short description (shown in the gate UI)
- A default orchestration profile reference (placeholder in 5.1;
  wired in 5.2)
- A list of trigger lexical patterns (for the classifier's
  Layer 1)
- An expected document shape (used by the plan generator)

These definitions live in a new module:
`backend/src/services/planning/intentTaxonomy.ts`. The frontend
imports a thin display-side mirror from
`frontend/src/lib/intents.ts` for badge rendering.

## In Scope

### Data model — migration 035

Single new migration: `035_plan_intent_taxonomy_and_gate.sql` (renumbered because dossier DDL is **`034_dossier_data_model.sql`**).

1. Update `research_plans.intent` CHECK constraint:
```
   ALTER TABLE research_plans DROP CONSTRAINT IF EXISTS
     research_plans_intent_check;
   ALTER TABLE research_plans ADD CONSTRAINT
     research_plans_intent_check
     CHECK (intent IN (
       'legacy', 'factual_report', 'survey', 'adjudication',
       'investigation', 'literature_review', 'comparative',
       'how_to', 'recommendation', 'exploratory',
       'position_brief', 'timeline', 'reference_lookup'
     ));
```

2. Add column `research_plans.orchestration_profile`:
```
   ALTER TABLE research_plans ADD COLUMN orchestration_profile TEXT;
   -- placeholder string in 5.1; wired in 5.2
```

3. Update `research_runs.status` CHECK constraint to include
   `plan_pending_confirmation`:
```
   -- Read existing constraint, drop, re-add with the new state.
   -- Coordinate with runStateMachine.ts changes.
```

   The new state's allowed transitions per Rule 10:
   - `queued → plan_pending_confirmation` (planner produced plan,
     awaiting user)
   - `plan_pending_confirmation → plan_pending_confirmation`
     (refinement creates new plan revision; state name stays the
     same; plan_revisions table tracks the changes)
   - `plan_pending_confirmation → running` (user confirmed)
   - `plan_pending_confirmation → cancelled` (user cancelled)
   - `plan_pending_confirmation → failed` (plan generation
     errored, or refinement LLM returned an unrecoverable error
     three times)

4. Add table `account_preferences` for auto-confirm settings:
```
   CREATE TABLE account_preferences (
     user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     auto_confirm_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
     auto_confirm_threshold  NUMERIC(4,3) NOT NULL DEFAULT 0.850,
     confirmed_streak        INTEGER NOT NULL DEFAULT 0,
     updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
```

   This table is populated lazily on first preference set. Logic
   for confirmed_streak increment / reset and threshold
   eligibility lands in 5.4; 5.1 ships the column with default
   off.

5. RLS on `account_preferences` per Rule 21/22 patterns.

6. Update view `v_dossier` to include the new
   `orchestration_profile` column.

### Intent taxonomy module

New: `backend/src/services/planning/intentTaxonomy.ts`. Exports:

```ts
export type IntentId =
  | 'factual_report' | 'survey' | 'adjudication'
  | 'investigation' | 'literature_review' | 'comparative'
  | 'how_to' | 'recommendation' | 'exploratory'
  | 'position_brief' | 'timeline' | 'reference_lookup'
  | 'legacy';

export interface IntentDefinition {
  id: IntentId;
  displayLabel: string;
  shortDescription: string;
  documentShape: string;
  defaultOrchestrationProfile: string; // placeholder string in 5.1
  triggerPatterns: RegExp[];           // Layer 1 classifier patterns
  isMultiLayer: boolean;               // topic-shape hint
}

export const INTENT_TAXONOMY: Record<IntentId, IntentDefinition>;
export function getIntentById(id: string): IntentDefinition | null;
```

The frontend mirror:
`frontend/src/lib/intents.ts` — display-only metadata. Imports
nothing from the backend. Mirrored manually with a build-time
or test-time parity check.

### Plan generation prompts

New: `backend/src/services/planning/prompts.ts`. This file is
SEPARATE FROM `backend/src/constants/prompts.ts` and is NOT in
the Rule 20 fence. It contains:

- `INTENT_CLASSIFIER_PROMPT` — system prompt for the classifier
  LLM call.
- `PLAN_GENERATOR_PROMPT` — system prompt for the plan-
  generation LLM call. Takes intent + query + topic analysis;
  produces a structured plan in plain language.
- `PLAN_REFINEMENT_PROMPT` — system prompt for the refinement
  LLM call. Takes the current plan + the user's natural-
  language refinement instruction; produces a revised plan plus
  a diff summary.

These prompts are MUTABLE and iterable. They are NOT part of the
inference-time research preamble. They govern the planning
stage only. Rule 20 fence is preserved.

### Intent classifier service

New: `backend/src/services/planning/intentClassifier.ts`. Three
layers per the design discussion:

1. **Layer 1 — lexical patterns.** Run the trigger patterns from
   `INTENT_TAXONOMY` against the query. If a single intent
   matches with high lexical signal, return it with high
   confidence and skip LLM call.
2. **Layer 2 — LLM classification.** If Layer 1 is ambiguous (no
   match or multiple matches), call the planning LLM with the
   `INTENT_CLASSIFIER_PROMPT`. Returns intent + confidence.
3. **Layer 3 — confidence floor.** If LLM confidence is below
   account threshold (default 0.850), the planner returns
   intent + low-confidence flag; the gate will display this
   prominently and recommend the user review carefully.

Service exports:
```ts
classifyIntent(query: string, supplementalContext?: string):
  Promise<{ intent: IntentId; confidence: number; reasoning: string }>
```

The `reasoning` field captures the classifier's brief explanation
("This query asks 'tell me about' a closed-record historical
event, indicating Factual Report intent."). Shown in the gate UI
for transparency.

### Plan generator service

New: `backend/src/services/planning/planGenerator.ts`. Exports:

```ts
generatePlan(input: {
  query: string;
  supplementalContext?: string;
  intent: IntentId;
  intentConfidence: number;
}): Promise<PlanPayload>
```

`PlanPayload` is a structured JSON object with six blocks:

```ts
interface PlanPayload {
  intent: {
    id: IntentId;
    displayLabel: string;
    confidence: number;
    reasoning: string;
  };
  topicAnalysis: {
    summary: string;
    isMultiLayer: boolean;
    isActivelyContested: boolean;
    competenceAssessment: string;
  };
  orchestrationProfile: {
    name: string;  // placeholder in 5.1; wired in 5.2
    description: string;
    agentsWillRun: string[];
    agentsWillSkip: string[];
  };
  sourceStrategy: {
    summary: string;
    weightedClasses: string[];  // e.g., 'peer_reviewed', 'primary_documents'
    expectedSourceCount: { min: number; max: number };
  };
  outputShape: {
    structure: string;  // section heading preview
    estimatedLength: { minWords: number; maxWords: number };
    documentShape: string;
  };
  estimatedCost: {
    durationSeconds: { min: number; max: number };
    estimatedTokens: number;
    estimatedCostCents: number | null;  // BYOK/Sovereign only
  };
}
```

The plan generator uses the planning LLM with
`PLAN_GENERATOR_PROMPT`. The output is plain-language for the
user (rendered in the gate UI) plus a parallel structured
representation for storage and analysis.

### Plan refinement service

New: `backend/src/services/planning/planRefinementService.ts`.
Exports:

```ts
refinePlan(input: {
  currentPlan: PlanPayload;
  refinementInstruction: string;
  query: string;
}): Promise<{
  revisedPlan: PlanPayload;
  diffSummary: string;
}>
```

The refinement LLM call:
- Reads the current plan + user instruction + original query.
- Produces a revised plan (full PlanPayload) plus a plain-
  language diff summary.
- Strict constraint: refinement may NOT change the underlying
  query intent if the user's instruction is purely about source
  weighting, output length, or document shape. If the
  refinement instruction clearly implies an intent change (e.g.,
  user says "actually fact-check this instead"), the service
  flags it and the gate UI surfaces a confirmation: "Your
  refinement looks like it changes the intent from Survey to
  Adjudication. Confirm?"

### Orchestrator change — Stage 0.5

`backend/src/services/reasoning/researchOrchestrator.ts` —
insertion at the start of `runResearchJobInner` (around line
210, before the current Stage 1 planning call at line 339).

Pseudocode:

```ts
async function runResearchJobInner(...) {
  // Existing setup: assert not cancelled, set up progress, etc.

  // NEW Stage 0.5: Plan generation and confirmation
  await progress('plan_generation', 1,
    'Detecting intent and generating plan...',
    { substep: 'plan_started' });

  const intentResult = await classifyIntent(query, supplementalContext);
  const plan = await generatePlan({ query, supplementalContext,
                                     intent: intentResult.intent,
                                     intentConfidence: intentResult.confidence });

  await persistInitialPlan(runId, plan);

  await progress('plan_pending_confirmation', 2,
    'Plan ready — awaiting your confirmation',
    { substep: 'plan_ready',
      planId, intent: plan.intent.id,
      confidence: plan.intent.confidence });

  // PARK the job — transition state machine to
  // plan_pending_confirmation, persist, emit socket event,
  // and YIELD until the user confirms.

  await transitionToPlanPendingConfirmation(runId, planId);
  await emitSocketEvent('research:plan_ready_for_confirmation',
                         { runId, planId, plan });

  // Worker exits here. Resumption happens when the user
  // confirms via API, which re-enqueues the job with the
  // confirmed plan.

  return;
}
```

A NEW orchestrator entry point handles resumption:
```ts
export async function resumeAfterPlanConfirmation(
  runId: string,
  confirmedPlanId: string
): Promise<void> {
  // Transition state machine: plan_pending_confirmation → running
  // Then proceed to the existing Stage 1 (planning) call.
  // The user-confirmed plan is read from research_plans and may
  // influence later stages in Wave 5.2; in 5.1 it's recorded
  // and displayed but does not yet modify pipeline behavior.
}
```

Per Rule 10: the state machine module gains the new state,
transition helpers (`decideRunStateOnPlanPending`,
`decideRunStateOnPlanConfirmed`, `decideRunStateOnPlanCancelled`,
`decideRunStateOnPlanRefinementFailed`), and updated read-side
in `deriveRunState` (frontend).

### Worker layer changes

`backend/src/queue/workers/` — the existing research worker:
- When the orchestrator returns having parked the job (Stage 0.5
  set state to `plan_pending_confirmation`), the worker
  finishes that job without error.
- A NEW worker entry point handles the `research:resume_after_plan`
  job type, which the API enqueues when the user confirms. This
  job calls `resumeAfterPlanConfirmation` and the pipeline
  proceeds from Stage 1.

### API routes — new

New: `backend/src/api/routes/plans.ts`.

- `POST /api/runs/:runId/plan/refine` — body
  `{ refinementInstruction: string }`. Calls
  `refinePlan(...)`, writes a row to `plan_revisions`, updates
  `research_plans.plan_payload`, returns the revised plan.
- `POST /api/runs/:runId/plan/confirm` — body empty or
  `{ planId: string }`. Marks the plan `confirmed`, sets
  `confirmed_at`, transitions the run state to `running`, and
  enqueues `research:resume_after_plan` job.
- `POST /api/runs/:runId/plan/cancel` — body empty. Transitions
  to `cancelled`, refunds any wallet hold per existing
  billing patterns.
- `GET /api/runs/:runId/plan` — returns the current plan
  (latest revision). Reads from v_dossier.

All routes are RLS-scoped and validated. Mirror existing route
patterns.

### Socket events — new

`research:plan_ready_for_confirmation` — emitted when the run
enters `plan_pending_confirmation`. Payload includes the runId,
planId, full PlanPayload, and refinement count.

`research:plan_refined` — emitted when refinement completes.
Payload includes runId, planId, revisedPlan, diffSummary.

`research:plan_confirmed` — emitted when confirmed. Payload
runId, planId.

`research:plan_cancelled` — emitted when cancelled. Payload runId.

All four are read-only events for the frontend. Mutations go
through the API routes.

### Frontend — Plan Confirmation Gate UI

New component:
`frontend/src/components/research/PlanConfirmationPanel.tsx`

UI pattern (from founder direction):
- Rendered on `ResearchPageV2` below the query input.
- Materializes when the socket event
  `research:plan_ready_for_confirmation` fires.
- Renders the plan in six expandable blocks:
  1. Intent (with confidence badge + reasoning expander)
  2. Topic Analysis
  3. Orchestration Profile (placeholder content in 5.1)
  4. Source Strategy
  5. Output Shape
  6. Estimated Cost & Duration
- Three action buttons: **Confirm & Run** (primary, prominent),
  **Refine** (secondary), **Cancel** (tertiary, danger style).
- When user clicks **Refine**:
  - A text input slides down below the plan panel via
    framer-motion. The plan stays fully visible.
  - Placeholder text: "Describe what to change — e.g., 'focus
    only on the legal aspects' or 'skip contested claims, just
    the established history'."
  - On Enter (or arrow submit):
    - Input shows inline loading spinner.
    - Plan panel grays slightly with a "Refining..." overlay.
    - POST /api/runs/:runId/plan/refine fires.
    - Socket event `research:plan_refined` triggers re-render.
    - The input field clears and collapses.
    - The plan updates in place.
    - A "Refined from previous plan — view changes" toggle
      appears showing the diff summary from the LLM.
  - Refinement can be invoked multiple times. `refinement_rounds`
    increments per refinement.
- When user clicks **Confirm & Run**:
  - POST /api/runs/:runId/plan/confirm fires.
  - Plan panel collapses to a compact summary bar at the top of
    the page: "Running: [Intent] dossier on [topic]". A "View
    plan" link expands it back.
  - Pipeline progress UI takes over below the summary bar.
- When user clicks **Cancel**:
  - Confirmation dialog: "Cancel this research run? The plan will
    be discarded and no Dossier will be created."
  - POST /api/runs/:runId/plan/cancel fires.
  - Page returns to the empty query input state.

Edge cases the component must handle:
- Plan generation in flight (no plan yet): show "Generating plan..."
  state.
- Plan generation failed: show error with retry option.
- Refinement failed: show error inline below the input field;
  the plan panel remains intact. After 3 consecutive refinement
  failures, the gate shows a "We're having trouble refining this
  plan — try rewording or contact support" state with a path to
  Cancel.
- Multiple refinements queued: disable the Refine button while a
  refinement is in flight.
- User refreshes the page during plan_pending_confirmation: the
  page restores to the gate state by reading current plan from
  `/api/runs/:runId/plan` and resubscribing to the socket.

Accessibility:
- Full keyboard support: Tab cycles through plan sections, action
  buttons, and refinement input.
- ARIA-live region for the "Refining..." status announcement.
- Confirmation dialog meets nested-interactive and landmark-one-
  main rules from Wave 2.5 a11y scope.
- Lighthouse Accessibility ≥ 95 on `/research` with the gate
  open.

### Frontend — intent display

- `IntentBadge.tsx` (created in Wave 5.0 as forward-compatible)
  is now populated with all 12 intents plus `legacy`.
- Each intent renders with a distinct color from the existing
  Tailwind palette (no new tokens). Colors chosen for
  semantic association (e.g., adjudication = challenge red,
  factual_report = neutral, survey = exploratory teal).

### Frontend — refinement chip

When a plan has been refined ≥ 1 times, a small "Refined N times"
chip appears next to the intent badge. Clicking the chip opens
a modal showing the refinement history (each natural-language
instruction and its diff summary). This data is read from
`plan_revisions` via a new `/api/runs/:runId/plan/revisions`
GET route.

### Plan-generation LLM model selection

Per founder direction: a specific frontier-capable model is used
for plan generation and refinement, consistent across all tiers.
The model identifier is configured in `backend/src/config/` as
`PLANNING_MODEL_ID`, defaulting to a high-quality reasoning model
(specific choice deferred to PR-B implementation, but must be in
the existing OpenRouter allowlist).

Rationale documented in scope doc: plan quality is the highest-
leverage point in the entire pipeline. A bad plan wastes the
entire run's compute. The cost of using a frontier model for the
plan (~hundreds of tokens) is negligible vs. the cost of a full
pipeline run (~tens to hundreds of thousands of tokens). Tier
pricing absorbs the planning cost.

### Account preferences (placeholder for 5.4)

The `account_preferences` table is created in this wave with
the auto-confirm columns. In Wave 5.1:
- Default `auto_confirm_enabled = FALSE` for all users.
- No UI to toggle the setting.
- The gate ALWAYS shows for all users.
- Wave 5.4 adds the UI and the confirmed_streak logic.

## Out of Scope (fence)

- Intent-driven orchestration (Wave 5.2): the orchestration
  profile is captured and displayed but does NOT yet change
  pipeline behavior post-confirmation.
- Steelman stage (Wave 5.3)
- Source-class dimension (Wave 5.3)
- Reasoner consensus constraint (Wave 5.3)
- Auto-confirm UI and confirmed_streak logic (Wave 5.4)
- Saved profiles, team-shared profiles (Wave 5.4)
- `/reports` URL deletion (Wave 5.4, kept as 308 through 5.3)
- `backend/src/constants/prompts.ts` — Rule 20 fence
- Existing V2 inference paths and model defaults
- Backend tier identifier strings (Rule 28)
- `frontend/src/components/landing/visual/pipelineLayout.ts`
  (Rule 27)

## Acceptance Criteria

- Migration 034 applied cleanly.
- New canonical state `plan_pending_confirmation` added to state
  machine; all transitions per Rule 10 documented and tested.
- All read-side consumers of run state updated to handle the new
  state (per Rule 17 ripple audit).
- 12 intents enumerated in `intentTaxonomy.ts` with display
  labels, trigger patterns, and shape metadata.
- Intent classifier service operational with three-layer logic.
- Plan generator service operational producing structured plans.
- Plan refinement service operational; refinement instructions
  produce revised plans with diff summaries.
- Orchestrator Stage 0.5 parks new runs awaiting confirmation.
- Resume entry point reactivates the pipeline on confirm.
- All four plan API routes operational (refine, confirm, cancel,
  GET plan).
- Socket events emit on plan_ready, plan_refined,
  plan_confirmed, plan_cancelled.
- Plan Confirmation Panel renders on `ResearchPageV2`.
- Refine flow: text input slide-in, refinement processes, plan
  updates in place, diff summary appears.
- Confirm flow: panel collapses, pipeline progresses.
- Cancel flow: run discarded, no dossier created.
- Page-refresh resilience during plan_pending_confirmation.
- Auto-confirm column present, default off; UI not exposed in
  5.1.
- Lighthouse Accessibility ≥ 95 on `/research` with gate open.
- v_dossier view returns the new plan fields for confirmed runs.
- All existing tests pass; new state machine tests pass; new
  intent classifier tests pass; new plan generator tests pass;
  new refinement tests pass; new orchestrator integration tests
  pass.
- Zero modification to `backend/src/constants/prompts.ts`.
- Wave 4 (Rule 31) vocabulary intact throughout new copy.
- Wave 5.0 (Rule 32) canonical read path preserved.

## Rule References

- Rule 10 (state machine) — MODIFIED. New state, new
  transitions, new helpers. State-machine docstring updated to
  describe the parked state's semantics.
- Rule 11 (error paths and logging) — followed for plan
  generation, classification, and refinement failure paths.
- Rule 13 (deploy/schema skew) — migration before backend
  before frontend ordering.
- Rule 14 (third-party API contracts) — planning LLM calls
  documented.
- Rule 16 (tests fail without the fix) — required for state
  machine and refinement service.
- Rule 17 (ripple and grep callers) — explicit audit list in
  acceptance criteria.
- Rule 20 (immutability fence) — invoked, NOT modified. Plan
  prompts live in a separate file.
- Rule 22 (out-of-scope discovery) — fence enumerated above.
- Rule 24 (canonical path after mutation) — plan writes via
  service, plan reads via v_dossier.
- Rule 27 (pipeline stage names) — NOT modified.
- Rule 28 (tier identifiers) — NOT modified.
- Rule 29 (scope-doc contract) — followed.
- Rule 31 (Wave 4 vocabulary) — applied.
- Rule 32 (Wave 5.0 canonical read) — applied.
- Rule 33 (new) — see Deliverable 2.

## Rule 33 — Plan Confirmation Gate Discipline

This rule codifies the discipline that:
1. The gate ALWAYS appears for all users unless account-level
   auto-confirm is explicitly enabled (Wave 5.4).
2. Plan generation runs BEFORE any retrieval, reasoning, or
   pipeline compute commits.
3. Plan refinement is a natural-language conversation processed
   by the dedicated planning LLM; not the inference-time
   reasoning models.
4. The plan is persisted as the source of truth for what the
   user agreed to; the Dossier always carries the confirmed plan.
5. State `plan_pending_confirmation` is a parked state — no
   compute may consume resources while in this state.
6. The Plan API routes are the canonical write path for plan
   mutations; the orchestrator and worker layers may not mutate
   plan rows directly.

Trigger conditions: any PR that adds plan-related routes, state
machine transitions, planning LLM calls, or gate UI components.

Cross-references: Rule 10 (state machine), Rule 24 (canonical
path), Rule 32 (canonical read path).

## Open Questions

List anything ambiguous you encounter while drafting. If none,
state "None."

## Deliverables for PR-A

Four files. No implementation.

1. `docs/wave-5-1-plan-confirmation-gate-scope.md` — this scope
   doc.
2. `.cursor/rules/33-plan-confirmation-gate.mdc` — Rule 33 per
   the spec above. `alwaysApply: true`. Globs include
   `backend/src/services/planning/**/*.ts`,
   `backend/src/api/routes/plans.ts`,
   `frontend/src/components/research/PlanConfirmation*.tsx`.
3. `docs/governance.md` — Wave 5.1 entry. Founder approvals:
   - Bless Rule 33.
   - Approve state machine modification (new state +
     transitions).
   - Approve planning LLM as frontier-capable, tier-uniform.
   - Approve full 12-intent taxonomy ship in 5.1.
   - Reaffirm Rule 20 fence, Rule 27 fence, Rule 28 fence.
4. PR description. Title:
   `docs: wave 5.1 plan confirmation gate scope + rule 33 (PR-A)`

## Constraints

- No changes outside `docs/` and `.cursor/rules/`.
- No edits to `backend/src/constants/prompts.ts`.
- No backend tier identifier changes.
- No orchestrator changes in PR-A.
- Confirm Wave 5.0 merged (migration 033 present, Rule 32 file
  present) before drafting.

## Stop conditions

- Wave 5.0 not merged: stop, report, defer.
- State-machine module structure differs materially from what's
  assumed: stop, surface, ask.
- Existing planning-related files conflict with the new
  `services/planning/` directory: stop, report.

Proceed.