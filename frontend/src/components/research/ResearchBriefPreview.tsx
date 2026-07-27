import { INTENT_DISPLAY_LABELS } from '../../lib/intents';
import { AGENT_DISPLAY_DESCRIPTIONS, SPECIALIST_AGENT_IDS } from '../../lib/agentDisplayDescriptions';
import { humanizeIdentifier } from '../../utils/formatIdentifiers';
import ResearchDeliverablesChecklist from './ResearchDeliverablesChecklist';
import ResearchAssumptionsEditor from './ResearchAssumptionsEditor';
import type { RequestedArtifact } from './researchBriefTypes';

type UserConstraint = {
  description: string;
};

type ResearchBrief = {
  primaryIntent?: string;
  secondaryIntent?: string;
  requestedArtifacts?: RequestedArtifact[];
  userConstraints?: UserConstraint[];
  confidence?: number;
};

/** Typed shape of the `orchestrationProfile` block inside a `PlanPayload`. */
type OrchestrationProfile = {
  agentsWillRun?: unknown[];
  agentsWillSkip?: unknown[];
  executionPlan?: {
    coreAgentRoles?: unknown[];
    specialistAgents?: unknown[];
  };
};

function readResearchBrief(planPayload: Record<string, unknown>): ResearchBrief | null {
  const brief = planPayload.researchBrief;
  if (!brief || typeof brief !== 'object') return null;
  return brief as ResearchBrief;
}

function readIntentId(planPayload: Record<string, unknown>, brief: ResearchBrief | null): string | undefined {
  if (typeof brief?.primaryIntent === 'string' && brief.primaryIntent.trim()) return brief.primaryIntent;
  const fromPlan = (planPayload.intent as Record<string, unknown> | undefined)?.id;
  return typeof fromPlan === 'string' && fromPlan.trim() ? fromPlan : undefined;
}

function inferredAssumptions(planPayload: Record<string, unknown>): string[] {
  const assumptions: string[] = [];
  const topic = (planPayload.topicAnalysis as Record<string, unknown> | undefined)?.summary;
  if (typeof topic === 'string' && topic.trim()) {
    assumptions.push(`Topic interpretation: ${topic.trim()}`);
  }
  const sourceSummary = (planPayload.sourceStrategy as Record<string, unknown> | undefined)?.summary;
  if (typeof sourceSummary === 'string' && sourceSummary.trim()) {
    assumptions.push(`Source strategy: ${sourceSummary.trim()}`);
  }
  return assumptions;
}

function readAgentTeam(planPayload: Record<string, unknown>): Array<{
  id: string;
  name: string;
  description: string;
  isSpecialist: boolean;
}> {
  const profile = planPayload.orchestrationProfile;
  const executionPlan =
    profile !== null && typeof profile === 'object'
      ? (profile as OrchestrationProfile).executionPlan
      : undefined;
  const executionAgents = [
    ...(Array.isArray(executionPlan?.coreAgentRoles)
      ? executionPlan.coreAgentRoles.filter((v): v is string => typeof v === 'string')
      : []),
    ...(Array.isArray(executionPlan?.specialistAgents)
      ? executionPlan.specialistAgents.filter((v): v is string => typeof v === 'string')
      : []),
  ];
  const agentsRaw = executionAgents.length > 0
    ? executionAgents
    : profile !== null && typeof profile === 'object'
      ? (profile as OrchestrationProfile).agentsWillRun
      : undefined;
  if (!Array.isArray(agentsRaw)) return [];
  const seen = new Set<string>();
  return agentsRaw
    .filter((agent): agent is string => typeof agent === 'string')
    .map((agent) => agent.trim())
    .filter(Boolean)
    .filter((agent) => {
      if (seen.has(agent)) return false;
      seen.add(agent);
      return Object.prototype.hasOwnProperty.call(AGENT_DISPLAY_DESCRIPTIONS, agent);
    })
    .map((agent) => ({
      id: agent,
      ...AGENT_DISPLAY_DESCRIPTIONS[agent],
      isSpecialist: SPECIALIST_AGENT_IDS.has(agent),
    }))
    .sort((a, b) => {
      if (a.isSpecialist !== b.isSpecialist) return a.isSpecialist ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export default function ResearchBriefPreview({
  planPayload,
  disabled = false,
  onAssumptionEditsReady,
}: {
  planPayload: Record<string, unknown>;
  disabled?: boolean;
  onAssumptionEditsReady?: (instruction: string) => void;
}) {
  const brief = readResearchBrief(planPayload);
  const intentId = readIntentId(planPayload, brief);
  const confidence =
    typeof brief?.confidence === 'number'
      ? brief.confidence
      : ((planPayload.intent as Record<string, unknown> | undefined)?.confidence as number | undefined);
  const deliverables = brief?.requestedArtifacts ?? [];
  const agentTeam = readAgentTeam(planPayload);
  const assumptions = [
    ...inferredAssumptions(planPayload),
    ...(brief?.userConstraints ?? []).map((c) => c.description).filter(Boolean),
  ];

  return (
    <div className="rounded-lg border border-surface-100 bg-surface-200/40 p-3 space-y-3 text-xs">
      <div>
        <p className="text-slate-500 uppercase tracking-wide">What you asked for</p>
        <p className="mt-1 text-slate-100 font-medium">
          {INTENT_DISPLAY_LABELS[intentId ?? ''] ?? (intentId ? humanizeIdentifier(intentId) : 'General research request')}
        </p>
        {confidence != null ? (
          <p className="text-[11px] text-slate-400 mt-1">Classifier confidence: {(confidence * 100).toFixed(0)}%</p>
        ) : null}
      </div>

      <div>
        <p className="text-slate-500 uppercase tracking-wide mb-1">Deliverables</p>
        <ResearchDeliverablesChecklist artifacts={deliverables} />
      </div>

      {agentTeam.length > 0 ? (
        <div>
          <p className="text-slate-500 uppercase tracking-wide mb-1">Agent team</p>
          <div className="space-y-2">
            {agentTeam.map((agent) => (
              <div
                key={agent.id}
                className={`rounded-md border px-2.5 py-2 ${
                  agent.isSpecialist
                    ? 'border-sky-500/30 bg-sky-950/20'
                    : 'border-surface-100 bg-[#0b0d14]/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <p className="text-slate-100 font-medium">{agent.name}</p>
                  {agent.isSpecialist ? (
                    <span className="rounded-full border border-sky-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-200">
                      Specialist
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-slate-400">{agent.description}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-slate-500 uppercase tracking-wide mb-1">Assumptions</p>
        <ResearchAssumptionsEditor
          assumptions={assumptions}
          disabled={disabled}
          onUseAsRefinement={onAssumptionEditsReady}
        />
      </div>

      <div>
        <p className="text-slate-500 uppercase tracking-wide">What’s not included</p>
        <p className="mt-1 text-slate-400">
          The run follows the confirmed plan only. Anything not listed in deliverables, assumptions, or refinements is out
          of scope for this run.
        </p>
      </div>
    </div>
  );
}
