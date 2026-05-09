import { Link, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { path: 'users', label: 'User Lookup' },
  { path: 'telemetry', label: 'Run Telemetry' },
  { path: 'audit', label: 'Audit Log' },
];

export default function AdminDashboard() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold mb-4">Admin Dashboard</h1>
      <nav className="flex gap-2 mb-6 border-b border-white/10 pb-3">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className="px-3 py-1.5 text-sm rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
