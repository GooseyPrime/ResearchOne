# CRITICAL RESEARCHONE CORRECTNESS WORK ORDER
## Comprehensive Intent, Report Contract, EZ Mode, and Output-Format Audit and Repair

Repository:

`GooseyPrime/ResearchOne`

Work against the current `main` branch.

This is a correctness repair, not a cosmetic change.

Do NOT patch only the reported opportunity-discovery failure.

Audit and repair the ENTIRE research pipeline so every supported report intent produces the appropriate research method, agent behavior, structure, deliverables, verification rules, and user-facing format for that intent.

The central requirement is:

> ResearchOne must adapt itself to the user's research request. The user must NOT adapt their language to ResearchOne's internal schemas.

A normal EZ Research user should be able to describe what they want in natural language.

ResearchOne must infer:

- primary intent
- secondary intent(s), when applicable
- required deliverables
- requested or implied item count
- useful per-item information
- user constraints
- appropriate specialist agents
- appropriate research depth
- appropriate source strategy
- appropriate report structure
- appropriate challenge/skeptic behavior
- appropriate output format
- sensible report length

The system must expose those inferred choices in the INITIAL PLAN GATE so the user can inspect, refine, remove, or add requirements before confirming the run.

The user must not be required to know internal intent names, template IDs, required field names, or “magic prompt wording.”

---

# PART 1 — REPRODUCTION FAILURE THAT TRIGGERED THIS WORK

A recent EZ Research request explicitly contained:

`Primary research intent: opportunity_discovery`

and requested exactly:

`20 market verticals`

with extensive ranking, monetization, affiliate, competition, economics, and implementation information.

Despite that, the resulting report was routed/rendered as a comparative-style report and eventually refused to perform the requested ranking because it decided the corpus lacked enough evidence.

The final report then introduced sections including:

- `Falsification Criteria for Future Recommendations`
- `Evidence Thresholds for Vertical Inclusion`
- `Path Forward for Evidence Gathering`

and concluded that the requested opportunity ranking should not be performed.

This is unacceptable intent drift.

The user's speech act was:

> Find, evaluate, rank, and recommend opportunities.

It was NOT:

> Try to falsify whether opportunities exist.

This exact request/report must become a permanent regression fixture.

Locate the current report/request artifact if available in the repository and add the prompt as a deterministic regression fixture.

---

# PART 2 — ROOT CAUSE #1: EXPLICIT USER INTENT MUST OVERRIDE LEXICAL CLASSIFICATION

Inspect:

`backend/src/services/planning/intentClassifier.ts`

Current classifier behavior performs a lexical fast path over the entire request.

This permits words such as:

- comparison
- compare
- recommendation
- feasibility
- review

to potentially override an explicit intent declaration elsewhere in the prompt.

That is backwards.

## Required precedence

Intent resolution must follow this precedence:

### 1. Explicit user intent declaration

If the user clearly specifies a supported ResearchOne intent in natural language or structured text, such as:

- `Primary research intent: opportunity_discovery`
- `Intent: feasibility`
- `Use opportunity discovery`
- `Treat this as a literature review`
- `I want a recommendation report`

that declaration controls unless it is invalid or contradictory.

Do not let incidental vocabulary override it.

### 2. Explicit user refinement at plan gate

If the user changes the intent during plan refinement, the refined intent controls.

### 3. Strong natural-language speech-act inference

If no explicit intent exists, classify based on what the user is asking the system to DO.

### 4. Lexical fallback

Lexical triggers may assist classification but must never override an explicit declaration.

---

# PART 3 — ROOT CAUSE #2: NON-ADJUDICATIVE REPORTS ARE STILL CONTAMINATED BY THE REASONING-FIRST PREAMBLE

Inspect:

`backend/src/constants/prompts.ts`

and:

`backend/src/services/openrouter/openrouterService.ts`

The code currently distinguishes STANDARD prompts from adjudicative prompts, but many STANDARD prompts are still wrapped using `withPreamble(...)`.

`withPreamble(...)` injects the `REASONING_FIRST_PREAMBLE`, which includes concepts such as:

- alternate framing
- adversarial counter-modeling
- falsification branching
- contradictions
- unresolved tension
- marginalized or anomalous claims

This contaminates non-adjudicative research even when downstream prompts say not to do so.

## Fix this structurally.

The standard/non-adjudicative path must use a neutral research-integrity preamble.

Use or improve:

`withStandardPreamble(...)`

for normal research roles.

Do NOT make the universal default research personality an adversarial scientific falsification exercise.

