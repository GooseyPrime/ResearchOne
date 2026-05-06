import { useAuth } from '@clerk/clerk-react';
import { useEffect, type ReactNode } from 'react';
import { registerClerkTokenGetter } from '../../utils/clerkSession';

/** Registers Clerk `getToken` with the shared Axios client interceptor (see `utils/api.ts`). */
export default function ClerkApiSessionBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    registerClerkTokenGetter(() => getToken());
  }, [getToken, isLoaded]);

  return children;
}
