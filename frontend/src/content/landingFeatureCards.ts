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
    headline: 'Adaptive verification, by design',
    description:
      'Verification intensity scales with the request, evidence quality, and risk profile.',
    metric: 'Intent-aware checks',
  },
  {
    icon: Layers,
    headline: 'Source-corroboration tiers, surfaced',
    description: 'Each source carries its tier (1–4). Tier upgrades appear in the version history.',
    metric: 'Tier 1 → Tier 4',
  },
  {
    icon: Scale,
    headline: 'Source disagreements, visible',
    description:
      'We do not silently smooth disagreement. Conflicting claims stay attributed and available for review.',
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
