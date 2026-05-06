import { useAuth } from '@clerk/react';
import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export default function RequireAuth({ children }: { children: ReactElement }) {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();

  if (!isLoaded) {
    return <div className="p-6 text-sm text-slate-400">Loading account…</div>;
  }

  if (!isSignedIn) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/sign-in?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  return children;
}
