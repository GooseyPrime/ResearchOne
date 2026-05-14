Wave 5 — Single Cursor Prompt Per Sub-Wave
Each sub-wave is one PR. Scope doc lives at the top of each prompt, agent reads it, builds it, opens the PR. Trust the agent.

Wave 5.0 — Dossier Data Model
textWave 5.0: Dossier data model and Dossiers page.

The user-facing artifact becomes a Dossier: {Request, Plan, Report, Statistics}. Wave 5.0 establishes the data model and the /dossiers surface. Pipeline behavior unchanged.

Dependencies: Wave 4 merged (Rule 31 present).

Build:

1. Migration 034 (`034_dossier_data_model.sql`; file **034** because `033_research_run_citation_style.sql` already exists):
   - Table `research_plans` (run_id FK, status enum legacy/draft/pending_confirmation/confirmed/superseded, intent text default 'legacy', plan_payload jsonb, plan_summary text, refinement_rounds int, timestamps). RLS mirroring research_runs. Unique partial index: one active plan per run.
   - Table `plan_revisions` (plan_id FK, revision_number int, refinement_prompt text, prior_plan_payload jsonb, new_plan_payload jsonb, diff_summary text, created_by FK).
   - Table `dossier_statistics` (run_id FK unique, duration_ms, tokens_in/out, sources_retrieved/cited counts, citation_density, skeptic_annotations_count, contradictions_count, refinement_rounds, agents_ran jsonb, agents_skipped jsonb, stage_durations jsonb, models_used jsonb, cost cents).
   - View `v_dossier` joining research_runs + research_plans (confirmed/legacy only) + reports + dossier_statistics. This view is the canonical read path.
   - Back-fill: legacy plan row for every existing run; best-effort stats from existing telemetry, NULL where unknown.

2. Backend:
   - Service `dossierReadService.ts` — only module that selects from dossier surface, always via v_dossier.
   - Routes `/api/dossiers`, `/api/dossiers/:id`, plus /request /plan /report /stats sub-resources. Standard auth, RLS, UUID validation, 404 on not-visible.
   - Service `dossierStatisticsAggregator.ts` — computes stats from existing telemetry on run completion. Wire one best-effort call at the run-completion path in researchOrchestrator.ts; failure does not fail the run. This is the ONLY orchestrator change in 5.0.

3. Frontend:
   - Routes /dossiers and /dossiers/:id.
   - DossiersPage (card list, intent badge = "Legacy" in 5.0), DossierDetailPage (four tabs: Request, Plan, Report, Statistics; URL hash deep-links).
   - Components in components/dossiers/: DossierCard, IntentBadge (forward-compatible map keyed by intent string; only "Legacy" populated), DossierStatusBadge, four section components. Reuse existing report-rendering primitives for DossierReportSection.
   - Hooks useDossier and useDossiers via Tanstack Query.
   - /reports and /reports/:id redirect 308 to /dossiers via vercel.json. Old page files become <Navigate replace />. Don't delete the files (Wave 5.4 does that).
   - Sitemap updated.
   - Nav label "Reports" → "Dossiers".

4. Marketing copy surgical pass: "research report" (the artifact) → "research dossier"; "the report" (the document inside) stays "report". Audit landing/methodology/faq/pricing/about/compare/guide pages, marketingDocumentHead, index.html meta, FAQ items, feature cards, persona content, README. Apply Rule 31 vocabulary concurrently.

Add Rule 32 (.cursor/rules/32-dossier-canonical-read-path.mdc, alwaysApply: true): all dossier reads go through v_dossier; if a future field is needed, update the view in the same PR.

Append governance.md Wave 5.0 entry.

Fences: don't touch prompts.ts, reasoningModelPolicy, orchestrator pipeline stages (only the one telemetry call), tier identifiers, pipelineLayout.ts.

Standing instruction: on rule conflict, stop and ask. Apply Rule 17 ripple audit for state reads.

Acceptance: migration clean + idempotent, lint/typecheck/test green, build with prerender succeeds, Lighthouse a11y ≥95 on /dossiers and /dossiers/:id, /reports → 308 verified, all four sections render, legacy plans show graceful explainer, Rule 31 vocabulary clean.

Proceed.

