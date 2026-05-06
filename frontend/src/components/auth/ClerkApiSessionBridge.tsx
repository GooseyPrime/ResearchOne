import { useAuth } from '@clerk/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { registerClerkTokenGetter } from '../../utils/clerkSession';
import { syncLocalUserFromClerk } from '../../utils/api';

/** Registers Clerk `getToken` with the shared Axios client interceptor (see `utils/api.ts`). */
export default function ClerkApiSessionBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const syncedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    registerClerkTokenGetter(() => getToken());

    if (!isSignedIn || !userId) {
      if (!isSignedIn) syncedUserIdRef.current = null;
      return;
    }
    if (syncedUserIdRef.current === userId) return;
    syncedUserIdRef.current = userId;
    void syncLocalUserFromClerk().catch(() => {
      syncedUserIdRef.current = null;
    });
  }, [getToken, isLoaded, isSignedIn, userId]);

  return children;
}
