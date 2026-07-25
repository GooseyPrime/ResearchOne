# ResearchOne All-Purpose Deep Research Redesign

**Repository audited:** `GooseyPrime/ResearchOne`  
**Repository state reviewed:** `main` at commit `037390019ede958b42c259c562fe9d1700fbc4e9`  
**Audit date:** July 24, 2026  
**Failure example reviewed:** `onlinbusinessreport.md`

## Executive conclusion

ResearchOne’s underlying platform is substantially better than the attached output suggests. It already has:

- a 12-category research-intent taxonomy;
- intent classification and a human plan-confirmation gate;
- per-intent orchestration profiles;
- source discovery, hybrid retrieval, reasoning, skeptic, verification, and citation stages;
- intent-specific output-template definitions;
- run telemetry, saved orchestration profiles, revisions, dossiers, and exports.

The central problem is not a missing capability. It is a broken connection between the capabilities.

ResearchOne correctly classifies what the user wants near the beginning of the pipeline, but the final planner and report generator largely discard that decision. Every substantive request is forced into the same hypothesis-and-falsification report contract. This makes an informational request behave like an attempted scientific refutation, and it explains the attached report’s downward spiral.

The required correction is:

> Make user intent the controlling contract for planning, agent selection, retrieval, synthesis, verification, and report shape. Treat falsification, contradiction analysis, and adversarial review as conditional tools—not mandatory sections in every report.

The best product direction is a two-layer interface:

1. **EZ Research** — a short AI intake conversation determines the intent, deliverable, constraints, research depth, and required agents. Most controls disappear.
2. **Research Lab** — preserves the existing advanced controls for expert users, including model selection, custom skeptic personas, saved orchestration profiles, objective selection, crawl depth, add-ons, and source filters.

This is an evolution of ResearchOne, not a rebuild.

---

## 1. What failed in the attached example

The user asked ResearchOne to:

- discover “true whitespace” for online web apps or microservices;
- produce ten opportunities;
- state the basic project requirements;
- provide detailed prompts for an AI to build each opportunity;
- respect a 24-hour build-to-production constraint;
- use available resources such as Stripe, hosting, databases, and AI APIs.

The delivered report did not satisfy the requested output contract:

- It did not deliver a useful list of ten opportunities.
- It did not provide detailed build prompts for the opportunities.
- It reframed “can be built in 24 hours” from a selection constraint into the report’s central hypothesis.
- It added patent analysis even though the request was primarily market discovery.
- It repeatedly discussed whether 24-hour production readiness could be falsified.
- It devoted entire sections to contradiction, falsification, unresolved questions, and recommended future research rather than completing the requested work.
- It treated absence of direct evidence for the entire class of 24-hour builds as a reason to interrogate the premise instead of ranking opportunities by buildability and clearly labeling uncertainty.

The pipeline therefore optimized for “defend or falsify a proposition” when the actual speech act was:

> **market/whitespace discovery + feasibility screening + actionable build planning**

The correct intent is a composite of exploratory discovery, recommendation, and implementation planning. The system’s current “single best intent” design is not expressive enough for this request, but even the single intent it did select was not honored downstream.

---

## 2. Root-cause analysis, with exact repository locations

### 2.1 The final planner turns every prompt into a hypothesis

