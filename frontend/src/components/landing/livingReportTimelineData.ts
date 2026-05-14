export type LivingBadgeType = 'citation' | 'sourceUpgrade' | 'synthesis' | 'teamPin' | 'contradiction';

export interface LivingVersionDef {
  readonly label: string;
  readonly date: string;
  readonly badges: readonly { type: LivingBadgeType; text: string }[];
  /** How many footnote markers visible in mock doc (0–3). */
  readonly citationCount: 0 | 1 | 2 | 3;
  readonly showContradiction: boolean;
  readonly tierLabel: string;
}

export const LIVING_REPORT_VERSIONS: readonly LivingVersionDef[] = [
  {
    label: 'v0.1',
    date: 'Draft',
    badges: [{ type: 'synthesis', text: 'Initial draft assembled from tiered sources.' }],
    citationCount: 0,
    showContradiction: false,
    tierLabel: 'Mixed tiers',
  },
  {
    label: 'v0.25',
    date: 'Day 2',
    badges: [{ type: 'citation', text: 'First claim bound to primary source span.' }],
    citationCount: 1,
    showContradiction: false,
    tierLabel: 'Tier 2 lead',
  },
  {
    label: 'v0.4',
    date: 'Day 5',
    badges: [{ type: 'sourceUpgrade', text: 'Key claim upgraded after Tier-1 RCT added.' }],
    citationCount: 2,
    showContradiction: false,
    tierLabel: 'Tier 1 anchor',
  },
  {
    label: 'v0.55',
    date: 'Day 9',
    badges: [{ type: 'contradiction', text: 'Opposing trial surfaced; contradiction flagged.' }],
    citationCount: 2,
    showContradiction: true,
    tierLabel: 'Tier 1 + conflict',
  },
  {
    label: 'v0.7',
    date: 'Day 14',
    badges: [{ type: 'synthesis', text: 'Synthesis revised to name both lines of sources.' }],
    citationCount: 3,
    showContradiction: true,
    tierLabel: 'Tier 1 + conflict',
  },
  {
    label: 'v0.85',
    date: 'Day 20',
    badges: [{ type: 'teamPin', text: 'Analyst pinned the disputed paragraph for review.' }],
    citationCount: 3,
    showContradiction: true,
    tierLabel: 'Pinned + conflict',
  },
  {
    label: 'v1.0',
    date: 'Published',
    badges: [
      { type: 'citation', text: 'Final citation pass: every claim carries a span.' },
      { type: 'synthesis', text: 'Closing prose locked for audit export.' },
    ],
    citationCount: 3,
    showContradiction: true,
    tierLabel: 'Publication-ready',
  },
];

export const BADGE_COPY: Record<
  LivingBadgeType,
  { symbol: string; verb: string; className: string }
> = {
  citation: {
    symbol: '+',
    verb: 'Citation',
    className: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  },
  sourceUpgrade: {
    symbol: '↑',
    verb: 'Source upgrade',
    className: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100',
  },
  synthesis: {
    symbol: '±',
    verb: 'Synthesis',
    className: 'border-[#E8DFCB]/40 bg-[#E8DFCB]/10 text-[#E8DFCB]',
  },
  teamPin: {
    symbol: '📌',
    verb: 'Team pin',
    className: 'border-slate-400/50 bg-slate-500/15 text-slate-200',
  },
  contradiction: {
    symbol: '⚠',
    verb: 'Contradiction',
    className: 'border-[#D45B9E]/50 bg-[#D45B9E]/15 text-[#D45B9E]',
  },
};