### Normal research integrity should mean:

- answer the user's actual question
- use appropriate sources
- distinguish sourced facts from inference
- identify important uncertainty
- avoid fabricated claims
- cite material factual assertions
- acknowledge meaningful conflicting sources when they actually exist

It should NOT automatically mean:

- generate competing hypotheses
- falsify the premise
- challenge every conclusion
- attack assumptions
- construct counter-models
- add contradiction sections
- add falsification sections

Those behaviors belong only where the confirmed intent requires them.

---

# PART 4 — DEFINE REPORT FAMILIES CORRECTLY

Review every supported intent in:

`backend/src/services/planning/intentTaxonomy.ts`

Current supported intents include at least:

- factual_report
- survey
- adjudication
- investigation
- story_verification
- opportunity_discovery
- feasibility
- implementation
- literature_review
- comparative
- how_to
- recommendation
- exploratory
- position_brief
- timeline
- reference_lookup
- legacy

Audit EVERY ONE.

Do not assume existing template definitions are correct merely because they exist.

For each intent explicitly define:

1. What the user is asking ResearchOne to accomplish.
2. Appropriate orchestration behavior.
3. Required core agents.
4. Optional specialists.
5. Whether skeptic/challenger runs.
6. Whether steelman runs.
7. Whether contradiction analysis is appropriate.
8. Whether falsification is appropriate.
9. Appropriate report structure.
10. Appropriate verifier criteria.
11. Appropriate contract-auditor criteria.
12. Appropriate default depth.
13. Appropriate default source strategy.
14. Appropriate user-facing output label.

---

# PART 5 — STRICT BOUNDARY FOR FALSIFICATION / ADVERSARIAL MACHINERY

The following behaviors must NOT appear simply because ResearchOne is a research platform:

- Falsification Criteria
- falsification branching
- hypothesis falsification
- premise attacks
- adversarial counter-modeling
- mandatory contradiction analysis
- full skeptic challenge
- steelman-vs-skeptic debate structure

These must be intent-controlled.

## Full adjudicative behavior

Appropriate for things such as:

### adjudication
Examples:

- Is this claim true?
- Fact-check this.
- Verify whether X happened.

### story_verification
Examples:

- Is this reported story accurate?
- Did this event actually happen?

### investigation

Use stronger challenge behavior when the requested speech act is genuinely investigative or causal.

Do not infer investigation merely because a topic is controversial.

---

# PART 6 — NORMAL NON-ADJUDICATIVE REPORT TYPES

The following generally must NOT receive falsification sections:

### factual_report
Purpose:

Provide accurate factual explanation.

Typical output:

- overview
- key facts
- background
- relevant context
- sources

### survey
Purpose:

Explain a broad landscape.

Typical output:

- major themes
- categories
- developments
- relationships
- open areas

### opportunity_discovery
Purpose:

Find and rank opportunities.

Typical output:

- landscape
- opportunities
- comparative metrics
- rankings
- opportunity details
- recommended moves

### feasibility
Purpose:

Determine whether something can realistically be done.

Typical output:

- requirements
- blockers
- dependencies
- costs/resources
- risks
- viable paths
- recommendation

### implementation
Purpose:

Explain how to execute.

Typical output:

- prerequisites
- architecture
- phases
- dependencies
- implementation sequence
- validation
- deployment

### literature_review
Purpose:

Review academic literature.

Typical output:

- search/scope
- major findings
- areas of agreement
- meaningful disagreements
- limitations
- gaps
- bibliography

Disagreement is not automatically falsification.

### comparative
Purpose:

Compare alternatives.

Typical output:

- comparison criteria
- comparison matrix
- tradeoffs
- scenario fit
- recommendation when requested

### how_to
Purpose:

Provide actionable instructions.

Typical output:

- prerequisites
- steps
- warnings
- verification

### recommendation
Purpose:

Help choose.

Typical output:

- options
- criteria
- scoring
- tradeoffs
- recommendation
- rationale

### exploratory
Purpose:

Explore possibilities.

Typical output:

- promising directions
- emerging questions
- interesting connections
- potential next investigations

### position_brief
Purpose:

Present the strongest support for a requested position.

Do not silently transform it into adjudication.

### timeline
Purpose:

Build chronology.

### reference_lookup
Purpose:

Answer a narrow factual question efficiently.

---

# PART 7 — REPAIR `intentOutputTemplates.ts`

Inspect:

`backend/src/services/formatting/templates/intentOutputTemplates.ts`

and frontend mirror:

