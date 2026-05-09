import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl p-8 text-slate-200">
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-8 text-center">
        <Compass className="mx-auto text-accent" size={48} aria-hidden />
        <h1 className="mt-4 font-serif text-3xl">Page not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          This URL doesn&apos;t match any page in your workspace. It may have been moved or you may have followed an old link.
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
            Billing
          </Link>
        </div>
      </div>
    </div>
  );
}
