import { useAuth } from '@clerk/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { registerClerkTokenGetter } from '../../utils/clerkSession';
import { syncLocalUserFromClerk } from '../../utils/api';
import { reconnectSocketForSessionChange } from '../../utils/socket';

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
  const socketUserIdRef = useRef<string | null | undefined>(undefined);

  // The live connection is tied to one signed-in user. When the user changes
  // (sign-out, account switch) reconnect so it carries the new session only.
  useEffect(() => {
    if (!isLoaded) return;
    const current = isSignedIn && userId ? userId : null;
    const previous = socketUserIdRef.current;
    socketUserIdRef.current = current;
    if (previous !== undefined && previous !== current) reconnectSocketForSessionChange();
  }, [isLoaded, isSignedIn, userId]);

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