`frontend/src/lib/intentOutputTemplates.ts`

These must be true canonical contracts.

For every intent verify:

- intent ID
- display title
- narrative hint
- sections
- required deliverables
- optional deliverables
- verifier rubric
- skeptic behavior
- plain-language behavior
- sidebar behavior
- frontend/backend parity

The templates must not inherit generic adjudicative requirements.

Add automated parity tests between frontend and backend intent definitions where practical.

---

# PART 8 — REMOVE THE HARD-CODED OPPORTUNITY “MEGA-SCHEMA”

Inspect:

`backend/src/services/reasoning/researchOrchestrator.ts`

There is currently deterministic opportunity validation that searches every opportunity for a fixed list of markers such as:

- target customer
- problem
- demand
- competitor
- differentiation
- MVP
- stack
- monetization
- acquisition
- risk
- validation
- narrative briefing
- basic project needs
- build prompt
- test prompt
- deployment prompt
- acceptance criteria
- confidence
- evidence

This is wrong as a universal contract.

An opportunity-discovery report does NOT inherently require every one of those fields.

That is exactly the kind of schema burden EZ Mode is supposed to hide from users.

## Replace this with adaptive contract validation.

Required fields must come from:

1. what the user explicitly requested
2. what ResearchOne inferred as necessary to satisfy that request
3. the inferred report structure shown to the user at the plan gate
4. anything added or removed through plan refinement
5. only minimal universal fields genuinely needed for that report family

Example:

User:

> Find me 20 good SaaS affiliate niches and rank them by income potential.

ResearchOne may infer:

- vertical
- rationale
- monetization potential
- competition
- ranking

It should NOT suddenly require:

- build prompt
- test prompt
- deployment prompt
- MVP scope
- target customer

unless those are relevant to the user's request or ResearchOne proposes them in the plan and the user confirms them.

Another user may say:

> Find five business opportunities and give me a build prompt and deployment plan for each.

Then build/deployment become required because the user requested them.

That is the correct adaptive behavior.

---

# PART 9 — RESEARCHBRIEF MUST SUPPORT INFERRED REQUIREMENTS, NOT ONLY EXPLICIT USER FIELDS

Inspect:

`backend/src/services/planning/researchBrief.ts`

Current `RequestedArtifact.requiredFields` is described primarily as information the user explicitly requested.

Expand the contract concept to distinguish:

### Explicit requirements
Directly requested by user.

### Inferred necessary requirements
Information ResearchOne determines is needed to competently fulfill the request.

### Optional enrichment
Useful but not required.

### Excluded scope
Explicitly outside the plan.

Do not silently enforce inferred requirements.

Expose them in the plan preview before confirmation.

Suggested model:

```ts
interface RequestedArtifact {
  description: string;
  exactCount?: number;

  explicitRequiredFields?: string[];
  inferredRequiredFields?: string[];
  optionalFields?: string[];
}
```

or an equivalent clean representation.

Do not adopt this exact type if a better architecture fits the existing code.

The invariant matters more than this specific schema.

---

# PART 10 — EZ MODE MUST BE TRULY ADAPTIVE

Inspect:

`frontend/src/pages/ResearchEasyPage.tsx`

and Rule 38.

EZ Mode must remain simple.

The initial surface should still allow a user to type a natural-language research request without filling out a giant form.

But the system must infer a complete draft ResearchBrief.

The flow should be:

USER REQUEST

↓

INTENT + DELIVERABLE INFERENCE

↓

OPTIONAL CLARIFICATION ONLY WHEN REALLY USEFUL

↓

INITIAL PLAN GATE

↓

USER CAN MODIFY ANY INFERRED REQUIREMENT

↓

CONFIRM

↓

EXECUTE EXACTLY THAT PLAN

Do not require users to manually state every internal report field.

---

# PART 11 — PLAN GATE MUST DISPLAY THE COMPLETE INFERRED CONTRACT

Inspect:

`frontend/src/components/research/ResearchBriefPreview.tsx`

and:

`frontend/src/components/research/PlanConfirmationPanel.tsx`

The plan preview must clearly show:

## What ResearchOne understands you want

Example:

> Find and rank commercially viable affiliate comparison-site opportunities.

## Deliverables

Example:

> 20 ranked opportunities.

## Information ResearchOne plans to include

Example:

- monetization model
- affiliate-program availability
- buyer intent
- competition
- automation potential
- estimated revenue scenarios
- risk
- recommendation

The user must be able to remove or add these through plain-language refinement.

## Ranking / decision criteria

