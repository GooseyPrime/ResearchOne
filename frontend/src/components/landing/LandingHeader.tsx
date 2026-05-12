import { Link } from 'react-router-dom';
import { MARKETING_HEADER_NAV } from '../../lib/marketingNav';

export default function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-r1-bg-deep backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="shrink-0 font-serif text-xl text-r1-text">
          ResearchOne
        </Link>
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-5 md:flex">
          {MARKETING_HEADER_NAV.map((item) => (
            <Link key={item.to} to={item.to} className="shrink-0 text-sm text-r1-text-muted transition hover:text-r1-text">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <Link
            to="/sample-report"
            className="hidden text-sm text-r1-accent transition hover:underline sm:inline"
          >
            Sample report
          </Link>
          <Link to="/sign-in" className="text-sm text-r1-text-muted transition hover:text-r1-text">
            Sign in
          </Link>
          <Link
            to="/sign-up"
            className="rounded-md bg-r1-accent px-3 py-2 text-sm font-semibold text-r1-bg transition hover:bg-r1-accent-deep"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
