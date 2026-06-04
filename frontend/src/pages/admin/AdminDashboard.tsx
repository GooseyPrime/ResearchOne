import { Link, Outlet, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '', label: 'Overview' },
  { path: 'reports', label: 'Reports' },
  { path: 'corpus', label: 'Corpus' },
  { path: 'users', label: 'User Lookup' },
  { path: 'telemetry', label: 'Run Telemetry' },
  { path: 'cost', label: 'Cost Analytics' },
  { path: 'audit', label: 'Audit Log' },
];

export default function AdminDashboard() {
  const location = useLocation();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold mb-4">Admin Dashboard</h1>
      <nav className="flex flex-wrap gap-2 mb-6 border-b border-white/10 pb-3">
        {NAV_ITEMS.map((item) => {
          const href = item.path ? `/app/admin/${item.path}` : '/app/admin';
          const active =
            item.path === ''
              ? location.pathname === '/app/admin' || location.pathname === '/app/admin/'
              : location.pathname.startsWith(`/app/admin/${item.path}`);
          return (
            <Link
              key={item.path || 'overview'}
              to={href}
              className={`px-3 py-1.5 text-sm rounded transition ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
