/** Illustrative specialist schematic for marketing surfaces. */

export type StageAgentKind =
  | 'planner'
  | 'retriever'
  | 'analyst'
  | 'synthesizer'
  | 'skeptic'
  | 'citer'
  | 'renderer'
  | 'curator';

export interface PipelineStageDef {
  readonly index: number;
  readonly stageName: string;
  readonly agent: string;
  readonly agentKind: StageAgentKind;
  readonly input: string;
  readonly output: string;
  readonly rationale: string;
}

export const PIPELINE_SCHEMATIC_STAGES: readonly PipelineStageDef[] = [
  {
    index: 1,
    stageName: 'Intake',
    agent: 'Planner',
    agentKind: 'planner',
    input: 'User question',
    output: 'Scoped objective',
    rationale: 'Turns an open question into a scoped objective the rest of the pipeline can execute.',
  },
  {
    index: 2,
    stageName: 'Decomposition',
    agent: 'Planner',
    agentKind: 'planner',
    input: 'Scoped objective',
    output: 'Sub-questions',
    rationale: 'Breaks the objective into retrievable sub-questions and verification targets when needed.',
  },
  {
    index: 3,
    stageName: 'Retrieval',
    agent: 'Retriever',
    agentKind: 'retriever',
    input: 'Sub-questions',
    output: 'Candidate sources',
    rationale: 'Pulls candidate sources from corpus and external feeds with hybrid search.',
  },
  {
    index: 4,
    stageName: 'Source Tiering',
    agent: 'Retriever',
    agentKind: 'retriever',
    input: 'Candidate sources',
    output: 'Tier 1–4 sources',
    rationale: 'Ranks sources into explicit tiers so downstream claims inherit defensibility.',
  },
  {
    index: 5,
    stageName: 'Extraction',
    agent: 'Analyst',
    agentKind: 'analyst',
    input: 'Tier 1–4 sources',
    output: 'Atomic claims',
    rationale: 'Extracts atomic, testable claims with tier tags before synthesis.',
  },
  {
    index: 6,
    stageName: 'Synthesis',
    agent: 'Synthesizer',
    agentKind: 'synthesizer',
    input: 'Atomic claims',
    output: 'Draft synthesis',
    rationale: 'Drafts the narrative spine while preserving tier and source-disagreement signals.',
  },
  {
    index: 7,
    stageName: 'Skeptic Pass',
    agent: 'Skeptic',
    agentKind: 'skeptic',
    input: 'Draft synthesis',
    output: 'Counter-claims + preserved disagreements',
    rationale: 'Challenge review pass that pressure-tests key claims when verification-heavy analysis is selected.',
  },
  {
    index: 8,
    stageName: 'Citation Bind',
    agent: 'Citer',
    agentKind: 'citer',
    input: 'Counter-claims + synthesis',
    output: 'Bound claim→source map',
    rationale: 'Binds each surviving claim to source spans so breaks travel with the citation.',
  },
  {
    index: 9,
    stageName: 'Rendering',
    agent: 'Renderer',
    agentKind: 'renderer',
    input: 'Bound claims',
    output: 'Document v1.0',
    rationale: 'Produces the reader-facing document with citations, tiers, and preserved source context.',
  },
  {
    index: 10,
    stageName: 'Living State',
    agent: 'Curator',
    agentKind: 'curator',
    input: 'Document + new sources',
    output: 'Versioned updates',
    rationale: 'Turns the report into a living artifact when monitoring and new sources arrive.',
  },
] as const;

/** Capsule center X in viewBox coordinates (spine y=220). */
export const PIPELINE_CAPSULE_CENTERS_X: readonly number[] = [
  200, 320, 440, 560, 680, 800, 920, 1040, 1160, 1280,
];

export const PIPELINE_SPINE_Y = 220;
export const PIPELINE_SKEPTIC_APEX_Y = 340;

/** SVG viewBox — keep `PipelineSchematic` and hero framing in sync. */
export const PIPELINE_SCHEMATIC_VIEWBOX = { width: 1440, height: 420 } as const;

export const STAGE_COLOR: Record<StageAgentKind, string> = {
  planner: '#7C8FA1',
  retriever: '#5BC0EB',
  analyst: '#F0C674',
  synthesizer: '#F0C674',
  skeptic: '#D45B9E',
  citer: '#E8DFCB',
  renderer: '#E8DFCB',
  curator: '#F0C674',
};