Show inferred weighting or criteria where meaningful.

## Agent team

Show user-friendly specialist descriptions.

## Sources / research strategy

Plain-language summary.

## Report format

Show inferred or user-selected format.

## Report length

Show inferred or user-selected target.

## Assumptions

Editable.

## Not included

Explicit boundaries.

The initial plan is where ResearchOne and the user align.

Do NOT wait until the final report to discover what ResearchOne thought the user wanted.

---

# PART 12 — FIX EZ MODE REPORT FORMAT AND REPORT LENGTH OPTIONS

This requirement has been repeatedly requested and is still missing.

There is already a reusable component:

`frontend/src/components/research/ResearchOutputControls.tsx`

It already supports:

REPORT FORMAT:

- Automatic / Best fit
- Ranked options
- Narrative briefing
- Step-by-step guide
- Comparison table
- Structured report / Technical spec

REPORT LENGTH:

- Short (~1,200)
- Standard (~2,200)
- Long (~4,000)
- Extra long (~7,000)
- Custom word count

It also supports citation style and research objective.

EZ Mode currently does NOT expose report format or report length.

Fix this.

## Required EZ behavior

Keep the primary EZ interface clean.

Add an optional expandable section such as:

`Output preferences`

or:

`Customize report`

Inside it provide:

### Report Format

Default:

`Automatic / Best fit`

User may optionally choose one or more appropriate formats.

### Report Length

Default:

`Automatic`

IMPORTANT:

Do not force Standard ~2,200 as the semantic default for EZ Mode.

If untouched, ResearchOne should infer an appropriate target from:

- task complexity
- number of requested items
- requested artifacts
- intent
- desired report type

A request for 20 heavily researched market opportunities obviously cannot reasonably fit the same default length as a simple reference lookup.

Add an `automatic` length mode if one does not already exist.

If user explicitly chooses a length, that choice controls.

### Citation style

This may remain optional/advanced but should be available if desired.

### Research objective

Do NOT require an EZ user to understand internal ResearchOne research-objective modes.

Leave this automatic by default and put manual objective selection behind a more advanced disclosure if retained in EZ.

---

# PART 13 — ENSURE EZ OPTIONS ARE ACTUALLY SENT TO THE BACKEND

Currently `ResearchEasyPage.tsx` sends essentially:

- query
- supplemental
- engineVersion
- files
- URLs
- crawl settings

It does not send the complete report output preferences.

Wire EZ Mode through the existing API so that explicit user selections propagate:

- requestedFormats
- targetWordCount
- citationStyle where chosen
- other relevant supported output preferences

These values must appear in the generated plan.

They must survive confirmation.

They must reach synthesis.

They must reach report generation.

They must be persisted in report/run metadata where applicable.

Test the entire chain.

Do not merely add controls visually.

---

# PART 14 — FIX AUTOMATIC LENGTH ESTIMATION

The report-length model must adapt to the requested artifact.

Examples:

Reference lookup:

~300–800 words may be enough.

Simple factual overview:

~1,200–2,000.

Deep literature review:

potentially 4,000–8,000+.

20 detailed opportunities:

potentially several thousand words beyond the ordinary Standard preset.

Do not arbitrarily truncate a complex artifact because the global default is 2,200 words.

The initial plan must estimate a sensible word range based on expected content.

If the user explicitly chooses a preset or custom word count, honor it.

If the requested artifact physically cannot fit reasonably in the selected length, warn at the plan gate but still respect the user's choice if they confirm it.

---

# PART 15 — FIX CLARIFICATION BEHAVIOR

EZ clarification must remain:

- optional
- limited
- useful
- non-blocking

Do not ask users questions merely because internal schema fields are missing.

Bad clarification:

> What exact required fields should every opportunity contain?

ResearchOne should infer that.

Better clarification:

> Do you care more about fastest path to revenue or largest long-term income potential?

Only ask when the answer materially changes the research.

Even then, skipping must be allowed.

The inferred answer/assumption should appear in the plan.

---

# PART 16 — AUDIT ORCHESTRATION PROFILES FOR EVERY INTENT

Inspect:

`backend/src/services/planning/orchestrationProfiles.ts`

For each supported intent confirm:

- correct stage list
- correct specialist roster
- skeptic mode
- steelman mode
- output template
- source strategy
- methodology
- research objective
- execution planner behavior

Do not use the same pipeline merely because all stages exist.

Examples:

reference lookup should be lightweight.

how-to does not require a skeptic gate.

opportunity discovery should use:

