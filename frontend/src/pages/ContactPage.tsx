import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

const CHANNELS = [
  {
    title: 'Sales',
    body: 'Pricing, pilots, and enterprise agreements.',
    href: 'mailto:hello@researchone.io?subject=ResearchOne%20inquiry',
    label: 'hello@researchone.io',
  },
  {
    title: 'Security',
    body: 'Responsible disclosure, questionnaires, and data handling.',
    href: 'mailto:security@researchone.io?subject=Security%20inquiry',
    label: 'security@researchone.io',
  },
  {
    title: 'Press',
    body: 'Media kit requests, on-background briefings, and product fact-checking.',
    href: 'mailto:press@researchone.io?subject=Press%20inquiry',
    label: 'press@researchone.io',
  },
] as const;

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Talk to ResearchOne.</h1>
        <p className="mt-3 max-w-2xl text-r1-text-muted">
          Use the channel that matches your request. We route security and privacy mail separately from commercial
          conversations.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {CHANNELS.map((c) => (
            <article key={c.title} className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
              <h2 className="font-semibold text-r1-text">{c.title}</h2>
              <p className="mt-2 text-sm text-r1-text-muted">{c.body}</p>
              <a
                href={c.href}
                className="mt-4 inline-block text-sm text-r1-accent hover:underline"
                rel="noopener noreferrer"
              >
                {c.label}
              </a>
            </article>
          ))}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
