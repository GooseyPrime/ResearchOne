export const AGENT_DISPLAY_DESCRIPTIONS: Record<string, { name: string; description: string }> = {
  market_scout: { name: 'Market Scout', description: 'Scans for whitespace opportunities and unserved demand.' },
  competitor_mapper: { name: 'Competitor Mapper', description: 'Maps alternatives, positioning, and feature gaps.' },
  demand_signal_analyst: { name: 'Demand Signal Analyst', description: 'Reads complaints, search trends, and procurement signals.' },
  feasibility_architect: { name: 'Feasibility Architect', description: 'Evaluates buildability, stack, timeline, and resource constraints.' },
  story_verifier: { name: 'Story Verifier', description: 'Cross-checks reported accounts against corroborating evidence.' },
  timeline_reconstructor: { name: 'Timeline Reconstructor', description: 'Reconstructs chronologies from fragmented sources.' },
  data_analysis_specialist: { name: 'Data Analysis Specialist', description: 'Extracts quantitative metrics, benchmark deltas, and trend signals from evidence.' },
  quantitative_quality_auditor: { name: 'Quantitative Quality Auditor', description: 'Audits statistical quality, numerical consistency, and measurement caveats.' },
  planner: { name: 'Research Planner', description: 'Decomposes your request into a structured investigation plan.' },
  retriever: { name: 'Source Investigator', description: 'Searches and evaluates sources across the public web.' },
  reasoner: { name: 'Evidence Reasoner', description: 'Weighs evidence and builds the analytical framework.' },
  synthesizer: { name: 'Report Writer', description: 'Drafts your deliverables from the confirmed plan.' },
  verifier: { name: 'Citation Verifier', description: 'Confirms every claim is supported by an accessible source.' },
  contract_auditor: { name: 'Contract Auditor', description: 'Checks that every requested deliverable was actually delivered.' },
  skeptic: { name: 'Challenge', description: 'Argues against the draft to catch weak or unsupported claims.' },
};

/**
 * Single source of truth for which agent IDs are specialist (conditional).
 * Mirrors `SPECIALIST_AGENT_CAPABILITIES` in `agentCapabilityRegistry.ts`.
 */
export const SPECIALIST_AGENT_IDS = new Set([
  'market_scout',
  'competitor_mapper',
  'demand_signal_analyst',
  'feasibility_architect',
  'story_verifier',
  'timeline_reconstructor',
  'data_analysis_specialist',
  'quantitative_quality_auditor',
]);