- market scout
- competitor mapper
- demand signal analyst
- feasibility architect when useful
- data analysis specialist when quantitative ranking is requested

Adjudication should use more adversarial review.

---

# PART 17 — MODE OVERLAYS MUST NOT REINTRODUCE WRONG BEHAVIOR

Inspect:

`backend/src/constants/modeOverlays.ts`

Current `GENERAL_EPISTEMIC_RESEARCH` still includes language such as:

> Each major hypothesis should have its own section.

That is inappropriate for normal general research.

Remove hypothesis language from normal-mode overlays.

Normal general research should not presume hypotheses exist.

Audit every overlay for intent contamination.

The research objective may modify HOW the system investigates.

It must not override WHAT the user asked the system to produce.

Intent controls the speech act.

Objective controls research emphasis.

These are not interchangeable.

---

# PART 18 — SYSTEM PROMPT AUDIT

Audit every role in:

`backend/src/services/openrouter/openrouterService.ts`

including:

- planner
- retriever
- reasoner
- steelman
- skeptic
- synthesizer
- verifier
- plain_language_synthesizer
- outline_architect
- section_drafter
- internal_challenger
- coherence_refiner
- revision agents
- contract_auditor
- market_scout
- competitor_mapper
- demand_signal_analyst
- feasibility_architect
- story_verifier
- timeline_reconstructor
- data_analysis_specialist
- quantitative_quality_auditor

For each prompt ask:

> Could this prompt force a market discovery, factual, recommendation, implementation, comparison, or how-to report to behave like an adjudication?

If yes, fix it.

Also fix outdated language such as:

> disciplined anomaly research system

where it is being used as the universal identity for ordinary ResearchOne tasks.

ResearchOne is a multi-purpose deep research platform.

PolicyOne/anomaly/adversarial methodology is a capability, not the mandatory worldview of every report.

---

# PART 19 — VERIFIER MUST BE INTENT-SPECIFIC

Inspect:

`buildVerifierPromptForIntent(...)`

Good direction already exists here.

Finish the job.

Each intent needs its own rubric.

Examples:

## Opportunity Discovery verifier

Check:

- requested count delivered
- requested/inferred fields present
- ranking consistent
- significant factual claims sourced
- economic assumptions clearly identified
- recommendation follows scoring criteria
- no invented market facts
- no unrequested falsification section

## How-to verifier

Check:

- prerequisites included
- steps complete and ordered
- commands/instructions internally consistent
- verification steps included
- warnings where materially necessary
- no unrelated adversarial analysis

## Recommendation verifier

Check:

- options satisfy user constraints
- comparison criteria are consistently applied
- recommendation follows analysis
- material facts sourced
- uncertainty stated where relevant

## Literature review verifier

Check:

- search scope clear
- literature represented accurately
- meaningful disagreements preserved
- citations complete
- research gaps identified

Not:

> Does every major claim have a falsification criterion?

---

# PART 20 — CONTRACT AUDITOR MUST PROTECT AGAINST REPORT-TYPE BLEED

Strengthen `contract_auditor`.

It must detect:

### Wrong intent

Example:

opportunity request rendered as comparative.

### Wrong speech act

Example:

requested ranking replaced with refusal to rank.

### Wrong count

20 requested; fewer delivered.

### Missing requested fields

### Added forbidden report-family sections

Example:

`Falsification Criteria` appearing in opportunity_discovery.

### Unconfirmed inferred requirements

ResearchOne may not invent a large mandatory schema after plan confirmation.

### User formatting preference ignored

### User report-length preference ignored

### Plan/report mismatch

The final artifact should match the CONFIRMED plan, not merely the original prompt.

---

# PART 21 — REPORT GENERATOR MUST NOT ADD HEADINGS THE TEMPLATE DOES NOT AUTHORIZE

Inspect:

`backend/src/services/reasoning/reportGenerator.ts`

The current template-based section path is an improvement.

Harden it.

For a known non-legacy intent:

- require outputTemplateId
- validate intent/template match
- use template sections
- prevent Coherence Refiner from adding unauthorized top-level sections
- prevent Section Drafter from generating a different speech act
- prevent Outline Architect from overriding mandatory template structure

The model may improve ordering or narrative inside the contract.

It may not redefine the contract.

---

# PART 22 — COHERENCE REFINER MUST PRESERVE THE CONTRACT

The Coherence Refiner currently receives the draft and returns full markdown.

That means it can potentially reintroduce forbidden sections even if the section-generation loop was correct.

Give it an explicit intent/template contract.

