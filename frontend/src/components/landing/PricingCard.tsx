import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type PricingCardProps = {
  title: string;
  details: string;
  cta: string;
  to?: string;
  ctaSlot?: ReactNode;
  featured?: boolean;
  badge?: string;
};

function isExternal(to: string): boolean {
  return /^(mailto:|https?:\/\/|tel:)/i.test(to);
}

export default function PricingCard({
  title,
  details,
  cta,
  to,
  ctaSlot,
  featured = false,
  badge,
}: PricingCardProps) {
  const ctaClass =
    'mt-5 inline-flex rounded-md bg-r1-accent px-3 py-2 text-sm font-semibold text-r1-bg transition hover:bg-r1-accent-deep';
  return (
    <article className={`rounded-xl border p-6 ${featured ? 'border-r1-accent bg-r1-bg' : 'border-white/10 bg-r1-bg-deep'}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-2xl text-r1-text">{title}</h2>
        {badge ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-7 text-r1-text-muted">{details}</p>
      {ctaSlot ??
        (to &&
          (isExternal(to) ? (
            <a href={to} className={ctaClass}>
              {cta}
            </a>
          ) : (
            <Link to={to} className={ctaClass}>
              {cta}
            </Link>
          )))}
    </article>
  );
}
