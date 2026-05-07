**Work Order M --- V2 prompt templates and mode overlays**

**Goal. Wire prompt templates from Section 7 into existing agent code.**

**Pre-work: Section 7 (full doctrine and 8 templates),
backend/src/constants/prompts.ts (confirm REASONING_FIRST_PREAMBLE and
STANDARD_RESEARCH_PREAMBLE locations),
backend/src/services/reasoning/reasoningModelPolicy.ts
(RED_TEAM_V2_SYSTEM_PREFIX), all 9 agent files.**

**Files to create:**

-   **backend/src/constants/modeOverlays.ts --- MODE_OVERLAYS const with
    all 5 modes × 8 agents per Section 7**

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
modes × 8 agents = 40 overlay-pairs wired and smoke-tested**

**Tests required: promptComposer.test.ts, schemaValidation.test.ts,
standardVsDeep.test.ts.**

**What not to change. REASONING_FIRST_PREAMBLE constant.
RED_TEAM_V2_SYSTEM_PREFIX constant. The forbidden-defaults regression
test. Model ensemble presets (Work Order A confirmed PR #41 status).**