For non-adjudicative reports:

> Do not add Falsification Criteria, Contradiction Analysis, hypothesis testing, or adversarial sections unless present in the confirmed output template.

After refinement, perform deterministic heading validation.

If an unauthorized heading appears, reject/repair the output.

---

# PART 23 — REPORT REVISION PIPELINE

Audit:

`backend/src/services/reasoning/reportRevisionService.ts`

and related revision roles.

Revisions must preserve the original confirmed report intent unless the user explicitly requests a speech-act change.

For example:

> Add more pricing information.

must not turn an opportunity report into an investigation.

Revision verification should validate against the report's intent-specific contract.

Generic revision prompts mentioning:

- contradictions
- falsification criteria
- epistemic distinctions

must be conditional.

---

# PART 24 — FRONTEND DOSSIER RENDERING

Inspect:

`frontend/src/components/dossiers/DossierReportSection.tsx`

Ensure:

- correct output template title appears
- correct section labels appear
- challenge sidebar only appears for intents/modes where appropriate
- plain-language output appears where intended
- no stale template metadata makes an opportunity report display as Comparative
- report metadata's intent and template match the confirmed plan

The current dossier UI should NEVER say:

`Output layout: Comparative`

for a confirmed `opportunity_discovery` run.

Add a runtime/frontend assertion or defensive warning if metadata contains an intent/template mismatch.

---

# PART 25 — PLAN PREVIEW USER EXPERIENCE

The user should never have to understand terms like:

- epistemic posture
- falsification
- general epistemic research
- canonical profile
- hypothesis plan

to use EZ Research.

User-facing plan text should say things like:

- Market opportunity analysis
- Product comparison
- Literature review
- Feasibility analysis
- Implementation plan
- Fact verification
- Timeline reconstruction

Keep internal IDs internal unless the user opens advanced details.

---

# PART 26 — UPDATE RULE 37

Update:

`.cursor/rules/37-intent-driven-report-contracts.mdc`

Add the following invariant explicitly:

> Required fields are contract-derived, not globally hard-coded by report family.

And:

> Explicit intent declarations override lexical trigger matches.

And:

> Non-adjudicative roles must not be wrapped with the reasoning-first / falsification-oriented system preamble.

And:

> The final Coherence Refiner is contract-bound and may not invent unauthorized top-level sections.

---

# PART 27 — UPDATE RULE 38

Update:

`.cursor/rules/38-ez-research-and-lab-mode.mdc`

Add:

### EZ Output Preferences

EZ Research must expose optional:

- report format
- report length
- custom word count
- citation style where desired

These controls should be hidden/collapsed by default so EZ remains simple.

Automatic inference remains the default.

Explicit user selections become plan constraints.

Also explicitly document:

> Users are not responsible for supplying all required fields for an internal report template. ResearchOne infers necessary details and exposes them in the plan preview for refinement.

---

# PART 28 — AUTOMATED TEST MATRIX

Do not consider this work complete without broad regression tests.

Build a table-driven test suite covering EVERY supported intent.

For each intent use at least one representative natural-language query.

Assert:

1. primary intent
2. secondary intent where applicable
3. epistemic posture
4. resolved methodology
5. output template
6. skeptic mode
7. presence/absence of falsification
8. presence/absence of contradiction section
9. required output sections
10. contract auditor behavior
11. report generator section plan

Representative cases:

### factual_report

> Tell me about the history and current use of lithium-ion batteries.

MUST NOT produce falsification.

### survey

> Give me a landscape overview of current solid-state battery technologies.

MUST NOT produce falsification.

### adjudication

> Is it true that Company X falsified its published results?

May use adjudicative framework.

### story_verification

> Verify whether this reported event actually happened.

Adjudicative behavior appropriate.

### opportunity_discovery

> Find 20 affiliate comparison-site opportunities and rank them by earning potential.

MUST produce 20 opportunities.

MUST NOT produce Falsification Criteria.

### feasibility

> Could I build this using my existing server without new monthly expenses?

MUST answer feasibility.

### implementation

> Give me a deployment plan for this Node/Postgres service.

MUST produce implementation plan.

### comparative

> Compare PostgreSQL and MySQL for this workload.

MUST produce comparison.

### recommendation

> Which of these three hosting options is best for a small SaaS?

MUST recommend.

### how_to

> Show me how to configure this service behind Nginx.

MUST provide steps.

### literature_review

> Review the current peer-reviewed literature on X.

MUST produce literature-review structure.

### exploratory

