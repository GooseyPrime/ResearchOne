const PILLARS = [
  'Source-corroboration tiers · Tier 1 → Tier 4',
  'Adversarial Skeptic pass',
  'Living, versioned reports',
] as const;

/** Trust signals under the hero pipeline — compact row (Wave 4 layout polish). */
export default function TrustStrip() {
  return (
    <div className="mx-auto w-full max-w-6xl border-t border-white/10 px-4 pt-8 sm:px-6">
      <p className="sr-only">Trust signals: source-corroboration discipline, adversarial review, and versioned reports.</p>
      <ul className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
        {PILLARS.map((label) => (
          <li key={label} className="list-none">
            <span className="flex min-h-[2.5rem] items-center justify-center rounded-lg border border-white/12 bg-r1-bg-deep/90 px-4 py-2 text-center text-xs font-medium leading-snug text-r1-text-muted shadow-sm backdrop-blur-sm sm:text-sm">
              {label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
