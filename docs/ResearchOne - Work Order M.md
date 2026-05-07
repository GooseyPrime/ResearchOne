**Work Order M --- V2 prompt templates and mode overlays**

**Goal. Wire prompt templates from Section 7 into existing agent code.**

**Pre-work: Section 7 (full doctrine and 8 templates),
backend/src/constants/prompts.ts (confirm REASONING_FIRST_PREAMBLE and
STANDARD_RESEARCH_PREAMBLE locations),
backend/src/services/reasoning/reasoningModelPolicy.ts
(RED_TEAM_V2_SYSTEM_PREFIX), all 9 agent files.**

**Files to create:**

-   **backend/src/constants/modeOverlays.ts --- MODE_OVERLAYS const with
    all 5 modes × 8 agents per Section 7, plus ADVERSARIAL_TWIN mode
    overlays for Skeptic and Synthesizer.**

-   **backend/src/services/agents/promptComposer.ts:**

**export function composePrompt(\
agentRole: AgentRole,\
mode: ResearchMode,\
ensembleVariant: \'v1_standard\' \| \'v2_deep\'\
): string {\
const preamble = ensembleVariant === \'v2_deep\'\
? REASONING_FIRST_PREAMBLE_V2\
: STANDARD_RESEARCH_PREAMBLE;\
const baseTemplate = AGENT_BASE_TEMPLATES\[agentRole\];\
const modeOverlay = MODE_OVERLAYS\[mode\]\[agentRole\] ?? \'\';\
return baseTemplate\
.replace(\'\[PREAMBLE\]\', preamble)\
.replace(\'\[MODE OVERLAY\]\', modeOverlay);\
}**

**Files to modify:**

**backend/src/constants/prompts.ts --- add STANDARD_RESEARCH_PREAMBLE
(Template 0b) and V2 variant (Template 0). Do NOT modify existing
REASONING_FIRST_PREAMBLE.**

**Each agent file --- replace inline prompt construction with
composePrompt(role, mode, variant).**

**backend/src/schemas/ --- add zod schemas for every agent's structured
JSON output per Section 7.**

**Acceptance criteria: - Standard run uses STANDARD_RESEARCH_PREAMBLE +
base template + mode overlay - Deep run uses
REASONING_FIRST_PREAMBLE_V2 + base template + overlay - Each agent's
output passes its zod schema validation - Schema validation failure
triggers single retry on same model, then escalates to fallback - All 5
modes × 8 agents = 40 overlay-pairs wired and smoke-tested, plus
ADVERSARIAL_TWIN mode wired for Skeptic and Synthesizer**

**Section 7 doctrine additions (append to existing doctrine):**

**Stage 4 Retriever Analysis preamble addition (all modes). "Some chunks
carry institutional-status metadata from external citation indices.
Treat as one signal among many, not a verdict. A chunk marked retracted
may have been retracted for fabricated data, or under political
pressure, funding threats, or paradigm-defense. Evaluate the underlying
mechanism --- is the claim structurally sound --- not the retraction
status. If you cannot evaluate the mechanism without further
investigation, mark for Skeptic scrutiny and surface as a
contradiction-investigation lead. Never silently demote a chunk because
it carries institutional friction."**

**Stage 6 Skeptic addition (all V2 modes). When a chunk's source has
scite\_contrasting\_paper\_dois, the orchestrator dispatches a bounded
sub-discovery to pull contrasting papers into the run's corpus before
Skeptic runs. Skeptic prompt addition: "A retracted or contrasted source
is a puzzle, not a falsified claim. Reason structurally about whether
the original mechanism and the contrasting paper's mechanism are
compatible, incompatible, or addressing different conditions. Premature
collapse to consensus is failure. Premature collapse to contrarianism is
also failure. Output a structured comparison."**

**Stage 8 Verifier rule (inverted from naive auto-debunk). "If the
report cites any source with institutional\_status: retracted or high
contrasting\_count, the report MUST contain a structural-mechanism
comparison section that names the retraction/contrast and reasons
through it. Reports that cite contested sources without doing this
analysis fail verification. Reports that cite contested sources AND
reason through them pass verification regardless of the contested
status."**

**Stage 10 Epistemic Persistence addition. Each Scite-flagged contrast
becomes a row in contradictions with source\_kind='scite\_external'.
Feeds the Contradiction Heatmap product.**

**Sixth mode: ADVERSARIAL_TWIN. Pipeline: Planner (skip --- input doc IS
the plan) → Discovery (skip --- corpus is the input doc) → Retriever
(skip) → Retriever Analysis (skip) → Reasoner (skip) → Skeptic (full
attack) → Synthesizer (writes "contradictions and gaps" report only) →
Verifier → Save → Persistence. Mode overlays for Skeptic and
Synthesizer are specific to attacking-an-existing-document.**

**Tests required: promptComposer.test.ts, schemaValidation.test.ts,
standardVsDeep.test.ts.**

**Additional tests required (must fail without the fix):**

-   **Retracted-source regression test: input chunk with
    scite\_institutional\_status='retracted' reaches Reasoner with
    evidence\_tier UNCHANGED --- fails if any code path auto-tiers to
    debunked.**

-   **Verifier accepts report citing retracted source IFF report
    contains mechanism-comparison section.**

-   **Adversarial Twin run on a sample doc returns ONLY
    contradictions/gaps section.**

**What not to change. REASONING_FIRST_PREAMBLE constant.
RED_TEAM_V2_SYSTEM_PREFIX constant. The forbidden-defaults regression
test. Model ensemble presets (Work Order A confirmed PR #41 status).**