> Explore promising new applications for this technology.

MUST explore.

### position_brief

> Make the strongest evidence-based case for adopting this policy.

MUST produce the requested position brief.

### timeline

> Build a timeline of the major events.

MUST produce chronology.

### reference_lookup

> What year was X founded?

MUST be concise.

---

# PART 29 — EXPLICIT INTENT PRECEDENCE TESTS

Add regression tests such as:

```text
Primary research intent: opportunity_discovery.
Compare the economics of 20 affiliate markets and recommend the best one.
```

Expected:

`opportunity_discovery`

NOT:

`comparative`

Test similar collisions.

Explicit intent must win.

---

# PART 30 — EZ MODE TESTS

Update/add:

`frontend/src/__tests__/pages/ResearchEasyPage.test.tsx`

Test:

### Defaults

- EZ remains simple.
- Advanced output preferences collapsed/optional.
- Automatic format by default.
- Automatic length by default.

### User chooses format

Select:

`Ranked options`

Verify API receives requestedFormats.

### User chooses length

Select:

`Long`

Verify API receives expected targetWordCount.

### Custom length

Verify custom value propagates.

### Plan preview

Verify selected/inferred format and length appear.

### Adaptive requirements

Verify inferred fields appear in plan preview but are editable.

### Clarifications

Verify user may skip.

---

# PART 31 — BACKEND OUTPUT-PREFERENCE TESTS

Verify:

EZ frontend selection

→ startResearch

→ research route

→ ResearchJobData

→ plan payload

→ confirmed plan

→ report generator

→ persisted report metadata

The values must survive all stages.

---

# PART 32 — ADD THE ACTUAL FAILED REPORT AS A REGRESSION

Use the current affiliate opportunity request as a fixture.

The expected result does not need to contain identical market opportunities every run.

But the contract MUST enforce:

- intent = opportunity_discovery
- exactly 20 opportunity objects
- final ranking
- requested economics
- requested scenario estimates
- requested top 10 / top 5 / top 3
- one final winner
- user-requested implementation information
- no top-level Falsification Criteria
- no refusal to perform opportunity ranking merely because perfect primary data is unavailable
- clearly label unknowns/assumptions instead

ResearchOne should research externally to close gaps.

An incomplete initial corpus is a retrieval problem, not automatically a reason to abandon the user's deliverable.

---

# PART 33 — CRITICAL RETRIEVAL BEHAVIOR

The failed report repeatedly said:

> the retrieved corpus does not contain the necessary affiliate program information.

That is not sufficient for a deep-research platform.

If the confirmed plan requires information that the initial corpus does not contain, ResearchOne should use its discovery/source-connector process to FIND the required information within configured limits.

Do not confuse:

`the current chunks do not contain X`

with:

`X cannot be researched`.

The system should:

1. identify missing required data
2. generate targeted retrieval/discovery queries
3. retrieve authoritative sources
4. continue synthesis
5. only leave a field unknown after reasonable retrieval attempts fail

Add tests around missing-data recovery where possible.

---

# PART 34 — UNKNOWN DATA POLICY

ResearchOne must not fabricate.

But lack of perfect information does NOT mean the whole report fails.

For fields that remain unknown:

- mark `Unknown`
- identify what was checked
- lower confidence
- continue with available information

Example:

If cookie duration for Merchant X cannot be verified:

`Cookie duration: Unknown — current public program documentation did not specify it.`

Do not throw away the entire 20-market ranking because three merchants have incomplete terms.

---

# PART 35 — SOURCE QUALITY WITHOUT “EVIDENCE RELIGION”

ResearchOne should still maintain serious research quality.

Keep:

- citations
- authoritative sourcing
- primary sources where useful
- confidence calibration
- fact/inference distinction
- meaningful uncertainty
- important source disagreements

But user-facing business, implementation, recommendation, comparison, and informational reports should read like professional reports for their PURPOSE.

Do not litter them with irrelevant vocabulary such as:

- epistemic integrity
- falsification
- contradiction preservation
- adversarial analysis
- hypothesis testing

unless the task genuinely calls for those concepts.

Internal quality control may remain rigorous without making every final report sound like a philosophy-of-science dissertation.

---

# PART 36 — REPORT FORMAT QUALITY AUDIT

Review the actual rendered structure produced for every intent.

For each report family confirm that formatting is professional and useful.

Examples:

Opportunity report:

- executive summary
- ranking table
- individual opportunities
- portfolio analysis
- final recommendation

Comparison:

- criteria
- matrix/table
- detailed analysis
- scenario fit
- recommendation

