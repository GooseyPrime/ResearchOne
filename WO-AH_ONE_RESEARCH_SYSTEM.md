# WO-AH — One research system

Repo: `GooseyPrime/ResearchOne`. Base: `main` after PR #227 merges.
Branch via the helper: `bash scripts/git/prepare-work-branch.sh one-research-system`

Rule 32 (never commit to `main`), Rule 44 (full self-check before review), Rule 22
(out-of-scope discoveries are implemented or tracked, never dismissed) all apply.

---

## 0. The instruction, in the operator's words

> ALL REPORTS SHOULD NOW USE THE SAME SYSTEM SINCE THERE ARE INTELLIGENT LLM
> AGENTS ORCHESTRATING THE REPORT AS THEY ASSESS IT FROM THE USER'S REQUEST.

> the skeptic … should be run on everything. we need to verify that the research
> is correct no matter what type of request the user has.

> do not drop any function or any specialist. keep them all. make everything a
> "deep research" run but the orchestrating agents must be trained to know when
> an additional adversarial pass is needed.

Two constraints follow and neither is negotiable:

- **Nothing is deleted from the pipeline.** Every specialist, every agent, every
  stage stays. This work order removes *choices*, not *capabilities*.
- **The floor rises; the ceiling stays agent-decided.** Every run gets the
  challenge pass. Whether a run gets the *stronger* form of it remains the
  planner's decision, made from the request.

---

## 1. What "v1 / v2" actually is today

`engine_version` does not select an engine. Every run goes through the same
orchestrator, intent classifier, plan gate and specialists. `'v2'` vs `null`
changes four things and nothing else:

| # | What it changes | Where |
|---|---|---|
| 1 | A separate deep-report quota | `checkTierAccess(…, isDeep)`, `incrementReportCount(userId, isDeep)` |
| 2 | A placeholder objective when none was given | `api/routes/research.ts:279` |
| 3 | `RED_TEAM_V2_SYSTEM_PREFIX` on the skeptic / internal_challenger prompt | `reasoningModelPolicy.ts:65` |
| 4 | Which of two 1,000+ line pages renders the form | `UnifiedResearchConsole` |

Item 3 is the important one. The Deep card's own copy sells it:

> Full multi-stage pipeline with research types, longer reports, and **a skeptic
> step that argues against the draft to catch weak claims.**

So a Standard run today ships a *weaker adversarial pass than the product
describes*, and the difference is a paywall rather than a judgement about the
request. That is what this work order ends.

### Where the user picks it

Two surfaces, both to be removed:

- `ResearchEasyPage` — a "Depth" row, `Standard` / `Deep` buttons, Deep disabled
  on free tier with *"Deep Research is available on paid tiers."*
- `ResearchEngineModeToggle` in the Lab surface — two cards.

---

## 2. The agents already decide — the floor is what is missing

`ORCHESTRATION_PROFILES` in `services/planning/orchestrationProfiles.ts` is keyed
by intent, and each profile already sets `skepticMode`:

```
'off'       the challenge stage is skipped entirely
'annotate'  challenges are raised and recorded alongside the draft
'gate'      challenge runs BEFORE synthesis and can block it
```

Seventeen profiles. **Seven set `'off'`**, and `factual_report` also carries
`skipOnly('challenge')`, removing the stage from the run.

This is already "the agents decide" — it is just deciding *not to verify* for
seven request types. The change is to raise the floor:

- **No profile may set `skepticMode: 'off'`.** The minimum is `'annotate'`.
- **No profile may skip the `challenge` stage.**
- `'gate'` is the *additional* adversarial pass the operator described, and stays
  the planner's call per intent.

That is the whole behavioural change. Nothing is added to the pipeline and
nothing is removed from it.

---

## 3. Work items

### AH-1 — Floor the challenge pass

`services/planning/orchestrationProfiles.ts`

1. Change every `skepticMode: 'off'` to `'annotate'`.
2. Remove `challenge` from every `agentsToSkip` / `skipOnly` list.
3. Add a compile-time or test-time assertion that no profile can regress to
   `'off'` or skip `challenge`. A rule that lives only in seventeen literals is
   a rule that will be broken by the eighteenth.

**T1:** write the assertion first, watch it fail against the current profiles,
then change them.

### AH-2 — One adversarial instruction, not two

`services/reasoning/reasoningModelPolicy.ts`

`RED_TEAM_V2_SYSTEM_PREFIX` is applied only when `engineVersion === 'v2'`. Apply
it to every challenge pass. Rename the constant — it no longer describes a
version.

**T4 write-down required:** state what gating it on v2 protected. If the answer
is "nothing except cost", say so in the PR rather than implying it was a
safeguard.

### AH-3 — Rename Skeptic to **Challenge Pass** on public surfaces

Approved by the operator. `Verifier` was rejected: it is already a distinct agent
that audits the finished report against epistemic standards (evidence tiers
present, inferences not stated as facts, citations exist). Renaming Skeptic to
Verifier would collide with the thing closest to what a reader means by "verify".

Also already taken: `internal_challenger`, `final_revision_verifier`,
`story_verifier`, `contract_auditor`.

