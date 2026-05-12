const PILLARS = [
  'Citation-graded · evidence tiers',
  'Adversarial Skeptic pass',
  'Living, versioned reports',
] as const;

/** Trust signals directly under the hero — opaque pills so lab-notebook ruling does not show through. */
export default function TrustStrip() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
      <div className="flex flex-wrap justify-center gap-3 md:justify-start">
        {PILLARS.map((label) => (
          <span
            key={label}
            className="rounded-full border border-white/15 bg-r1-bg-deep px-4 py-2 text-center text-xs font-medium text-r1-text-muted md:text-sm"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
