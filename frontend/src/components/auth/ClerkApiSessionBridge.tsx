import { useAuth } from '@clerk/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { registerClerkTokenGetter } from '../../utils/clerkSession';
import { syncLocalUserFromClerk } from '../../utils/api';

const MAX_SYNC_RETRIES = 4;
const SYNC_RETRY_BASE_DELAY_MS = 2000;

/** Registers Clerk `getToken` with the shared Axios client interceptor (see `utils/api.ts`).
 *  Also POSTs `/auth/sync` once per signed-in userId, with exponential-backoff retries
 *  (up to MAX_SYNC_RETRIES) so transient 5xx / network errors don't permanently skip the sync.
 */
export default function ClerkApiSessionBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const syncedUserIdRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncRetry, setSyncRetry] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    registerClerkTokenGetter(() => getToken());

    if (!isSignedIn || !userId) {
      if (!isSignedIn) {
        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        syncedUserIdRef.current = null;
        setSyncRetry(0);
      }
      return;
    }
    if (syncedUserIdRef.current === userId) return;
    syncedUserIdRef.current = userId;
    void syncLocalUserFromClerk().catch(() => {
      syncedUserIdRef.current = null;
      if (syncRetry < MAX_SYNC_RETRIES) {
        retryTimerRef.current = setTimeout(
          () => setSyncRetry((n) => n + 1),
          SYNC_RETRY_BASE_DELAY_MS * Math.pow(2, syncRetry),
        );
      }
    });

    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [getToken, isLoaded, isSignedIn, userId, syncRetry]);

  return children;
}
