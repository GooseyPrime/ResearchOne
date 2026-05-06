import { Link } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/methodology', label: 'Methodology' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/sovereign', label: 'Sovereign' },
];

export default function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-r1-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="font-serif text-xl text-r1-text">
          ResearchOne
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link key={item.to} to={item.to} className="text-sm text-r1-text-muted transition hover:text-r1-text">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <Link to="/app/research" className="text-sm text-r1-text-muted transition hover:text-r1-text">
            Sign in
          </Link>
          <Link
            to="/app/research"
            className="rounded-md bg-r1-accent px-3 py-2 text-sm font-semibold text-r1-bg transition hover:bg-r1-accent-deep"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
