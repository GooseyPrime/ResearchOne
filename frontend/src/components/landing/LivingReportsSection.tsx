import { Link } from 'react-router-dom';
import LivingReportTimeline from './LivingReportTimeline';

const EXPLAINERS = [
  {
    title: 'Monitored',
    body: 'You define the watch criteria. We re-run only the relevant pipeline stages on your cadence — daily, weekly, or on-trigger.',
  },
  {
    title: 'Versioned',
    body: 'Every update is a new version. Pin, compare, or roll back. The version history is part of the audit trail.',
  },
  {
    title: 'Notified',
    body: "Email, webhook, or in-app. You decide what's worth waking up for.",
  },
] as const;

export default function LivingReportsSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="font-serif text-3xl">When the world changes, your report knows.</h2>
      <p className="mt-3 max-w-3xl text-r1-text-muted">
        Living Reports are the only way to keep a workspace working past 120 days. Pick your monitoring cadence.
        Pin the version your team agreed on. Get notified when a source retracts, a number moves, or new evidence lands.
      </p>

      <div className="mt-8 r1-marketing-surface rounded-xl border border-white/10 p-4 sm:p-6">
        <LivingReportTimeline />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {EXPLAINERS.map((item) => (
          <article key={item.title} className="rounded-xl border border-white/10 bg-r1-bg-deep p-5">
            <h3 className="font-semibold text-r1-text">{item.title}</h3>
            <p className="mt-2 text-sm text-r1-text-muted">{item.body}</p>
          </article>
        ))}
      </div>

      <p className="mt-6 text-sm">
        <Link to="/pricing#living-reports" className="text-r1-accent hover:underline">
          Add a Living Report to any finalized report →
        </Link>
      </p>
    </section>
  );
}