Implementation:

- architecture
- requirements
- phases
- numbered execution steps
- test/verification
- deployment

Literature review:

- scope/method
- thematic findings
- agreements/disagreements
- gaps
- conclusions
- references

Do not force identical section architecture across unrelated report families.

---

# PART 37 — DO NOT SOLVE THIS WITH KEYWORD BLACKLISTING ALONE

Do not merely remove the word “falsification” from output.

This is an architectural intent-control problem.

Fix:

- classification
- prompt selection
- preambles
- orchestration
- templates
- section planning
- refinement
- verification
- contract auditing
- plan UX
- output preference propagation

Keyword-based guards can be used as final safety assertions, but they are not the primary fix.

---

# PART 38 — DO NOT BREAK RESEARCH LAB

Research Lab remains the expert interface.

Do not remove:

- objective selection
- model selection
- orchestration profiles
- source controls
- saved profiles
- add-ons
- citation style
- report format
- report length
- deep research controls

EZ Mode and Research Lab share backend correctness but maintain different UX complexity.

---

# PART 39 — CODE QUALITY

Do not produce giant duplicate conditional blocks.

Centralize intent-family logic.

Prefer helpers such as conceptual:

```ts
isAdjudicativeIntent(intent)
supportsChallenge(intent)
supportsFalsification(intent)
resolveReportContract(brief)
resolveOutputPreferences(...)
```

Use the existing architecture where appropriate.

Do not create competing sources of truth.

The canonical flow should be:

ResearchBrief
→ confirmed plan
→ canonical orchestration profile
→ intent output template
→ execution
→ report generator
→ intent verifier
→ contract auditor
→ persisted report

---

# PART 40 — VALIDATION

Run all relevant backend and frontend tests.

At minimum run tests covering:

- intent classifier
- ResearchBrief parsing
- orchestration runtime
- intent-driven reports
- report generator
- contract auditor
- output template parity
- ResearchEasyPage
- ResearchBriefPreview
- ResearchOutputControls
- plan refinement

Also run:

- TypeScript compile/typecheck
- frontend build
- backend test suite
- existing banned-jargon/public-copy checks required by repository rules

Do not mark complete with failing tests.

---

# PART 41 — DELIVERABLE

Implement the fixes.

Then provide a final engineering report containing:

## Root Causes

List every root cause found.

## Files Changed

Explain each modified file and why.

## Intent Matrix

Show every supported intent and:

- methodology
- skeptic mode
- falsification allowed?
- default output structure
- verifier type

## EZ Mode Changes

Show exactly how:

- format
- length
- inferred requirements
- plan refinement

now work.

## Regression Coverage

List the new tests.

## Failed Opportunity Report Regression

Show that the supplied 20-opportunity request now resolves to:

`opportunity_discovery`

and that its contract requires:

`20 opportunities`

without forcing unrelated falsification sections.

## Verification

Provide test/build results.

## Remaining Risks

Only list genuine unresolved issues.

---

# NON-NEGOTIABLE ACCEPTANCE CRITERIA

Do not declare completion until ALL of these are true:

1. Explicit user intent cannot be overridden by incidental lexical matches.

2. Non-adjudicative reports no longer receive the reasoning-first falsification/adversarial preamble.

3. Opportunity discovery no longer has one universal hard-coded mega-schema.

4. Required fields are derived adaptively from the request + inferred plan.

5. Inferred requirements appear at the plan gate before execution.

6. Users can refine those requirements naturally.

7. EZ Mode has optional Report Format controls.

8. EZ Mode has optional Report Length controls.

9. Automatic report length adapts to task size.

10. Explicit format/length selections propagate end-to-end.

11. Every supported report intent has an appropriate output contract.

12. Every supported report intent has an appropriate verifier.

13. Coherence refinement cannot add unauthorized report sections.

14. Contract auditor detects report-type bleed.

15. Opportunity discovery does not produce Falsification Criteria unless the user explicitly requested an adjudicative treatment.

16. The supplied 20-opportunity request produces exactly 20 opportunity items.

17. Missing source data triggers further discovery/retrieval when possible rather than immediate abandonment of the requested deliverable.

18. Unknown facts remain unknown rather than fabricated.

19. Research Lab functionality is preserved.

20. All relevant tests and builds pass.

This is a platform-wide correctness repair.

Do not make a narrow patch for one prompt.

Do not stop after changing prompt text.

Trace every supported report type from EZ intake through final dossier rendering and make the system behave according to the user's actual research goal.