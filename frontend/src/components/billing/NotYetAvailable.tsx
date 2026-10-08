type NotYetAvailableProps = {
  /** `marketing` matches the public pricing cards; `app` matches the signed-in billing pages. */
  tone?: 'marketing' | 'app';
  className?: string;
  /** What is not available, when it is one part of a card: "Annual billing", "10 tokens — $40". */
  subject?: string;
};

/**
 * Shown in place of a buy button when a price cannot be purchased on this
 * deployment. One component so the wording is the same everywhere a price is listed.
 */
export default function NotYetAvailable({ tone = 'app', className = '', subject }: NotYetAvailableProps) {
  const toneClass =
    tone === 'marketing'
      ? 'text-xs font-medium uppercase tracking-[0.16em] text-r1-text-muted'
      : 'text-xs font-medium uppercase tracking-wide text-slate-400';
  return (
    <p className={`${toneClass} ${className}`.trim()}>
      {subject ? <span className="normal-case tracking-normal">{subject}: </span> : null}
      Not yet available
    </p>
  );
}
