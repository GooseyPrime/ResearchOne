import {
  Bookmark,
  GitBranch,
  KeyRound,
  Layers,
  Scale,
  Shield,
} from 'lucide-react';
import type { FeatureCardProps } from '../components/landing/FeatureCard';
import { customerOption } from './customerOptions';

/** Six small cards (caps enforced in FeatureCard). */
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
    headline: 'Source strength, shown',
    description: 'Each source is ranked by how strongly it is corroborated. When a ranking changes, the version history shows it.',
    metric: 'Strongest to weakest',
  },
  {
    icon: Scale,
    headline: 'Source disagreements, visible',
    description:
      'We do not silently smooth disagreement. Conflicting findings stay attributed and available for review.',
    metric: '0 silent rewrites',
  },
  {
    icon: Bookmark,
    headline: 'Citations bound to findings',
    description: 'Every finding binds to its source passage. Change a finding and its citation moves with it.',
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
    description: 'Run on your own model and search keys, billed by your own providers.',
    metric: customerOption('plan', 'byok').name,
  },
];
