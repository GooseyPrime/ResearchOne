import { Link } from 'react-router-dom';

type PricingCardProps = {
  title: string;
  details: string;
  cta: string;
  to: string;
  featured?: boolean;
};

export default function PricingCard({ title, details, cta, to, featured = false }: PricingCardProps) {
  return (
    <article className={`rounded-xl border p-6 ${featured ? 'border-r1-accent bg-r1-bg' : 'border-white/10 bg-r1-bg-deep'}`}>
      <h3 className="font-serif text-2xl text-r1-text">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-r1-text-muted">{details}</p>
      <Link
        to={to}
        className="mt-5 inline-flex rounded-md bg-r1-accent px-3 py-2 text-sm font-semibold text-r1-bg transition hover:bg-r1-accent-deep"
      >
        {cta}
      </Link>
    </article>
  );
}
