/**
 * ResearchOne TypeScript Interfaces
 * Defines all data structures for the research platform
 */

// ===== RESEARCH RUN TYPES =====

export type ResearchStage = 
  | 'planner'
  | 'sleuth'
  | 'discovery'
  | 'retriever'
  | 'retriever_analysis'
  | 'quantitative'
  | 'reasoner'
  | 'skeptic'
  | 'synthesizer'
  | 'verifier'
  | 'formatter'
  | 'report'
  | 'complete';

export type ResearchMode = 
  | 'standard'
  | 'deep'
  | 'adversarial'
  | 'comprehensive';

export type EvidenceTier = 
  | 'verified'
  | 'corroborated'
  | 'supported'
  | 'uncorroborated'
  | 'contested';

export type RunStatus = 
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface ResearchRun {
  id: string;
  query: string;
  /**
   * Optional throughout because the run-list API row carries none of it.
   *
   * These were required, so the mapper filled them in: `sourcesRetrieved: 0`,
   * `contradictionsDetected: 0`, `evidenceTier: 'supported'` — on every run,
   * including queued ones that had done nothing. A recent-runs row therefore
   * carried a corroboration badge for a run with no sources, which is a
   * confident claim about evidence quality that no evidence produced, on the
   * product whose stated purpose is verification.
   *
   * A type that cannot say "unknown" forces callers to invent a value. Now it
   * can, and the renderers show these only when they are real.
   */
  mode?: ResearchMode;
  status: RunStatus;
  currentStage: ResearchStage;
  progress: number; // 0-100
  sourcesRetrieved?: number;
  contradictionsDetected?: number;
  evidenceTier?: EvidenceTier;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface StageTransition {
  stage: ResearchStage;
  timestamp: string;
  duration?: number; // ms
  metadata?: Record<string, unknown>;
}

export interface AgentActivity {
  id: string;
  agent: string;
  action: string;
  detail?: string;
  timestamp: string;
}

// ===== REPORT TYPES =====

export interface Report {
  id: string;
  runId: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  evidenceTier: EvidenceTier;
  citationCount: number;
  contradictionCount: number;
  createdAt: string;
  updatedAt: string;
  exportFormats: ExportFormat[];
}

export interface ExportFormat {
  format: 'pdf' | 'json' | 'md' | 'html';
  filename: string;
  size?: number; // bytes
  generatedAt: string;
}

export interface Claim {
  id: string;
  text: string;
  evidenceTier: EvidenceTier;
  confidence: number; // 0-1
  citations: Citation[];
  contradictions?: Contradiction[];
  challengeNotes?: string[];
}

export interface Citation {
  id: string;
  source: string;
  url?: string;
  excerpt: string;
  retrievedAt: string;
  corroborationScore: number; // 0-1
}

export interface Contradiction {
  id: string;
  claimA: string;
  claimB: string;
  source: string;
  severity: 'minor' | 'moderate' | 'major';
  resolution?: string;
}

export interface RevisionEntry {
  id: string;
  version: number;
  timestamp: string;
  changes: string;
  agent: string;
}

// ===== DOSSIER TYPES =====

export interface Dossier {
  id: string;
  title: string;
  description?: string;
  reports: Report[];
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// ===== SOCKET EVENT TYPES =====

export interface RunProgressEvent {
  runId: string;
  stage: ResearchStage;
  progress: number;
  message?: string;
}

export interface RunCompleteEvent {
  runId: string;
  reportId: string;
  summary: string;
}

export interface RunErrorEvent {
  runId: string;
  error: string;
  recoverable: boolean;
}

export interface AgentActivityEvent {
  runId: string;
  activity: AgentActivity;
}

// ===== UI DATA TYPES =====

export interface NavLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface PipelineStage {
  id: ResearchStage;
  name: string;
  description: string;
  isSkeptic?: boolean;
}

export interface Capability {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface FeatureBlock {
  number: string;
  title: string;
  subtitle: string;
  description: string;
  isSkeptic?: boolean;
}

export interface RuntimeNode {
  layer: string;
  name: string;
  description: string;
}
