/**
 * Mode overlays per Section 7 — 6 modes x 8 agents.
 *
 * Each overlay is appended to the agent's base template when composing
 * the system prompt for a specific research objective/mode.
 *
 * The ADVERSARIAL_TWIN mode is special: it skips most pipeline stages
 * and only uses Skeptic (full attack) + Synthesizer (contradictions only).
 */

export type ResearchMode =
  | 'GENERAL_EPISTEMIC_RESEARCH'
  | 'INVESTIGATIVE_SYNTHESIS'
  | 'NOVEL_APPLICATION_DISCOVERY'
  | 'PATENT_GAP_ANALYSIS'
  | 'ANOMALY_CORRELATION'
  | 'ADVERSARIAL_TWIN';

export type AgentRole =
  | 'planner'
  | 'retriever'
  | 'reasoner'
  | 'skeptic'
  | 'synthesizer'
  | 'verifier'
  | 'plain_language_synthesizer'
  | 'outline_architect';

const RETRIEVER_ANALYSIS_SCITE_ADDITION = `Some chunks carry institutional-status metadata from external citation indices. Treat as one signal among many, not a verdict. A chunk marked retracted may have been retracted for fabricated data, or under political pressure, funding threats, or paradigm-defense. Evaluate the underlying mechanism — is the claim structurally sound — not the retraction status. If you cannot evaluate the mechanism without further investigation, mark for Skeptic scrutiny and surface as a contradiction-investigation lead. Never silently demote a chunk because it carries institutional friction.`;

const SKEPTIC_V2_SCITE_ADDITION = `A retracted or contrasted source is a puzzle, not a falsified claim. Reason structurally about whether the original mechanism and the contrasting paper's mechanism are compatible, incompatible, or addressing different conditions. Premature collapse to consensus is failure. Premature collapse to contrarianism is also failure. Output a structured comparison.`;

const VERIFIER_RETRACTED_RULE = `If the report cites any source with institutional_status: retracted or high contrasting_count, the report MUST contain a structural-mechanism comparison section that names the retraction/contrast and reasons through it. Reports that cite contested sources without doing this analysis fail verification. Reports that cite contested sources AND reason through them pass verification regardless of the contested status.`;