Wave 5.1 — Plan Confirmation Gate
textWave 5.1: Plan Confirmation Gate + 12-intent taxonomy.

The orchestrator now generates a plan, parks the run, and shows the user a Plan Panel for confirm/refine/cancel before any pipeline compute commits.

Dependencies: Wave 5.0 merged.

Build:

1. Migration 034:
   - Expand research_plans.intent CHECK to: legacy, factual_report, survey, adjudication, investigation, literature_review, comparative, how_to, recommendation, exploratory, position_brief, timeline, reference_lookup.
   - Add research_plans.orchestration_profile text (placeholder in 5.1, wired in 5.2).
   - Add new canonical state plan_pending_confirmation to research_runs.status.
   - Table account_preferences (user_id PK, auto_confirm_enabled bool default false, auto_confirm_threshold numeric default 0.850, confirmed_streak int default 0). UI deferred to 5.4.
   - Update v_dossier to include orchestration_profile.

2. State machine (services/reasoning/runStateMachine.ts):
   - Add CanonicalRunStatus 'plan_pending_confirmation'.
   - Transitions: queued → plan_pending_confirmation (planner done); plan_pending_confirmation → plan_pending_confirmation (refinement; same state, plan_revisions tracks); plan_pending_confirmation → running (confirm); plan_pending_confirmation → cancelled (cancel); plan_pending_confirmation → failed (3 refinement failures or plan-gen error).
   - New helpers: decideRunStateOnPlanPending, decideRunStateOnPlanConfirmed, decideRunStateOnPlanCancelled, decideRunStateOnPlanRefinementFailed.
   - Update deriveRunState in frontend's researchLiveStatus.ts to handle the new state.
   - Audit and update every read-side consumer of run state (Rule 17 ripple).

3. Planning services (NEW directory services/planning/):
   - intentTaxonomy.ts — 12 intents with displayLabel, shortDescription, documentShape, defaultOrchestrationProfile (placeholder string), triggerPatterns (RegExp[]), isMultiLayer (bool).
   - prompts.ts — INTENT_CLASSIFIER_PROMPT, PLAN_GENERATOR_PROMPT, PLAN_REFINEMENT_PROMPT. SEPARATE FILE from constants/prompts.ts. Not in the Rule 20 fence. Mutable.
   - intentClassifier.ts — three layers: regex patterns → LLM classification → confidence floor. Returns {intent, confidence, reasoning}.
   - planGenerator.ts — returns structured PlanPayload with six blocks: intent, topicAnalysis, orchestrationProfile (placeholder content), sourceStrategy, outputShape, estimatedCost.
   - planRefinementService.ts — takes currentPlan + refinementInstruction + query; returns {revisedPlan, diffSummary}. If refinement clearly implies intent change, flag it for user confirmation in the gate.

4. Planning LLM:
   - Use a frontier-capable reasoning model from the existing OpenRouter allowlist. Configured as PLANNING_MODEL_ID in config. Same model across all tiers; cost absorbed in tier pricing.

5. Orchestrator (researchOrchestrator.ts):
   - New Stage 0.5 at the start of runResearchJobInner, before existing Stage 1 planning:
     - classifyIntent → generatePlan → persistInitialPlan → emit progress 'plan_generation' → transition state to plan_pending_confirmation → emit socket 'research:plan_ready_for_confirmation' → return (park).
   - New entry point resumeAfterPlanConfirmation(runId, confirmedPlanId): transitions state plan_pending_confirmation → running, proceeds to existing Stage 1.

6. Worker (queue/workers/):
   - Existing research worker exits cleanly when orchestrator parks the job.
   - New job type 'research:resume_after_plan' that calls resumeAfterPlanConfirmation.

7. API routes (api/routes/plans.ts):
   - POST /api/runs/:runId/plan/refine
   - POST /api/runs/:runId/plan/confirm (enqueues the resume job)
   - POST /api/runs/:runId/plan/cancel (refunds wallet hold per existing billing pattern)
   - GET /api/runs/:runId/plan
   - GET /api/runs/:runId/plan/revisions

8. Socket events: research:plan_ready_for_confirmation, research:plan_refined, research:plan_confirmed, research:plan_cancelled.

