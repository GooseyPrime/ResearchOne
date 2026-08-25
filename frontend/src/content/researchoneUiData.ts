/**
 * ResearchOne UI Data Arrays
 * Centralized data for all UI sections - easy to modify and integrate
 */

import type { NavLink, PipelineStage, Capability, FeatureBlock, RuntimeNode, ResearchMode, EvidenceTier } from '@/lib/researchone/types';

// ===== NAVIGATION =====

export const publicNavLinks: NavLink[] = [
  { label: 'Methodology', href: '/methodology' },
  { label: 'Sample Report', href: '/sample-report' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Security', href: '/security' },
];

export const appNavLinks: NavLink[] = [
  { label: 'Research', href: '/app/research' },
  { label: 'Dossiers', href: '/app/dossiers' },
  { label: 'Reports', href: '/app/dossiers' },
  { label: 'Account', href: '/app/billing' },
];

export const footerNavSections = [
  {
    title: 'Product',
    links: [
      { label: 'Methodology', href: '/methodology' },
      { label: 'Sample Report', href: '/sample-report' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Compare', href: '/compare' },
    ],
  },
  {
    title: 'Security',
    links: [
      { label: 'Security', href: '/security' },
      { label: 'Sovereign', href: '/sovereign' },
      { label: 'BYOK', href: '/byok' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
      { label: 'FAQ', href: '/faq' },
    ],
  },
];

// ===== PIPELINE STAGES =====

export const pipelineStages: PipelineStage[] = [
  {
    id: 'planner',
    name: 'Planner',
    description: 'Decomposes research objectives into structured investigation paths',
  },
  {
    id: 'sleuth',
    name: 'Sleuth',
    description: 'Secondary discovery that expands query space and identifies adjacent domains',
  },
  {
    id: 'retriever',
    name: 'Retriever & Assessor',
    description: 'Finds and ranks relevant sources with funding and bias checks',
  },
  {
    id: 'quantitative',
    name: 'Quantitative Extractor',
    description: 'Pulls statistical tables and raw numerical data with precision',
  },
  {
    id: 'reasoner',
    name: 'Reasoner',
    description: 'Structures findings into claims with citation chains',
  },
  {
    id: 'skeptic',
    name: 'Challenge',
    description: 'Challenge pass with optional critique perspectives that stress-test conclusions',
    isSkeptic: true,
  },
  {
    id: 'synthesizer',
    name: 'Drafting',
    description: 'Integrates findings into the report while preserving contradictions',
  },
  {
    id: 'verifier',
    name: 'Verifier',
    description: 'Final validation of citations and source integrity',
  },
  {
    id: 'formatter',
    name: 'Formatter',
    description: 'Generates exportable research dossier in multiple formats',
  },
];

// ===== PROTOCOL MARQUEE =====

export const protocolLabels = [
  'PLANNER',
  'SLEUTH',
  'RETRIEVER',
  'QUANTITATIVE EXTRACTOR',
  'REASONER',
  'CHALLENGE',
  'DRAFTING',
  'VERIFIER',
  'FORMATTER',
];

export const operationalPhrases = [
  'FUNDING BIAS CHECK ACTIVE',
  'CHALLENGE PERSPECTIVE APPLIED',
  'CONTRADICTION PRESERVED',
  'CHALLENGE PASS COMPLETE',
  'REVISION LINEAGE ENABLED',
  'CITATION INTEGRITY VERIFIED',
  'SOCKET TRACE READY',
  'EMMA BACKEND ONLINE',
  'VERCEL EDGE FRONTEND',
];

// ===== CAPABILITIES =====

export const capabilities: Capability[] = [
  {
    id: 'orchestration',
    title: 'Multi-Agent Research Orchestration',
    description: 'Coordinated research pipeline with specialized agents for planning, source discovery, reasoning, and verification.',
    icon: 'Network',
  },
  {
    id: 'sleuthing',
    title: 'The Sleuthing Pass',
    description: 'Secondary discovery phase that expands beyond initial queries to uncover adjacent domains and alternative framings.',
    icon: 'Search',
  },
  {
    id: 'quantitative',
    title: 'Quantitative Data Extraction',
    description: 'Precision extraction of statistical tables, raw numerical data, and mathematical relationships from sources.',
    icon: 'Calculator',
  },
  {
    id: 'red-team',
    title: 'Custom Challenge Perspectives',
    description: 'Assign specialised critique perspectives to the challenge pass—FDA compliance officer, hostile peer reviewer, or defence attorney.',
    icon: 'UserX',
  },
  {
    id: 'contradictions',
    title: 'Contradictions as Data',
    description: 'Conflicting findings are preserved and surfaced, not silently resolved. Reality is messy; our reports reflect that.',
    icon: 'GitBranch',
  },
  {
    id: 'citations',
    title: 'Citation-Backed Dossiers',
    description: 'Every claim links to verifiable sources. Full audit trail from conclusion to primary source.',
    icon: 'FileCheck',
  },
  {
    id: 'lineage',
    title: 'Revision Lineage',
    description: 'Complete history of how conclusions evolved through the research pipeline.',
    icon: 'History',
  },
  {
    id: 'corroboration',
    title: 'Source Corroboration',
    description: 'Claims are strengthened through independent source verification with quantified corroboration scores.',
    icon: 'CheckCheck',
  },
  {
    id: 'live-progress',
    title: 'Live Research Progress',
    description: 'Real-time visibility into research execution. Watch agents work through your investigation.',
    icon: 'Activity',
  },
  {
    id: 'exports',
    title: 'Exportable Formatted Reports',
    description: 'Download complete dossiers in PDF, JSON, Markdown, or HTML. Your research, your format.',
    icon: 'Download',
  },
];

// ===== FEATURE BLOCKS (for Sticky Vault Core section) =====

export const featureBlocks: FeatureBlock[] = [
  {
    number: '01',
    title: 'Planner Decomposition',
    subtitle: 'QUERY_PARSE · OBJECTIVE_MAP',
    description: 'Complex research objectives are decomposed into tractable investigation paths with clear requirements.',
  },
  {
    number: '02',
    title: 'The Sleuthing Pass',
    subtitle: 'DOMAIN_SCAN · QUERY_AUGMENT',
    description: 'Secondary discovery expands into comprehensive search space covering adjacent domains and alternative framings.',
  },
  {
    number: '03',
    title: 'Corroboration & Bias Assessment',
    subtitle: 'CROSS_REF · FUNDING_CHECK',
    description: 'Sources are verified through independent corroboration with funding bias and conflict-of-interest checks.',
  },
  {
    number: '04',
    title: 'Quantitative Data Extraction',
    subtitle: 'STATS_PULL · TABLE_PARSE',
    description: 'Statistical tables and raw numerical data are extracted with precision, preserving mathematical relationships.',
  },
  {
    number: '05',
    title: 'Reasoning & Correlation',
    subtitle: 'CLAIM_DRAFT · LINK_CHAIN',
    description: 'Findings are structured into claims with citation chains and correlation mapping.',
  },
  {
    number: '06',
    title: 'Challenge Pass',
    subtitle: 'CHALLENGE · WEAKNESS_SCAN',
    description: 'Optional critique personas stress-test every conclusion, exposing logical gaps and unsupported claims before publication.',
    isSkeptic: true,
  },
  {
    number: '07',
    title: 'Contradiction Preservation',
    subtitle: 'CONFLICT_TRACK · PRESERVE',
    description: 'Contradictory findings are tracked and preserved. Conflicting claims are surfaced, not silently resolved.',
  },
  {
    number: '08',
    title: 'Reporting & Integrity Verification',
    subtitle: 'INTEGRATE · VALIDATE',
    description: 'Final report integrates findings while verification confirms citation integrity and source validity.',
  },
  {
    number: '09',
    title: 'Professional Export Formatting',
    subtitle: 'PDF · JSON · MD · HTML',
    description: 'Research dossiers exported in multiple formats with full citation metadata and audit trail.',
  },
];

// ===== RUNTIME TOPOLOGY =====

export const runtimeTopology: RuntimeNode[] = [
  {
    layer: 'Frontend',
    name: 'Vercel Edge',
    description: 'React / Vite / TypeScript',
  },
  {
    layer: 'Backend',
    name: 'Emma Runtime',
    description: 'Express / Socket.IO / Node',
  },
  {
    layer: 'Queue',
    name: 'Job Processing',
    description: 'BullMQ / Redis',
  },
  {
    layer: 'Corpus',
    name: 'Knowledge Store',
    description: 'PostgreSQL / pgvector',
  },
  {
    layer: 'Exports',
    name: 'Report Delivery',
    description: 'Emma /exports endpoint',
  },
];

// ===== RESEARCH MODES =====
// Legacy marketing/demo list — production research UIs use `constants/researchObjectives.ts`.
// `comprehensive` implied Living Reports; that is a per-report add-on, not a research mode.

export const researchModes: { id: ResearchMode; label: string; description: string }[] = [
  {
    id: 'standard',
    label: 'Standard',
    description: 'Balanced depth and speed for most research objectives',
  },
  {
    id: 'deep',
    label: 'Deep',
    description: 'Exhaustive investigation with maximum source coverage',
  },
  {
    id: 'adversarial',
    label: 'Deeper challenge',
    description: 'A heavier challenge pass with more thorough weakness detection',
  },
  {
    id: 'comprehensive',
    label: 'Comprehensive',
    description: 'Deprecated label — do not use in app research flows; Living Reports are add-on only',
  },
];

// ===== EVIDENCE TIER METADATA =====

export const evidenceTierMeta: Record<EvidenceTier, { label: string; color: string; description: string }> = {
  verified: {
    label: 'Verified',
    color: 'cyan',
    description: 'Multiple independent sources with high corroboration',
  },
  corroborated: {
    label: 'Corroborated',
    color: 'green',
    description: 'Supporting corroboration from independent sources',
  },
  supported: {
    label: 'Supported',
    color: 'amber',
    description: 'Source support present but limited corroboration',
  },
  uncorroborated: {
    label: 'Uncorroborated',
    color: 'gray',
    description: 'Single source or insufficient verification',
  },
  contested: {
    label: 'Contested',
    color: 'red',
    description: 'Contradictory sources exist',
  },
};

// ===== SAMPLE REPORT DATA =====

export const sampleReportData = {
  id: 'sample-001',
  title: 'AI Governance Frameworks: Comparative Analysis',
  runId: 'run-sample-001',
  status: 'published' as const,
  evidenceTier: 'corroborated' as EvidenceTier,
  citationCount: 47,
  contradictionCount: 3,
  createdAt: '2024-01-15T10:30:00Z',
  updatedAt: '2024-01-15T14:22:00Z',
  executiveSummary: `This analysis examines regulatory frameworks for artificial intelligence across the European Union, United States, and Asia-Pacific regions. Key findings indicate divergent approaches: the EU prioritizes risk-based classification, the US favors sector-specific guidelines, while APAC nations demonstrate varied adoption rates.

Significant contradictions exist in stakeholder assessments of enforcement effectiveness. Three major disagreements are preserved in the contradiction ledger for transparency.`,
  claims: [
    {
      id: 'claim-1',
      text: 'The EU AI Act establishes a risk-based classification system with four tiers: unacceptable, high, limited, and minimal risk.',
      evidenceTier: 'verified' as EvidenceTier,
      confidence: 0.95,
      citations: [
        { id: 'cite-1', source: 'European Commission', excerpt: 'Official regulatory framework document' },
        { id: 'cite-2', source: 'EUR-Lex', excerpt: 'Legal text reference' },
      ],
    },
    {
      id: 'claim-2',
      text: 'US AI governance relies primarily on voluntary guidelines and sector-specific agency regulation.',
      evidenceTier: 'corroborated' as EvidenceTier,
      confidence: 0.88,
      citations: [
        { id: 'cite-3', source: 'NIST AI RMF', excerpt: 'Voluntary framework publication' },
        { id: 'cite-4', source: 'White House Executive Order', excerpt: 'Policy directive' },
      ],
    },
    {
      id: 'claim-3',
      text: 'Enforcement effectiveness varies significantly, with critics citing resource constraints.',
      evidenceTier: 'contested' as EvidenceTier,
      confidence: 0.62,
      citations: [
        { id: 'cite-5', source: 'Industry Analysis Report', excerpt: 'Stakeholder assessment' },
      ],
    },
  ],
  contradictions: [
    {
      id: 'contra-1',
      claimA: 'EU enforcement mechanisms are adequately resourced',
      claimB: 'EU member states lack technical capacity for AI auditing',
      source: 'Comparative regulatory analysis',
      severity: 'moderate' as const,
    },
  ],
  challengeNotes: [
    'Limited longitudinal data on enforcement outcomes - most frameworks are less than 2 years old',
    'Industry-funded studies may exhibit bias toward voluntary approaches',
    'Cross-jurisdictional comparison complicated by definitional differences in "AI system"',
  ],
  revisionHistory: [
    { version: 1, timestamp: '2024-01-15T10:30:00Z', changes: 'Initial draft generated', agent: 'Drafting' },
    { version: 2, timestamp: '2024-01-15T11:45:00Z', changes: 'Challenge pass completed - 3 weaknesses flagged', agent: 'Challenge' },
    { version: 3, timestamp: '2024-01-15T13:00:00Z', changes: 'Citations verified, 2 sources upgraded', agent: 'Verifier' },
    { version: 4, timestamp: '2024-01-15T14:22:00Z', changes: 'Final review and publication', agent: 'Report' },
  ],
};
