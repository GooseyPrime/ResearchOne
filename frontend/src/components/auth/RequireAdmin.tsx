import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../../utils/api';

export default function RequireAdmin({ children }: { children: ReactElement }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ userId: string; isAdmin: boolean }>('/auth/me').then((r) => r.data),
    enabled: Boolean(isLoaded && isSignedIn),
    staleTime: 60_000,
    retry: false,
  });

  if (!isLoaded || isLoading) {
    return <div className="p-6 text-sm text-slate-400">Loading account…</div>;
  }

  if (!isSignedIn || !data?.isAdmin) {
    return <Navigate to="/app/research" replace />;
  }

  return children;
}