9. Frontend — PlanConfirmationPanel.tsx (components/research/):
   - Renders on ResearchPageV2 below the query input when the plan_ready socket fires.
   - Six expandable blocks rendering the PlanPayload.
   - Intent block shows confidence badge (high/medium/low) and an expander for the classifier's reasoning.
   - Three buttons: Confirm & Run (primary), Refine (secondary), Cancel (tertiary danger).
   - Refine: text input slides down BELOW the plan panel via framer-motion (plan stays visible). Placeholder "Describe what to change — e.g., 'focus only on the legal aspects'". On Enter: loading spinner inline, plan panel grays with "Refining..." overlay, POST refine, socket updates plan in place, input clears+collapses, "Refined from previous plan — view changes" toggle appears with diff summary.
   - Multiple refinements allowed. After 3 consecutive refinement failures, show error state with Cancel path.
   - Confirm: panel collapses to compact summary bar "Running: [Intent] dossier on [topic]" with "View plan" link to expand. Pipeline progress UI takes over below.
   - Cancel: confirmation dialog, then discard.
   - Page-refresh resilience: on mount, if run is in plan_pending_confirmation, fetch current plan and resubscribe.
   - A11y: keyboard nav, ARIA-live for refining status, Lighthouse a11y ≥95 with gate open.

10. IntentBadge.tsx (created in 5.0 as forward-compatible) — populate with all 12 intents using existing Tailwind palette. No new color tokens.

11. Refinement history modal: small chip "Refined N times" next to intent badge, click → modal with each refinement's instruction and diff summary. Reads /api/runs/:runId/plan/revisions.

