import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

export default function NotFoundPage() {
  const { pathname } = useLocation();
  const isApp = pathname === '/app' || pathname.startsWith('/app/');

  if (isApp) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-slate-200">
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-8 text-center">
          <Compass className="mx-auto text-accent" size={48} aria-hidden />
          <h1 className="mt-4 font-serif text-3xl">Page not found</h1>
          <p className="mt-2 text-sm text-slate-400">
            This URL doesn&apos;t match any page in your workspace. It may have been moved or you may have followed an old
            link.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/app/research"
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Go to Research
            </Link>
            <Link to="/app/reports" className="text-sm text-slate-400 hover:text-slate-200">
              Reports
            </Link>
            <Link to="/app/billing" className="text-sm text-slate-400 hover:text-slate-200">
              Account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
        <h1 className="font-serif text-3xl text-r1-text">This claim could not be sourced.</h1>
        <p className="mt-3 text-r1-text-muted">
          The page you requested is not in our index. Try the methodology, a sample report, or the Living Report section on
          the home page.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm">
          <Link to="/methodology" className="text-r1-accent hover:underline">
            Methodology
          </Link>
          <Link to="/sample-report" className="text-r1-accent hover:underline">
            Sample report
          </Link>
          <Link to="/" className="text-r1-accent hover:underline">
            Home
          </Link>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