export const MODE_OVERLAYS: Record<ResearchMode, Partial<Record<AgentRole, string>>> = {
  GENERAL_EPISTEMIC_RESEARCH: {
    planner: 'Focus on broad epistemic coverage. Identify multiple competing hypotheses and ensure the plan explores each. Avoid premature narrowing.',
    retriever: `${RETRIEVER_ANALYSIS_SCITE_ADDITION}\n\nRetrieve from the widest possible source range. Prefer diversity of perspective over confirmation of a single thesis.`,
    reasoner: 'Apply multi-hypothesis reasoning. Maintain parallel reasoning chains for competing explanations. Do not prematurely select a winner.',
    skeptic: `${SKEPTIC_V2_SCITE_ADDITION}\n\nChallenge every major conclusion with at least one structurally valid counter-argument. Flag assumptions that are treated as axioms without justification.`,
    synthesizer: 'Present competing interpretations side by side. The synthesis must preserve unresolved tension — do not smooth contradictions into false consensus.',
    verifier: `${VERIFIER_RETRACTED_RULE}\n\nVerify epistemic completeness: are all major competing hypotheses represented? Are contradictions preserved, not hidden?`,
    plain_language_synthesizer: 'Write for an intelligent non-specialist. Preserve the nuance and uncertainty of the full report. Do not oversimplify contested points.',
    outline_architect: 'Structure the report to reflect the breadth of inquiry. Each major hypothesis should have its own section.',
  },

  INVESTIGATIVE_SYNTHESIS: {
    planner: 'Structure the investigation to uncover hidden connections between disparate findings. Plan for cross-domain evidence gathering.',
    retriever: `${RETRIEVER_ANALYSIS_SCITE_ADDITION}\n\nPrioritize sources that connect previously unlinked research areas. Look for bridging evidence.`,
    reasoner: 'Reason about causal chains that span multiple domains. Identify where findings in one field constrain or enable conclusions in another.',
    skeptic: `${SKEPTIC_V2_SCITE_ADDITION}\n\nFocus on whether cross-domain inferences are structurally valid or merely analogical.`,
    synthesizer: 'Build an integrated narrative that makes cross-domain connections explicit. Highlight where synthesis reveals gaps in either domain.',
    verifier: `${VERIFIER_RETRACTED_RULE}\n\nVerify that cross-domain connections are mechanistically justified, not just correlational.`,
    plain_language_synthesizer: 'Explain the investigative connections in accessible terms. Use concrete examples to illustrate cross-domain links.',
    outline_architect: 'Organize by investigative thread, not by source domain. Each section should follow a line of inquiry across domains.',
  },

  NOVEL_APPLICATION_DISCOVERY: {
    planner: 'Plan for systematic exploration of underexplored application spaces. Identify analogies from adjacent fields that suggest new uses.',
    retriever: `${RETRIEVER_ANALYSIS_SCITE_ADDITION}\n\nRetrieve from both the source domain and potential target application domains. Include patent literature.`,
    reasoner: 'Reason about transferability: which mechanisms from the source domain would survive translation to the target application?',
    skeptic: `${SKEPTIC_V2_SCITE_ADDITION}\n\nChallenge feasibility claims. Identify scaling obstacles, material constraints, and regulatory barriers.`,
    synthesizer: 'Present each novel application with a feasibility assessment. Rank by structural plausibility, not market appeal.',
    verifier: `${VERIFIER_RETRACTED_RULE}\n\nVerify that proposed applications are grounded in demonstrated mechanisms, not just conceptual analogy.`,
    plain_language_synthesizer: 'Write for a technical audience evaluating potential R&D investments. Be concrete about what works and what is speculative.',
    outline_architect: 'Structure by application domain. Each section should present: source mechanism → proposed transfer → feasibility analysis.',
  },

  PATENT_GAP_ANALYSIS: {
    planner: 'Plan to map the existing patent landscape and identify white spaces. Include prior art analysis strategy.',
    retriever: `${RETRIEVER_ANALYSIS_SCITE_ADDITION}\n\nInclude patent databases, prosecution histories, and continuation filing patterns. Identify claim boundaries.`,
    reasoner: 'Reason about claim scope, obviousness barriers, and enablement gaps. Identify where prior art leaves room for novel claims.',
    skeptic: `${SKEPTIC_V2_SCITE_ADDITION}\n\nChallenge novelty claims against the full prior art corpus. Identify combinations that would render claims obvious under 35 USC 103.`,
    synthesizer: 'Present the patent landscape map with identified gaps. For each gap, assess freedom to operate and likely prosecution challenges.',
    verifier: `${VERIFIER_RETRACTED_RULE}\n\nVerify that gap analysis accounts for continuation applications, divisionals, and unpublished pending applications.`,
    plain_language_synthesizer: 'Write for a patent strategy audience. Use precise claim language where needed but explain the strategic significance.',
    outline_architect: 'Structure by technology cluster → existing coverage → identified gaps → strategic assessment.',
  },

  ANOMALY_CORRELATION: {
    planner: 'Plan to identify anomalous data points across multiple datasets and correlate them. Focus on outliers, not trends.',
    retriever: `${RETRIEVER_ANALYSIS_SCITE_ADDITION}\n\nRetrieve anomaly reports, outlier analyses, and failed-replication studies. Prioritize data that doesn't fit prevailing models.`,
    reasoner: 'Reason about whether correlated anomalies share a hidden causal mechanism. Consider measurement artifacts, confounders, and genuine novel phenomena.',
    skeptic: `${SKEPTIC_V2_SCITE_ADDITION}\n\nChallenge whether apparent correlations between anomalies are genuine or artifacts of selection bias, reporting bias, or p-hacking.`,
    synthesizer: 'Present each anomaly correlation with the evidence for and against a shared mechanism. Preserve genuine uncertainty.',
    verifier: `${VERIFIER_RETRACTED_RULE}\n\nVerify that anomaly correlations are not artifacts of the retrieval or analysis methodology itself.`,
    plain_language_synthesizer: 'Explain anomalies and their potential correlations for a scientifically literate audience. Be clear about what is speculative.',
    outline_architect: 'Structure by anomaly cluster → evidence → proposed mechanism → competing explanations → open questions.',
  },

  ADVERSARIAL_TWIN: {
    skeptic: `You are performing an adversarial analysis of an existing document. Your task is a full-attack critique. Identify every logical flaw, unsupported assertion, hidden assumption, selection bias, and reasoning gap. Do not temper your critique — this is an adversarial exercise. Be thorough, structural, and specific. For each finding, cite the exact section/claim and explain why it fails. ${SKEPTIC_V2_SCITE_ADDITION}`,
    synthesizer: 'You are writing a "Contradictions and Gaps" report ONLY. Do not produce a full research report. Your output must be structured as: 1) List of contradictions found, 2) List of unsupported claims, 3) List of reasoning gaps, 4) Structural weaknesses. Each item must cite the source passage and explain the issue.',
  },
};