Add Rule 33 (.cursor/rules/33-plan-confirmation-gate.mdc, alwaysApply: true): gate always shows unless account auto-confirm enabled; plan generation runs before any retrieval/reasoning compute; refinement uses planning LLM only, not inference models; plan API routes are canonical write path (orchestrator and workers don't mutate plan rows directly); plan_pending_confirmation is a parked state, no compute may run while in it.

Append governance.md Wave 5.1 entry. Founder-approved: state machine modification, frontier planning model tier-uniform, full 12-intent taxonomy, Rule 33.

Fences unchanged: prompts.ts, reasoningModelPolicy, tier identifiers, pipelineLayout.ts. The new planning prompts.ts file is NOT in the Rule 20 fence.

Standing instruction in effect. Rule 17 ripple audit explicit for run-state read sites.

Acceptance: migration clean, state machine tests pass (all transitions covered), 12 intents enumerated, classifier/generator/refinement all operational, orchestrator parks new runs, resume entry point works, four plan routes operational, four socket events emit, gate renders and all three flows work, page-refresh resilience verified, auto-confirm column present + default off + no UI, Lighthouse a11y ≥95 on /research with gate open, v_dossier returns new plan fields.

Proceed.

Wave 5.2 — Intent-Driven Orchestration
textWave 5.2: Pipeline behavior becomes intent-aware.

The confirmed plan from Wave 5.1 now actually drives which agents run, with what weights, producing what output shape. The orchestration_profile column gets wired in.

Dependencies: Wave 5.1 merged.

Build:

1. Orchestration profiles (services/planning/orchestrationProfiles.ts):
   - One profile per intent (12 total).
   - Each profile specifies: agentsToRun, agentsToSkip, skepticMode ('gate' | 'annotate' | 'off'), steelmanMode (placeholder for 5.3, 'off' for now), sourceClassWeights (placeholder for 5.3), outputTemplate, expectedLengthRange.
   - Profile assignments by intent:
     - factual_report: skeptic off, no contradictions, no steelman, encyclopedic template
     - survey: skeptic annotate-only, contradictions on, steelman on (5.3), layered exposition template
     - adjudication: skeptic gate, contradictions on, steelman on, verdict template
     - investigation: skeptic gate symmetric (5.3), contradictions on, steelman on, investigation template
     - literature_review: skeptic methodology-mode, PRISMA-style template
     - comparative: per-option steelman, matrix template
     - how_to: skeptic off, contradictions off, procedural template
     - recommendation: skeptic on for downsides, comparative + decision-layer template
     - exploratory: skeptic off, lighter retrieval, opinionated-friend template
     - position_brief: steelman as product, skeptic for anticipated counters, partisan disclosure header, rhetorical template
     - timeline: skeptic on for contested dates only, chronological template
     - reference_lookup: lightest possible pipeline — retrieval + single source verification + direct answer; skip 7 of the 10 stages
   - planGenerator.ts now reads from this module to populate the orchestrationProfile block (no more placeholder).

2. Orchestrator (researchOrchestrator.ts):
   - Reads the confirmed plan's orchestration_profile after resume.
   - Each existing stage call wraps in a profile check: if (profile.skepticMode === 'off') skip; if 'annotate' run with annotateOnly flag.
   - Existing agent code unchanged; only gating logic added.
   - For reference_lookup: short-circuit to a minimal retrieval + verification path that bypasses synthesis, plain_language, epistemic_persistence stages.
   - Progress event substep includes the active profile name so the UI can show "Running [Intent] orchestration".

3. Output templates (services/formatting/templates/):
   - 12 new templates, one per intent. Reuse existing templating infrastructure.
   - Templates control: section ordering, heading style, citation placement, sidebar vs inline annotation, plain-language footer presence.
   - Factual Report template: who/what/when/where/how/why, no contested-claims section, no skeptical sidebar.
   - Survey template: established → contested → hypothesized → lore → open questions, sidebar for skeptical annotations.
   - Adjudication template: claim under examination → strongest case for → strongest case against → verdict → load-bearing weaknesses.
   - Investigation template: framing → primary evidence → contested zones (symmetric) → unresolved questions.
   - Literature Review: abstract → methods → findings → discussion → limitations → references.
   - Comparative: dimensions table → per-option analysis → optional recommendation.
   - How-To: prerequisites → numbered steps → expected outcomes → troubleshooting.
   - Recommendation: constraints summary → options analysis → recommendation → tradeoffs.
   - Exploratory: editorial intro → curated highlights → why-it-matters per item.
   - Position Brief: partisan disclosure header → thesis → supporting arguments → anticipated counterarguments → rebuttals.
   - Timeline: chronological events with date precision indicators.
   - Reference Lookup: direct answer → source → confidence.

4. Skeptic annotation channel:
   - When profile says 'annotate', Skeptic outputs go to a separate annotations array on the report, not into the main narrative.
   - DossierReportSection renders annotations as a collapsible sidebar.
   - Backward compatibility: existing 'gate' mode behavior preserved for adjudication and investigation intents.

5. Dossier statistics aggregator update:
   - Now populates agents_ran and agents_skipped from the active profile.
   - Stage_durations captures which stages were skipped (NULL duration for skipped stages, recorded so the UI can show "5 stages skipped per Reference Lookup profile").

6. Frontend:
   - DossierReportSection renders the appropriate template (template name read from v_dossier.plan_payload).
   - Skeptical annotations sidebar component for annotate-mode reports.
   - DossierStatisticsSection shows the profile name and agents-skipped count prominently. "Reference Lookup ran 3 of 10 stages, completing in 12 seconds."

Fences unchanged. Rule 20 preamble untouched. Tier identifiers untouched.

Standing instruction in effect.

Acceptance: each of 12 intents produces a distinguishable output template, skeptic gating behaves per-profile, reference_lookup completes in <30s for simple queries, agents_ran/agents_skipped correctly recorded per intent, existing tests pass, all 12 intent templates render without layout regression on /dossiers/:id, no change to backend tier identifiers, no orchestrator changes outside the profile-gating wrapper logic.

Proceed.

Wave 5.3 — Steelman + Source Classes + Reasoner Constraint
textWave 5.3: The epistemics upgrade.

New Steelman agent between Retriever Analysis and Skeptic. Source-class dimension orthogonal to existing tier identifiers. Reasoner constraint: consensus alone does not debunk.

Dependencies: Wave 5.2 merged.

Build:

1. Migration 035:
   - Add column claims.source_class (text, nullable for legacy; CHECK in ('suppressed_and_recovered', 'actively_contested', 'consensus_held', 'consensus_collapsed', NULL)).
   - Add column citations.source_class (same enum).
   - Add column claims.steelman_summary (text, nullable) — the strongest case as constructed by Steelman.
   - Index on (source_class) for both tables.

2. Steelman agent (services/reasoning/steelmanService.ts):
   - New agent. Runs between retriever_analysis and challenge (skeptic) when profile.steelmanMode != 'off'.
   - Input: extracted claims + retrieved sources.
   - For each significant claim in the contested or hypothesized layer: construct the strongest charitable version — best supporting argument, best mechanistic case, best primary-source backing.
   - Output: steelman_summary written to claims table. Skeptic then attacks the steelman, not the strawman.
   - Profile modes: 'off' (factual_report, how_to, exploratory, reference_lookup), 'standard' (survey, adjudication, literature_review, recommendation, timeline), 'per_option' (comparative), 'as_product' (position_brief — steelman IS the output), 'symmetric' (investigation — steelman both affirmation and denial).

3. Source-class classifier (services/planning/sourceClassClassifier.ts):
   - Runs during retriever_analysis or as a sub-pass.
   - For each retrieved source, classifies into one of four classes:
     - suppressed_and_recovered: officially denied/dismissed, later confirmed by primary documents (FOIA, declassification, sworn testimony). Examples canon: MKULTRA, Operation Northwoods, Havana Syndrome.
     - actively_contested: currently denied by official sources but has on-the-record statements/sworn testimony/primary documents supporting.
     - consensus_held: broadly accepted by institutional sources, no significant primary-document or sworn-testimony challenge.
     - consensus_collapsed: was consensus, no longer (e.g., dietary-fat-as-heart-disease-cause, lab-leak category shift).
   - Classification uses the planning LLM (already wired in 5.1).
   - Confidence scored; low-confidence defaults to NULL (unclassified) rather than guessing.

4. Skeptic behavior conditional on source class:
   - For consensus_held: skeptic challenges the claim's basis.
   - For actively_contested: skeptic challenges BOTH the denial and the affirmation symmetrically.
   - For suppressed_and_recovered: skeptic notes the suppression history but does not use suppression as evidence either direction.
   - For consensus_collapsed: skeptic flags the shift and treats current claims accordingly.
   - These behaviors live in updated skeptic prompts (in the planning prompts.ts space, not the Rule 20 fence — confirm this fence reading; if skeptic prompts are in constants/prompts.ts, stop and ask for founder direction on whether they're in the fence).

5. Reasoner constraint (services/reasoning/reasoningModelPolicy.ts):
   - Add policy constraint: "Reasoner may not use 'this contradicts consensus' as a primary reason to downgrade a claim's tier. Reasoner may use 'this contradicts the structural mechanism by which X must work' as a reason. Consensus is treated as testimony from the institutional class, not as established_fact."
   - This goes into reasoningModelPolicy.ts which is NOT in the Rule 20 fence (it governs policy, not the preamble). Verify; if it IS Rule 20-fenced, stop and ask.
   - Reasoner prompt updated to reflect the constraint. If the reasoner prompt lives in constants/prompts.ts (Rule 20 fence), STOP. The constraint must live somewhere editable; surface to founder for direction.

6. Dossier statistics:
   - dossier_statistics gains source_class breakdown (jsonb count per class).
   - Steelman pass count.

7. Frontend:
   - SourceProvenancePanel (renamed in Wave 4) shows source-class badge alongside tier badge for each cited source.
   - New small badge component SourceClassBadge — four classes, four colors.
   - DossierStatisticsSection shows source-class distribution.
   - Methodology page gets a new explainer block about the four source classes (apply Rule 31 vocabulary).

Fences: backend tier identifiers untouched (source class is orthogonal); Rule 20 preamble untouched; tier color tokens untouched.

Standing instruction. If Reasoner prompt is fence-locked, stop and ask.

Acceptance: migration clean, Steelman agent runs per profile mode, source-class classifier produces values with NULL for low-confidence, skeptic behavior verifiably differs per source class (test by seeding contrived claims in each class), reasoner constraint enforced (test: a claim that contradicts consensus but has primary-document support is not downgraded), v_dossier exposes new fields, source-class badges render on cited sources, no change to tier identifiers, no preamble modification.

Proceed.

Wave 5.4 — Auto-Confirm + Saved Profiles + Cleanup
textWave 5.4: Power-user features and end-state cleanup.

Account-level auto-confirm. Saved orchestration profiles. Plan history UI. /reports URL deletion. Final marketing pass.

Dependencies: Wave 5.3 merged.

Build:

1. Auto-confirm UI:
   - AccountPage gets new section "Plan Confirmation". Toggle for auto_confirm_enabled. Slider for auto_confirm_threshold (0.7 to 0.95, default 0.85). Live preview: "With these settings, your last 30 days of plans would have auto-confirmed N% of the time."
   - confirmed_streak logic: increment when user confirms without refinement; reset to 0 on any refinement or cancel. Eligibility check (default 5 confirmations without refinement) before the UI first offers auto-confirm via inline suggestion banner.
   - Gate behavior change: when auto-confirm enabled AND classifier confidence ≥ threshold AND topic is not flagged as out-of-distribution: panel materializes with a 5-second countdown "Auto-confirming in 5s — click to intervene". Any click pauses the countdown. Confirm proceeds; Refine opens the input as normal.
   - Out-of-distribution detection: if topic_analysis.competenceAssessment indicates novelty, suppress auto-confirm even when enabled. Always show full gate for low-confidence runs regardless of setting.

2. Saved profiles:
   - Migration 036: table saved_orchestration_profiles (id, user_id, org_id, name, description, base_intent, customizations jsonb, is_shared bool, created/updated). RLS.
   - UI on AccountPage and on the Plan Panel itself: "Save this plan as a profile" button. Profiles selectable from a dropdown above the query input on /research.
   - Sovereign Enterprise tier: org-shared profiles (is_shared=true; visible to all org members). Pro and BYOK get user-only profiles. Free Demo gets none.
   - Profile applies: when a profile is selected, the plan generator uses the profile's customizations as a starting point, then refines based on the specific query. Gate still appears for confirmation.

3. Plan history UI:
   - New page /dossiers/:id/plan-history (or as tab on detail page).
   - Shows all plan_revisions for the dossier: each revision's instruction, diff summary, timestamp, who made the change.
   - Read-only audit trail. Useful for Sovereign customers who need to demonstrate methodology decisions.

4. /reports URL deletion:
   - Remove vercel.json redirect entries (Vercel handles 308 → 404 gracefully after old links age out; or keep redirects but remove the page files).
   - Delete frontend/src/pages/ReportsPage.tsx and ReportDetailPage.tsx.
   - Remove any remaining /reports references in code.
   - Update sitemap if not already done.

5. Final marketing pass:
   - Full rewrite of landing/methodology/pricing/faq/about/compare/guide to lead with the Dossier framing.
   - New section on methodology: "How ResearchOne plans your research" — walks through the gate flow.
   - New section on methodology: "The four source classes" — Wave 5.3 epistemic upgrade explained.
   - Pricing page reflects: Free Demo opens to all intents, gate always shown, single-frontier planning model, quality differentiation by source count + Steelman pass + Source-Class dimension + retention.
   - Compare page updated with the verbatim competitor quotes block from Wave 4 plus the new Dossier differentiator angle.

6. Free Demo quality differentiation enforcement:
   - Free Demo: 10-20 sources retrieved per run, Steelman off, source-class dimension off (tier only), watermark on export, 30-day retention, smaller open-weight model for inference stages (planning model still frontier per founder direction).
   - Pro: 50-100 sources, Steelman on, source-class on, no watermark, indefinite retention.
   - BYOK: customer model selection for inference stages (planning model still frontier on ResearchOne's account or BYOK depending on config).
   - Sovereign Enterprise: customer choice everywhere, on-prem deployment per existing infra.

Standing instruction. Fences unchanged.

Acceptance: auto-confirm UI functional with eligibility logic, countdown behavior verified, saved profiles work per-tier, plan history page renders complete revision audit, /reports URLs cleaned up, marketing pass complete with no residual "reports as artifact" language, Free Demo restrictions enforced and clearly displayed in the UI, Lighthouse a11y ≥95 on all new surfaces.

Proceed.

That's the full Wave 5 plan. Four prompts, one PR each, agent figures out the rest. Each one references the prior wave's data model and rules — agent reads the repo and works it out.
If you want any of them tightened further before pasting, say so. Otherwise paste 5.0 first, watch the agent work, repeat.