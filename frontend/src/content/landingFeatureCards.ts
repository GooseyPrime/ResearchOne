import {
  Bookmark,
  GitBranch,
  KeyRound,
  Layers,
  Scale,
  Shield,
} from 'lucide-react';
import type { FeatureCardProps } from '../components/landing/FeatureCard';

/** Site audit §2.10 — six small cards (caps enforced in FeatureCard). */
export const LANDING_SIX_FEATURE_CARDS: readonly FeatureCardProps[] = [
  {
    icon: Shield,
    headline: 'Skeptic agent, by design',
    description:
      'A dedicated skeptic check challenges every claim before the report is bound.',
    metric: '1 of 7 agents',
  },
  {
    icon: Layers,
    headline: 'Source-corroboration tiers, surfaced',
    description: 'Each source carries its tier (1–4). Tier upgrades appear in the version history.',
    metric: 'Tier 1 → Tier 4',
  },
  {
    icon: Scale,
    headline: 'Contradictions, preserved',
    description: 'We do not silently smooth disagreement. Conflicting claims survive into the final report.',
    metric: '0 silent rewrites',
  },
  {
    icon: Bookmark,
    headline: 'Citations bound to claims',
    description: 'Every claim binds to its source span. Break a claim, the citation goes with it.',
    metric: '100% bound',
  },
  {
    icon: GitBranch,
    headline: 'Reports that keep learning',
    description: 'New citations, upgraded sources, and team pins land as discrete versions you can scrub.',
    metric: 'Living updates',
  },
  {
    icon: KeyRound,
    headline: 'Bring your own keys',
    description: 'Run on your own model and search keys. Sovereign tier keeps every byte in your tenancy.',
    metric: 'BYOK · Sovereign',
  },
];
