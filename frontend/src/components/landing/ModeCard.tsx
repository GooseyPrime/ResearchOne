type ModeCardProps = {
  mode: string;
  description: string;
  example: string;
};

export default function ModeCard({ mode, description, example }: ModeCardProps) {
  return (
    <article className="rounded-xl border border-white/10 bg-r1-bg-deep/80 p-4">
      <h3 className="font-semibold text-r1-text">{mode}</h3>
      <p className="mt-2 text-sm text-r1-text-muted">{description}</p>
      <p className="mt-2 text-xs font-mono text-r1-text-muted">{example}</p>
    </article>
  );
}
