import { DOUBLE_CHECK } from '../../content/customerOptions';
/** Illustrative specialist schematic for marketing surfaces. */

export type StageAgentKind =
  | 'planner'
  | 'retriever'
  | 'analyst'
  | 'synthesizer'
  | 'double_check'
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
    output: 'Sources ranked by strength',
    rationale: 'Ranks sources by strength so each finding rests on the best one available.',
  },
  {
    index: 5,
    stageName: 'Extraction',
    agent: 'Analyst',
    agentKind: 'analyst',
    input: 'Sources ranked by strength',
    output: 'Single findings',
    rationale: 'Draws out single, checkable findings before the report is written.',
  },
  {
    index: 6,
    stageName: 'Synthesis',
    agent: 'Synthesizer',
    agentKind: 'synthesizer',
    input: 'Single findings',
    output: 'Draft synthesis',
    rationale: 'Drafts the narrative spine while preserving tier and source-disagreement signals.',
  },
  {
    index: 7,
    stageName: DOUBLE_CHECK.name,
    agent: DOUBLE_CHECK.name,
    agentKind: 'double_check',
    input: 'Draft synthesis',
    output: 'Opposing findings + preserved disagreements',
    rationale: DOUBLE_CHECK.description,
  },
  {
    index: 8,
    stageName: 'Citation Bind',
    agent: 'Citer',
    agentKind: 'citer',
    input: 'Opposing findings + synthesis',
    output: 'Finding→source map',
    rationale: 'Binds each surviving finding to its source passage so breaks travel with the citation.',
  },
  {
    index: 9,
    stageName: 'Rendering',
    agent: 'Renderer',
    agentKind: 'renderer',
    input: 'Bound findings',
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
export const PIPELINE_DOUBLE_CHECK_APEX_Y = 340;

/** SVG viewBox — keep `PipelineSchematic` and hero framing in sync. */
export const PIPELINE_SCHEMATIC_VIEWBOX = { width: 1440, height: 420 } as const;

export const STAGE_COLOR: Record<StageAgentKind, string> = {
  planner: '#7C8FA1',
  retriever: '#5BC0EB',
  analyst: '#F0C674',
  synthesizer: '#F0C674',
  double_check: '#D45B9E',
  citer: '#E8DFCB',
  renderer: '#E8DFCB',
  curator: '#F0C674',
};
