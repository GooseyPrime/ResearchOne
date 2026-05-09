import { Link } from 'react-router-dom';

export default function FinalCTA() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
      <h2 className="font-serif text-3xl">Stop arguing about what you found. Start defending it.</h2>
      <p className="mx-auto mt-4 max-w-2xl text-r1-text-muted">
        Three reports free. No card required. Watermarked output until you upgrade. See what a citation-grade brief feels like.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          to="/sign-up"
          className="rounded-md bg-r1-accent px-5 py-3 font-semibold text-r1-bg hover:bg-r1-accent-deep"
        >
          Start free
        </Link>
        <Link
          to="/pricing"
          className="rounded-md border border-white/20 px-5 py-3 font-semibold text-r1-text hover:border-r1-accent"
        >
          See pricing
        </Link>
      </div>
    </section>
  );
}