Sixteen frontend files reference it. Enumerate by grep, not from this list:

```
frontend/src/components/landing/{ComparisonTable,HeroPipelineVisual,ModeMatrix,
  PipelineDiagram,PipelineSchematic,pipelineSchematicData}.tsx|.ts
frontend/src/components/landing/persona/personaContent.ts
frontend/src/components/landing/visual/{AnimatedPipelineHero,personaBeamPalettes,pipelineLayout}
frontend/src/pages/{MarketingDocsPage,MethodologyPage,ModelsPage,
  ResearchV2GuidePage,ResearchDeepPage,ResearchStandardPage}.tsx
```

**Scope boundary:** rename the *user-facing label*. Internal role keys
(`skeptic`, `pipeline_skeptic`, the `SkepticMode` type, `skepticMode` field,
`agent_executions.agent_role` values) stay as they are. Renaming a persisted
enum is a migration with a data-integrity story; renaming a label is copy.
`services/telemetry/costSidecar.ts` maps roles to a `Skeptic` phase name that
reaches the admin dashboard — treat that as internal for now and note it.

Rule 39/36 apply: Tier A marketing copy has a banned-jargon CI gate. Run it.

### AH-4 — Remove the user-facing Standard / Deep choice

- `ResearchEasyPage`: delete the Depth row, `EasyDepth`, `depth`, `setDepth`,
  `selectedEngineVersion`, and the `deepLocked` reset effect.
- `UnifiedResearchConsole`: delete `ResearchEngineModeToggle`, `mode`,
  `handleModeChange`, `DeepResearchUpgradeModal`, `researchModeFromSearchParams`,
  `applyResearchModeToSearchParams`, `syncEngineQueryParam`.
- `ResearchStandardPage` / `ResearchDeepPage`: **one form remains.** Merge, do
  not pick — the Lab form's controls (objective, model rows, persona, citation
  style, output prefs) are capabilities and AH's constraint is that capabilities
  are kept. The EZ surface stays as the simple entry point.
- `researchRunRoutes`: remove `DEEP_RESEARCH_ENGINE_QUERY`,
  `isDeepResearchEngine`, `isDeepResearchFromSearchParams`,
  `DEEP_RESEARCH_PAGE_URL`, `researchPagePathForEngine`, `researchPagePathForRun`.
- `useCanAccessDeepResearch`, `DeepResearchUpgradeModal`,
  `ResearchLegacyV2Redirect`, `/app/guide/research-v2`: resolve each. A redirect
  that exists for a removed mode is dead; a guide page describing two modes needs
  rewriting, not deleting.

**T3:** grep every producer and consumer of `engine_version` and `engineVersion`
in both workspaces before removing any of it. There were 32 frontend files and
30 backend files at last count.

### AH-5 — `engine_version` at the API boundary

- `api/routes/research.ts`: stop reading `engineVersion` from the request body.
- Keep writing `engine_version` on the row **for now** — it is the only thing
  distinguishing historical runs, and `v_dossier` projects it.
- The v2-placeholder objective (`GENERAL_EPISTEMIC_RESEARCH`) now applies to
  every run that arrives without an explicit objective.

### AH-6 — The quota, deliberately deferred

`checkTierAccess(…, isDeep)` and `incrementReportCount(userId, isDeep)` ration
deep reports separately, and `monthlyDeepReportCap` is wired into tier rules,
billing tests and pricing copy.

**Do not change this in AH.** The operator's sequencing is explicit: *"Get the
product fixed as we want it first, then figure out how the final cost is
calculated."*

Until then every run is deep by behaviour while `isDeep` still keys on
`engine_version`, which after AH-5 is set by nothing. That means **every run
counts against the general cap and none against the deep cap** — a real change in
who can run what. State it in the PR body explicitly. Do not paper over it.

---

## 4. Definition of done

1. No orchestration profile can set `skepticMode: 'off'` or skip `challenge`,
   and a test fails if one is added that does.
2. The adversarial instruction is identical for every run.
3. No user-facing Standard / Deep choice exists on any surface.
4. No specialist, agent or stage was removed from the pipeline.
5. "Skeptic" does not appear on any public surface; internal role keys unchanged.
6. Marketing jargon CI gate passes.
7. The quota consequence in AH-6 is stated in the PR body, not discovered.
8. Rule 44 self-check in full; both bots reviewed; every finding answered.

## 5. Known follow-ups, tracked not dismissed

- **`docs/FOLLOW-UP_fabricated-run-metrics.md`** — `mapApiRunToVaultRun` hardcodes
  `sourcesRetrieved: 0`, `contradictionsDetected: 0`, `evidenceTier: 'supported'`.
- **WO-AG (cost accounting)** — written up separately in
  `WO-AG_COST_ACCOUNTING.md`. Summary: the admin dashboard is unreachable (no nav
  entry), nothing has ever written to `model_pricing`, and 7 of 9 default agent
  roles use models absent from it — so their cost freezes at `$0` at write time,
  indistinguishable from cheap and unrepairable afterwards. Routing is never to
  be gated on price; cost is derived from recorded usage at read time so a price
  assigned later values the history.
