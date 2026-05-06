import { useUser } from '@clerk/clerk-react';
import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';

export default function RequireAdmin({ children }: { children: ReactElement }) {
  const { isLoaded, user } = useUser();

  if (!isLoaded) return <div className="p-6 text-sm text-slate-400">Loading account…</div>;

  const isAdmin = user?.publicMetadata?.role === 'admin';
  return isAdmin ? children : <Navigate to="/app/research" replace />;
}
