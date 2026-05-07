/**
 * Prompt composer per Section 7 — assembles system prompts from:
 * 1. Preamble (standard or V2 reasoning-first)
 * 2. Base agent template
 * 3. Mode overlay
 */

import { REASONING_FIRST_PREAMBLE } from '../../constants/prompts';
import { MODE_OVERLAYS, type ResearchMode, type AgentRole } from '../../constants/modeOverlays';
import { SYSTEM_PROMPTS } from '../openrouter/openrouterService';

export const STANDARD_RESEARCH_PREAMBLE = `STANDARD RESEARCH METHODOLOGY:
- Apply rigorous evidence-based analysis with transparent sourcing.
- Distinguish between well-established findings, emerging evidence, and speculative inference.
- Cite sources for all factual claims. Flag when evidence is thin or contested.
- Present multiple perspectives where credible disagreement exists.
- Acknowledge limitations of the available evidence base.`;

export const REASONING_FIRST_PREAMBLE_V2 = REASONING_FIRST_PREAMBLE;

export type EnsembleVariant = 'v1_standard' | 'v2_deep';

/**
 * Extracts the role-specific template from a SYSTEM_PROMPTS entry by
 * removing the withPreamble() wrapper (REASONING_FIRST_PREAMBLE + knowledge block).
 */
function stripExistingPreamble(fullPrompt: string): string {
  const marker = REASONING_FIRST_PREAMBLE;
  const idx = fullPrompt.indexOf(marker);
  if (idx === -1) return fullPrompt;
  let stripped = fullPrompt.slice(idx + marker.length);
  const roleStart = stripped.search(/[A-Z]/);
  if (roleStart > 0) stripped = stripped.slice(roleStart);
  return stripped;
}

/**
 * Composes a system prompt for a given agent, mode, and ensemble variant.
 *
 * - v1_standard: STANDARD_RESEARCH_PREAMBLE + role template + mode overlay
 * - v2_deep: REASONING_FIRST_PREAMBLE_V2 + role template + mode overlay
 *
 * The existing SYSTEM_PROMPTS entries have withPreamble() baked in.
 * We strip that and replace with the appropriate preamble for the variant.
 */
export function composePrompt(
  agentRole: AgentRole,
  mode: ResearchMode,
  ensembleVariant: EnsembleVariant
): string {
  const preamble =
    ensembleVariant === 'v2_deep'
      ? REASONING_FIRST_PREAMBLE_V2
      : STANDARD_RESEARCH_PREAMBLE;

  const rawTemplate = SYSTEM_PROMPTS[agentRole] ?? '';
  const roleTemplate = stripExistingPreamble(rawTemplate);

  const modeOverlay = MODE_OVERLAYS[mode]?.[agentRole] ?? '';

  const parts = [preamble, roleTemplate];
  if (modeOverlay) {
    parts.push(`\n--- MODE-SPECIFIC DIRECTIVES ---\n${modeOverlay}`);
  }

  return parts.join('\n\n');
}

/**
 * Returns all valid mode-agent pairs that have overlays defined.
 */
export function getAllModeAgentPairs(): Array<{ mode: ResearchMode; agent: AgentRole }> {
  const pairs: Array<{ mode: ResearchMode; agent: AgentRole }> = [];
  for (const [mode, agents] of Object.entries(MODE_OVERLAYS)) {
    for (const agent of Object.keys(agents)) {
      pairs.push({ mode: mode as ResearchMode, agent: agent as AgentRole });
    }
  }
  return pairs;
}