In [`backend/src/services/openrouter/openrouterService.ts`](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/openrouter/openrouterService.ts#L760-L771), the base planner is instructed to:

- identify what would falsify “the hypothesis” before investigating;
- return `hypothesis` and `falsification_criteria` for every request.

This contract has no escape hatch for descriptive, enumerative, comparative, procedural, market-discovery, or recommendation work.

In [`backend/src/services/reasoning/researchOrchestrator.ts`](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/reasoning/researchOrchestrator.ts#L530-L561), the parser then guarantees those fields exist:

- on parse failure, `hypothesis` becomes the entire user query;
- `falsification_criteria` receives a generic contradiction sentence;
- even valid plans missing falsification are forcibly backfilled;
- a missing hypothesis is replaced with the user query.

That is the first hard-coded conversion of an open research request into an adjudicative experiment.

### 2.2 Intent is classified, but a second planner overwrites its meaning

ResearchOne performs a useful intent-classification and plan-generation stage at [`researchOrchestrator.ts` lines 432–495](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/reasoning/researchOrchestrator.ts#L432-L495). It classifies the request, produces a plan preview, and pauses for confirmation.

After confirmation, however, it calls a different planner at [`researchOrchestrator.ts` lines 506–565](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/reasoning/researchOrchestrator.ts#L506-L565). That planner uses the universal hypothesis/falsification schema and is not given the confirmed intent-specific report contract.

The user effectively approves Plan A, while the execution pipeline quietly creates Plan B.

### 2.3 Intent-specific output templates exist but do not control synthesis

[`backend/src/services/formatting/templates/intentOutputTemplates.ts`](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/formatting/templates/intentOutputTemplates.ts) defines sensible report structures for:

- factual reports;
- surveys;
- adjudications;
- investigations;
- literature reviews;
- comparisons;
- how-to reports;
- recommendations;
- exploratory reports;
- position briefs;
- timelines;
- reference lookups.

But the file itself says its `narrativeHint` is for “future use.” The template identifier is stored in report metadata at [`researchOrchestrator.ts` lines 983–1008](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/reasoning/researchOrchestrator.ts#L983-L1008), after synthesis has already happened. It does not govern the generated report.

This is the single most important incomplete integration in the repository.

### 2.4 The report generator hard-codes an adjudicative scientific report

[`backend/src/services/reasoning/reportGenerator.ts` lines 10–21](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/reasoning/reportGenerator.ts#L10-L21) defines one immutable ten-section plan:

1. Executive Summary
2. Research Question and Scope
3. Evidence Ledger
4. Reasoning and Analysis
5. Contradiction Analysis
6. Challenges and Alternative Explanations
7. Synthesis and Conclusions
8. Falsification Criteria
9. Unresolved Questions
10. Recommended Next Queries

Every non-reference report gets these sections. The outline model cannot remove them because [`reportGenerator.ts` lines 150–170](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/reasoning/reportGenerator.ts#L150-L170) explicitly supplies them as required. The generator then loops over the hard-coded `SECTION_PLAN`, not the model-produced outline.

The “Outline Architect” is therefore advisory theater: it may suggest an outline, but the section-drafting loop ignores it.

### 2.5 The synthesizer and verifier independently enforce falsification

Even after fixing the planner and section plan, the universal prompts would reintroduce the same bias:

- [`SYSTEM_PROMPTS.synthesizer`](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/openrouter/openrouterService.ts#L838-L854) requires Evidence Ledger, Contradiction Analysis, Challenges, Unresolved Questions, Falsification Criteria, and Recommended Next Queries.
- [`SYSTEM_PROMPTS.verifier`](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/openrouter/openrouterService.ts#L856-L871) fails a report if it lacks falsification criteria or a non-trivial contradiction analysis.
- [`SYSTEM_PROMPTS.section_drafter`](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/openrouter/openrouterService.ts#L890-L904) requires every major claim to carry visible evidence-tier labels and contains special mandatory falsification instructions.
- [`SYSTEM_PROMPTS.coherence_refiner`](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/openrouter/openrouterService.ts#L910-L920) again requires falsification and contradiction sections.

The bias is duplicated at four pipeline layers. Fixing only one prompt will not fix the product.

### 2.6 The default “General Research” objective is still hypothesis-centered

[`backend/src/constants/modeOverlays.ts` lines 36–45](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/constants/modeOverlays.ts#L36-L45) tells General Research to:

- identify multiple competing hypotheses;
- maintain parallel reasoning chains;
- allocate an outline section to each hypothesis;
- preserve unresolved tension.

This is good for contested questions, but wrong as the default for “find ten market opportunities,” “teach me a topic,” “summarize this technology,” or “create a build plan.”

The frontend description has the same bias: [`frontend/src/constants/researchObjectives.ts` lines 20–46](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/frontend/src/constants/researchObjectives.ts#L20-L46) describes General Research as balancing competing hypotheses.

### 2.7 The current intent classifier is useful but too brittle

[`backend/src/services/planning/intentTaxonomy.ts`](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/backend/src/services/planning/intentTaxonomy.ts) is a strong start, but:

- it allows exactly one intent;
- several trigger patterns are too narrow;
- `survey` contains the literal placeholder regex `how does X relate`;
- market research, opportunity discovery, feasibility analysis, requirements gathering, data analysis, forecasting, and due diligence are not first-class intents;
- “provide a list of ten opportunities and detailed prompts” can easily fall through to a generic intent;
- lexical selection returns high confidence after one pattern hit without measuring the requested deliverables;
- the LLM classifier receives the query but no structured deliverable-extraction schema.

The correct classifier should return a primary intent, optional secondary intent, requested artifacts, decision context, and epistemic posture.

### 2.8 UX copy primes users toward testing rather than researching

Both Standard and Deep forms tell the user to provide “the exact framing you want tested”:

- [`frontend/src/pages/ResearchStandardPage.tsx` line 620](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/frontend/src/pages/ResearchStandardPage.tsx#L612-L621)
- [`frontend/src/pages/ResearchDeepPage.tsx` line 788](https://github.com/GooseyPrime/ResearchOne/blob/037390019ede958b42c259c562fe9d1700fbc4e9/frontend/src/pages/ResearchDeepPage.tsx#L779-L789)

Deep mode immediately exposes:

- skeptic persona;
- research objective;
- report length;
- citation style;
- saved orchestration profile;
- supplemental context, crawling, files, and tags;
- per-role model ensemble;
- add-ons.

Those are valuable laboratory controls, but they should not be the default entry point for a general user.

### 2.9 Marketing narrows the product more than the underlying system warrants

The live home page says ResearchOne “tests its own conclusions,” describes a “ten-stage adversarial pipeline,” and ends with “Research that defends itself.” Those are differentiators, but the cumulative message makes the product appear to be an anomaly/adjudication platform rather than a broad deep-research system.

The site should lead with:

> ResearchOne plans, investigates, compares, explains, verifies, and produces decision-ready reports—using only the agents the task actually needs.

Then present adversarial review and contradiction preservation as premium rigor, not the definition of all research.

---

## 3. The corrected conceptual architecture

ResearchOne currently conflates three axes. They must become independent.

| Axis | Question answered | Examples |
|---|---|---|
| **Intent** | What does the user want produced? | explain, survey, verify, compare, recommend, discover opportunities, plan implementation |
| **Depth** | How much research should be performed? | quick, standard, deep, exhaustive |
| **Epistemic posture** | How should claims be challenged? | descriptive, balanced, skeptical, adversarial |

Two more independent controls should be added:

| Axis | Purpose |
|---|---|
| **Source strategy** | web breadth, primary-source priority, scholarly focus, recency, geographic or domain limits |
| **Deliverable contract** | required count, tables, ranked list, prompts, code plan, citations, audience, length, file format |

This permits combinations that the current objective menu cannot express:

- deep informational survey with no adversarial lane;
- quick verification of one story;
- exhaustive market opportunity scan with feasibility scoring;
- comparative product analysis with a recommendation;
- literature review with methods and evidence-quality grading;
- implementation guide with risk checks but no falsification section;
- anomaly investigation with full skeptic and contradiction agents.

---

## 4. Recommended intent model

Replace the single `IntentId` decision with a structured `ResearchBrief`.

```ts
type ResearchIntent =
  | 'explain'
  | 'factual_report'
  | 'landscape_survey'
  | 'story_verification'
  | 'claim_adjudication'
  | 'investigation'
  | 'literature_review'
  | 'comparison'
  | 'recommendation'
  | 'opportunity_discovery'
  | 'feasibility_assessment'
  | 'implementation_plan'
  | 'timeline'
  | 'reference_lookup'
  | 'data_analysis'
  | 'forecast_scenarios';

type EpistemicPosture = 'descriptive' | 'balanced' | 'skeptical' | 'adversarial';
type ResearchDepth = 'quick' | 'standard' | 'deep' | 'exhaustive';

interface ResearchBrief {
  primaryIntent: ResearchIntent;
  secondaryIntents: ResearchIntent[];
  depth: ResearchDepth;
  epistemicPosture: EpistemicPosture;
  userGoal: string;
  audience: string;
  constraints: string[];
  requestedArtifacts: Array<{
    kind: 'answer' | 'ranked_list' | 'table' | 'timeline' | 'evidence_matrix'
      | 'recommendation' | 'build_spec' | 'prompt_pack' | 'dataset' | 'other';
    count?: number;
    requiredFields?: string[];
  }>;
  sourceRequirements: {
    freshness?: string;
    primarySourcesPreferred: boolean;
    scholarlyOnly: boolean;
    allowedDomains?: string[];
    excludedDomains?: string[];
  };
  assumptionsRequiringConfirmation: string[];
  successCriteria: string[];
  confidence: number;
}
```

The example request should classify approximately as:

```json
{
  "primaryIntent": "opportunity_discovery",
  "secondaryIntents": ["feasibility_assessment", "implementation_plan"],
  "depth": "deep",
  "epistemicPosture": "balanced",
  "requestedArtifacts": [
    {
      "kind": "ranked_list",
      "count": 10,
      "requiredFields": [
        "problem",
        "target_customer",
        "evidence_of_gap",
        "existing_alternatives",
        "differentiation",
        "24_hour_mvp_scope",
        "required_services",
        "monetization",
        "risks",
        "validation_test"
      ]
    },
    {
      "kind": "prompt_pack",
      "count": 10,
      "requiredFields": ["build_prompt", "test_prompt", "deployment_prompt"]
    }
  ],
  "constraints": [
    "production candidate within 24 hours",
    "AI assistant has computer access",
    "Stripe available",
    "hosting and databases available",
    "multiple AI APIs available"
  ]
}
```

This brief makes it much harder for the system to forget the requested ten opportunities and prompts.

---

## 5. EZ Research mode

### 5.1 Default screen

The default Research page should show only:

- one large prompt box;
- file/link attachment button;
- a depth choice: **Quick / Thorough / Deep**;
- a primary button: **Plan my research**;
- an unobtrusive **Research Lab controls** link.

Do not expose model slugs, skeptic personas, tag filters, orchestration profiles, citation style, or agent fallbacks in EZ mode.

Suggested helper text:

> Tell ResearchOne what you need to know or produce. It can explain a topic, compare options, investigate a story, verify a claim, find opportunities, review literature, or build a decision-ready plan.

### 5.2 AI intake conversation

The intake agent should ask only questions that materially change the research. Maximum: three short questions in one turn.

For the attached example it might ask:

1. “Should the ten opportunities prioritize fastest revenue, strongest defensibility, or easiest 24-hour launch?”
2. “Should I exclude regulated products that would require legal or compliance review before public launch?”
3. “Do you want genuinely unserved markets only, or underserved niches where existing tools are weak or overpriced?”

If the user does not answer, ResearchOne should proceed with visible assumptions. It should not block on trivia such as citation style.

### 5.3 Plan preview

The preview should use plain language:

- **I understand the job as:** Find and rank ten viable online-service opportunities.
- **I will deliver:** A comparison table, evidence of market gaps, a 24-hour MVP scope, monetization, risks, and three build prompts per opportunity.
- **I will use:** Market scout, competitor mapper, demand-evidence analyst, feasibility architect, monetization analyst, skeptic, and report editor.
- **I will not turn this into:** A patent search or a binary proof/disproof exercise unless the evidence makes one relevant.
- **Assumptions:** [editable list]

Buttons:

- **Start research**
- **Change the plan**
- **Research Lab controls**

### 5.4 Auto-routing behavior

EZ mode chooses:

- intent and secondary intents;
- depth;
- epistemic posture;
- source classes;
- agent roster;
- report template;
- citation style appropriate to domain;
- whether clarification is required;
- whether quantitative extraction, code analysis, patent search, academic search, or story verification is needed.

The user sees the decision in normal language but does not have to understand internal agents.

---

## 6. Agent architecture

Do not merely add more agents to the existing universal chain. Build a capability registry and select agents per brief.

### 6.1 Core agents

| Agent | Responsibility | Usually required |
|---|---|---|
| Intake Clarifier | Resolves ambiguity and missing constraints | EZ mode |
| Intent & Deliverable Architect | Produces the `ResearchBrief` | All |
| Research Planner | Decomposes the brief without changing its speech act | All but trivial lookup |
| Query Strategist | Generates diverse searches by sub-question and source type | Standard+ |
| Web Investigator | Searches and pivots across public web sources | Most |
| Primary-Source Hunter | Locates official records, filings, datasets, papers, documentation | Standard+ |
| Source Assessor | Scores provenance, relevance, recency, independence, and conflicts | All sourced work |
| Evidence Extractor | Extracts exact support and limitations for each deliverable field | All sourced work |
| Citation Verifier | Confirms citation-to-claim entailment and URL integrity | All reports |
| Report Architect | Builds an intent-specific outline | All reports |
| Section Writer | Drafts to the deliverable contract | All reports |
| Contract Auditor | Confirms every requested artifact was delivered | All reports |

### 6.2 Conditional specialist agents

| Agent | Trigger |
|---|---|
| Story Verifier | story, rumor, event, allegation, authenticity, “what happened?” |
| Claim Adjudicator | explicit true/false, verify, debunk, confirm |
| Timeline Reconstructor | chronology or event-sequence questions |
| Literature Reviewer | scholarly or systematic review |
| Quantitative Analyst | numerical comparison, statistics, tables, calculations |
| Data Quality Auditor | conflicting datasets or extracted numerical claims |
| Market Scout | whitespace, underserved need, product or business opportunity |
| Competitor Mapper | alternatives, positioning, features, pricing, saturation |
| Demand Signal Analyst | complaints, search demand, procurement, community evidence |
| Feasibility Architect | buildability, stack, integrations, time and resource constraints |
| Monetization Analyst | pricing, unit economics, acquisition, willingness to pay |
| Implementation Planner | build specification, milestones, prompts, tests, deployment |
| Patent Specialist | patents, prior art, FTO, claim boundaries—not generic market discovery |
| Regulatory Specialist | legal/regulatory requirements when relevant |
| Geographic/Local Researcher | local availability, laws, vendors, demographics |
| Forecast/Scenario Analyst | forecasts, branching futures, sensitivities |
| Skeptic | important conclusions, high-stakes recommendations, contested evidence |
| Adversarial Twin | only explicit adversarial review or high-risk verification |

### 6.3 Agent-selection rules

Example: `opportunity_discovery + feasibility_assessment + implementation_plan`

Run:

- Intent & Deliverable Architect
- Research Planner
- Query Strategist
- Market Scout
- Competitor Mapper
- Demand Signal Analyst
- Feasibility Architect
- Monetization Analyst
- Source Assessor
- Evidence Extractor
- a bounded Skeptic pass
- Report Architect
- Section Writer
- Citation Verifier
- Contract Auditor

Do not run by default:

- Claim Adjudicator
- Patent Specialist
- Timeline Reconstructor
- full Adversarial Twin
- universal Falsification agent

### 6.4 “Training” clarification

The immediate need is not model fine-tuning. It is:

- clear role prompts;
- typed inputs and outputs;
- intent-conditioned prompt composition;
- retrieval/tool permissions per role;
- high-quality routing examples;
- regression evaluation;
- runtime observability.

Fine-tuning becomes worthwhile only after collecting a labeled set of misrouted and correctly routed ResearchOne runs. Prompt and architecture errors should not be baked into weights.

---

## 7. Prompt redesign

### 7.1 New intake/classifier system prompt

```text
You are ResearchOne's Research Brief Architect.

Your job is to preserve the user's requested speech act and deliverables.
Do not convert an informational, exploratory, comparative, procedural,
recommendation, or opportunity-discovery request into a hypothesis test.

Classify:
1. primary intent;
2. zero to three secondary intents;
3. requested artifacts and exact counts;
4. constraints;
5. audience;
6. freshness and source requirements;
7. appropriate epistemic posture;
8. missing information that would materially change the result.

Use falsification only when the user asks to verify/adjudicate a claim or when
a material causal hypothesis is actually part of the requested analysis.

Return strict JSON matching ResearchBrief.
Never drop explicit requested outputs. If the user requests ten items, record
count: 10. If the user requests prompts, record a prompt_pack artifact.
```

### 7.2 New planner system prompt

```text
You are ResearchOne's execution planner.

The confirmed ResearchBrief is binding. You may decompose it, but you may not
change its primary intent, requested artifacts, counts, constraints, or
epistemic posture.

Create research questions that collectively produce every requested field.
Choose source types appropriate to each question. Identify dependencies,
decision criteria, and stopping conditions.

For descriptive work, plan coverage and completeness checks.
For comparisons, plan consistent dimensions.
For recommendations, plan criteria and constraint checks.
For opportunity discovery, plan demand evidence, existing alternatives,
differentiation, build feasibility, monetization, and validation.
For verification, plan claim decomposition, provenance, corroboration,
counterevidence, and a verdict standard.

Only include hypotheses or falsification criteria where the brief explicitly
requires claim adjudication or causal testing. Otherwise use validation checks,
coverage checks, or decision criteria.

Return strict JSON matching ResearchExecutionPlan.
```

### 7.3 Report architect prompt

```text
You are ResearchOne's Report Architect.

Build the report outline from the confirmed ResearchBrief and selected
output template. The requested artifacts are mandatory acceptance criteria.

Do not add generic sections merely because they are common in research reports.
Falsification belongs only in adjudication or causal-hypothesis reports.
Contradiction analysis belongs only when material conflicts exist; otherwise,
integrate limitations where relevant.

Return ordered section objects with:
key, title, purpose, required_fields, evidence_inputs, approximate_word_share.
```

### 7.4 Section writer prompt

```text
You are a ResearchOne section writer.

Write only the assigned section. Follow its purpose and required fields.
Use the evidence supplied; do not invent facts, sources, products, prices,
statistics, or quotations.

Visible evidence-tier tags are optional and should be used only when the chosen
report template calls for them. In ordinary prose, communicate confidence and
limits naturally.

Answer the user's actual request. Do not replace delivery with discussion of
whether the request itself is testable.
```

### 7.5 Contract auditor prompt

```text
You are the final Deliverable Contract Auditor.

Compare the draft against the confirmed ResearchBrief.

Fail the draft if:
- a requested artifact is missing;
- an exact requested count is not met;
- a required field is missing from any list item;
- a user constraint was ignored;
- the report changed the speech act;
- citations do not support material factual claims;
- the conclusion is more confident than the evidence;
- the report spends substantial space critiquing the premise instead of
  delivering the requested work, unless premise verification was requested.

Return strict JSON with pass, missing_requirements, unsupported_claims,
intent_drift, and revision_instructions.
```

### 7.6 Conditional verifier rubrics

Replace the single universal verifier rubric with:

- `verifyInformationalReport`
- `verifyComparison`
- `verifyRecommendation`
- `verifyOpportunityDiscovery`
- `verifyLiteratureReview`
- `verifyStoryInvestigation`
- `verifyClaimAdjudication`
- `verifyImplementationPlan`

All rubrics should verify citations and intent fidelity. Only adjudication and causal testing should require falsification criteria.

---

## 8. Report templates

### 8.1 General informational report

1. Direct answer / executive summary
2. Definitions and scope
3. Core findings by topic
4. Mechanisms or context
5. Important limitations or disagreements
6. Practical implications
7. Sources

### 8.2 Story verification report

1. Bottom-line assessment
2. Exact claims being checked
3. Origin and propagation of the story
4. Confirmed facts
5. Unsupported or contradicted elements
6. Source provenance and media evidence
7. Alternative explanations
8. Confidence and remaining unknowns

### 8.3 Opportunity-discovery report

1. Executive summary
2. Method and filters
3. Ranked opportunity table
4. One complete opportunity card per item:
   - customer and painful problem;
   - evidence of unmet or underserved demand;
   - current alternatives and why they fall short;
   - differentiation;
   - 24-hour MVP boundary;
   - stack and services;
   - monetization;
   - acquisition path;
   - risks and disqualifiers;
   - cheapest validation experiment;
   - confidence.
5. Portfolio comparison and top three
6. Recommended first build
7. AI build/test/deploy prompt pack
8. Sources

### 8.4 Recommendation report

1. Recommendation first
2. User constraints
3. Evaluation criteria and weights
4. Options matrix
5. Trade-offs
6. Sensitivity analysis
7. Implementation next step

### 8.5 Claim adjudication report

This is where the current ResearchOne structure belongs:

1. Claim and verdict
2. Claim decomposition
3. Evidence for
4. Evidence against
5. Contradictions and source quality
6. Alternative explanations
7. Falsification or resolution criteria
8. Confidence and unresolved questions

The current pipeline is not wrong. It is being applied universally.

---

## 9. File-by-file implementation plan

### Priority 0: stop universal falsification

1. **`backend/src/services/reasoning/reportGenerator.ts`**
   - Replace global `SECTION_PLAN` with `buildSectionPlan(researchBrief, outputTemplate)`.
   - Pass `intent`, `requestedArtifacts`, `epistemicPosture`, and `outputTemplateId`.
   - Iterate over the resolved outline, not the old constant.
   - Derive minimum word counts from selected sections rather than `10 × 80`.

2. **`backend/src/services/openrouter/openrouterService.ts`**
   - Remove universal falsification requirements from planner, synthesizer, verifier, section drafter, and coherence refiner.
   - Keep reusable epistemic standards: source grounding, uncertainty, contradiction preservation when contradictions exist, and no unsupported facts.
   - Add intent-specific verifier prompts.

3. **`backend/src/services/reasoning/researchOrchestrator.ts`**
   - Stop generating a second intent-blind plan.
   - Convert the confirmed `PlanPayload` into the execution plan, or pass the confirmed brief into the execution planner.
   - Make `hypothesis` and `falsification_criteria` optional.
   - Do not backfill them for descriptive requests.
   - Pass the selected output template into `generateIterativeReport` before synthesis.

4. **`backend/src/services/reasoning/researchOrchestratorTypes.ts`**
   - Replace mandatory `hypothesis: string` and falsification arrays with a discriminated plan schema:
     - `descriptive`
     - `decision`
     - `discovery`
     - `adjudicative`
     - `causal_test`

5. **Database compatibility**
   - Keep the existing nullable `reports.falsification_criteria` field for historical reports.
   - Store `null` or `[]` for non-adjudicative reports.
   - Add `research_brief jsonb`, `execution_plan jsonb`, and `report_contract jsonb` to runs/reports.
   - Tolerate migration skew per repository rules.

### Priority 1: make existing intent machinery real

6. **`backend/src/services/planning/intentTaxonomy.ts`**
   - Expand intent IDs.
   - Add secondary intents.
   - Replace placeholder/narrow regexes.
   - Add market/opportunity, feasibility, implementation, data-analysis, forecast, and story-verification categories.

7. **`backend/src/services/planning/intentClassifier.ts`**
   - Replace `{intent, confidence, reasoning}` with `ResearchBrief`.
   - Use lexical rules only as signals, not a 0.92-confidence final answer after one hit.
   - Add deliverable extraction and exact-count detection.
   - Add uncertainty-driven clarification.

8. **`backend/src/services/planning/prompts.ts`**
   - Replace the single-intent prompt.
   - Make “preserve speech act and explicit deliverables” the top rule.
   - Include positive and negative routing examples from real failures.

9. **`backend/src/services/planning/orchestrationProfiles.ts`**
   - Move from one fixed profile per intent to capability selection:
     - required agents;
     - optional agents;
     - skip rules;
     - skeptic intensity;
     - source connectors;
     - output template.

10. **`backend/src/services/formatting/templates/intentOutputTemplates.ts`**
    - Change templates from passive metadata into the canonical synthesis contract.
    - Add required fields, optional sections, conditional sections, verifier rubric, and delivery validation.

11. **Frontend mirror**
    - Avoid maintaining duplicate template logic in `frontend/src/lib/intentOutputTemplates.ts`.
    - Expose canonical template descriptors through an API or generate a shared package.

### Priority 2: EZ mode

12. **`frontend/src/pages/UnifiedResearchConsole.tsx`**
    - Add `EZ Research` and `Research Lab` tabs.
    - Make EZ Research the default.
    - Keep Standard/Deep engine selection as an implementation detail in EZ mode.

13. **New `frontend/src/pages/ResearchEasyPage.tsx`**
    - Prompt, attachments, depth, plan preview, intake conversation, confirmation.

14. **New intake components**
    - `ResearchBriefPreview.tsx`
    - `ResearchClarificationChat.tsx`
    - `ResearchDeliverablesChecklist.tsx`
    - `ResearchAssumptionsEditor.tsx`

15. **`ResearchDeepPage.tsx` and `ResearchStandardPage.tsx`**
    - Move existing advanced controls under Research Lab.
    - Change “framing you want tested” to “what you need to know or produce.”
    - Keep expert controls fully available.

16. **Plan gate**
    - Show the detected intent, deliverables, agent roster, assumptions, and exclusions.
    - Allow natural-language changes such as “skip patent analysis” or “make revenue potential the top ranking criterion.”

### Priority 3: specialist agents and tools

17. Add a typed agent registry:

```ts
interface AgentCapability {
  id: string;
  supportedIntents: ResearchIntent[];
  requiredInputs: string[];
  outputSchema: ZodSchema;
  tools: string[];
  costClass: 'low' | 'medium' | 'high';
  canRunInParallel: boolean;
}
```

18. Add specialist roles gradually:
    - market scout;
    - competitor mapper;
    - demand signal analyst;
    - feasibility architect;
    - monetization analyst;
    - story verifier;
    - timeline reconstructor;
    - data quality auditor;
    - contract auditor.

19. Separate “skeptic” from “contract auditor.”
    - The skeptic challenges conclusions.
    - The contract auditor ensures the requested work was actually delivered.
    - The attached failure would likely pass an epistemic skeptic but fail the contract auditor instantly.

### Priority 4: marketing and onboarding

20. **Landing-page copy**
    - Replace anomaly-centric product framing with all-purpose research framing.
    - Keep contradiction preservation as a differentiator.
    - Replace “every objective passes through a ten-stage adversarial pipeline” with “ResearchOne assembles the right research team for each job.”

21. **Capability examples**
    - Explain a technical topic.
    - Verify a developing story.
    - Compare expensive products.
    - Conduct a literature review.
    - Find market opportunities.
    - Reconstruct an event timeline.
    - Build an implementation plan.

22. **Sample reports**
    - Publish at least four:
      - informational;
      - story verification;
      - opportunity discovery;
      - literature review.

---

## 10. Tests and evaluation

### 10.1 Must-have unit tests

Add classifier fixtures such as:

- “Teach me how lithium-ion batteries work.” → `explain`, descriptive, no falsification.
- “Is this viral story about a bank collapse true?” → `story_verification`, skeptical.
- “Compare the five best local LLM workstations under $1,200.” → comparison + recommendation.
- “Find ten underserved SaaS opportunities buildable in 24 hours and give build prompts.” → opportunity + feasibility + implementation; count 10; prompt pack required.
- “What evidence would disprove the Younger Dryas impact hypothesis?” → causal/adjudicative; falsification required.
- “Summarize current TN tenant law.” → factual report; primary legal sources; no hypothesis conversion.

### 10.2 End-to-end acceptance tests

For every fixture assert:

- intent is preserved from brief to report;
- requested item counts are exact;
- all required fields are present;
- forbidden generic sections are absent;
- citation coverage meets threshold;
- report does not invent sources;
- report does not replace delivery with premise criticism;
- selected agents match the brief;
- plan confirmation changes propagate to the execution plan;
- report template controls actual generated headings.

### 10.3 Golden-report comparison

Create a labeled evaluation corpus of 50–100 prompts across intents. For each prompt store:

- expected primary and secondary intents;
- mandatory artifacts;
- forbidden drift;
- acceptable section families;
- expected agent roster;
- high-quality reference report outline.

Score:

| Metric | Proposed launch threshold |
|---|---:|
| Primary intent accuracy | ≥95% |
| Mandatory artifact recall | ≥98% |
| Exact-count compliance | 100% |
| Intent drift rate | <2% |
| Citation entailment | ≥95% sampled material claims |
| Unsupported material claims | <2% |
| User-rated usefulness | ≥4.3/5 |

### 10.4 Regression test for the attached failure

Use the exact prompt from `onlinbusinessreport.md`.

The test must fail unless:

- ten opportunities are delivered;
- each contains required project needs;
- each contains detailed build guidance/prompts;
- the 24-hour constraint is applied as a feasibility filter;
- the report ranks opportunities;
- patent analysis appears only where directly relevant;
- falsification is not a top-level report section;
- the report spends less than 10% of its content questioning the premise.

---

## 11. Product positioning

Current leading deep-research products emphasize broad multi-step investigation and source-backed synthesis. OpenAI describes deep research as useful for finance, science, policy, engineering, shopping, and other complex knowledge work, with attachments, real-time progress, and source control. ResearchOne should match that breadth while differentiating on:

- explicit intent and deliverable contracts;
- visible plan confirmation;
- adaptive specialist-agent teams;
- contradiction preservation;
- per-claim provenance;
- story-verification mode;
- configurable epistemic posture;
- revision lineage and living dossiers;
- expert Research Lab controls;
- transparent “what was not researched” boundaries.

That is a stronger niche than “another deep research chatbot,” and broader than “anomaly research.”

Recommended positioning:

> **ResearchOne turns any serious question into a research plan, assembles the right specialist agents, and delivers a citation-backed work product that matches what you actually asked for.**

Supporting line:

> Explain it. Compare it. Investigate it. Verify it. Build from it.

---

## 12. Rollout order

### Phase A — correctness patch

- Remove universal falsification from planner and verifier.
- Make the final report sections intent-driven.
- Pass confirmed intent/template into synthesis.
- Add the attached prompt as a regression fixture.

This phase fixes the damaging behavior without redesigning the frontend.

### Phase B — ResearchBrief and contract audit

- Introduce primary/secondary intents and requested artifacts.
- Add exact-count and required-field extraction.
- Add the final Deliverable Contract Auditor.
- Add intent-specific verifier rubrics.

### Phase C — EZ Research

- Add the simplified intake UI.
- Add clarification chat and plain-language plan preview.
- Auto-select depth, posture, agents, sources, and output format.
- Preserve current UI as Research Lab.

### Phase D — specialist expansion

- Market/opportunity agents.
- Story verification and timeline reconstruction.
- Data-analysis and quantitative-quality agents.
- More source connectors and browser/tool specialization.

### Phase E — evaluation and optimization

- Build the golden-prompt suite.
- A/B test intake questions and report templates.
- Tune agent selection for quality, cost, and latency.
- Consider fine-tuning only after enough labeled routing data exists.

---

## 13. Definition of done

ResearchOne is functioning as an all-purpose deep-research tool when:

1. A user can submit a normal-language request without understanding research modes or agent names.
2. The system identifies what the user wants produced, not merely the topic.
3. The plan preview accurately lists deliverables and assumptions.
4. The selected agents vary meaningfully by task.
5. Informational reports are informative rather than artificially adjudicative.
6. Verification reports remain rigorous and can use the full falsification/adversarial pipeline.
7. Report headings and content are controlled by the confirmed intent template.
8. Exact requested counts and formats are enforced.
9. A final auditor rejects intent drift before the report reaches the user.
10. Expert users retain all current Research Lab controls.

## Final judgment

ResearchOne does not need to abandon its epistemic rigor. That rigor is its best differentiator. It needs to stop confusing rigor with universal falsification.

The repository already contains much of the intended adaptive architecture, especially the intent taxonomy, plan gate, orchestration profiles, and output templates. The AI-assisted build went wrong by implementing these as metadata and UI concepts while leaving the old universal hypothesis report pipeline in control.

Wire the existing intent system into actual execution, add a deliverable contract, make adversarial analysis conditional, and place an AI-guided EZ mode in front of the current Research Lab. That turns ResearchOne from a sophisticated claim-testing pipeline with broad-research branding into what the product can genuinely become: an adaptive research operating system.

---

## Sources reviewed

- [ResearchOne live site](https://www.researchone.io/)
- [ResearchOne repository](https://github.com/GooseyPrime/ResearchOne)
- [OpenAI: Introducing deep research](https://openai.com/index/introducing-deep-research/)
- [Google: Gemini Deep Research](https://blog.google/products-and-platforms/products/gemini/google-gemini-deep-research/)
- [Elicit](https://elicit.com/)
- [Consensus](https://consensus.app/)
- Attached ResearchOne output: `onlinbusinessreport.md`
