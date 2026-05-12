import type { LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export const FEATURE_CARD_CHAR_CAPS = {
  eyebrow: 24,
  headline: 42,
  description: 110,
  metric: 18,
} as const;

const CAP_EYEBROW = FEATURE_CARD_CHAR_CAPS.eyebrow;
const CAP_HEADLINE = FEATURE_CARD_CHAR_CAPS.headline;
const CAP_DESCRIPTION = FEATURE_CARD_CHAR_CAPS.description;
const CAP_METRIC = FEATURE_CARD_CHAR_CAPS.metric;

function warnIfOverCap(label: string, value: string, cap: number) {
  if (import.meta.env.PROD) return;
  if (value.length > cap) {
    console.warn(`[FeatureCard] ${label} exceeds ${cap} characters (${value.length}):`, value);
  }
}

export interface FeatureCardProps {
  icon: LucideIcon;
  headline: string;
  description: string;
  eyebrow?: string;
  metric?: string;
  /** In-app navigation (preferred over href). */
  to?: string;
}

/**
 * Strict-cap marketing card (site audit §2.1.3 / §3.4).
 * Parent grid should use `auto-rows: 1fr` for equal row heights.
 */
export default function FeatureCard({
  icon: Icon,
  headline,
  description,
  eyebrow,
  metric,
  to,
}: FeatureCardProps) {
  useEffect(() => {
    if (eyebrow) warnIfOverCap('eyebrow', eyebrow, CAP_EYEBROW);
    warnIfOverCap('headline', headline, CAP_HEADLINE);
    warnIfOverCap('description', description, CAP_DESCRIPTION);
    if (metric) warnIfOverCap('metric', metric, CAP_METRIC);
  }, [eyebrow, headline, description, metric]);

  const body = (
    <>
      <Icon className="h-5 w-5 shrink-0 text-r1-accent" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="mb-2 max-w-full truncate font-mono text-[11px] uppercase tracking-[0.18em] text-r1-accent">
            {eyebrow}
          </p>
        ) : null}
        <h3 className="max-w-full truncate font-serif text-lg font-semibold leading-snug text-r1-text">{headline}</h3>
        <p className="mt-2 line-clamp-2 max-w-full text-sm leading-snug text-r1-text-muted">{description}</p>
        {metric ? (
          <p className="mt-4 font-mono text-[11px] tabular-nums text-r1-accent">{metric}</p>
        ) : null}
      </div>
    </>
  );

  const shellClass =
    'flex h-full gap-3 rounded-xl border border-white/10 bg-r1-bg-deep p-5 transition hover:-translate-y-0.5 hover:border-r1-accent/40';

  if (to) {
    return (
      <Link to={to} className={`${shellClass} block no-underline`}>
        {body}
      </Link>
    );
  }

  return <article className={shellClass}>{body}</article>;
}
