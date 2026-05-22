import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/react';
import api from '../utils/api';

const SYNC_RETRY_MS = [2000, 5000, 10000] as const;

/** Belt-and-braces: ensure local `users` + `user_tiers` exist after Clerk sign-in. */
export function useEnsureUserSynced(): void {
  const { isLoaded, isSignedIn } = useAuth();
  const syncedRef = useRef(false);
  const retryIndexRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      syncedRef.current = false;
      retryIndexRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }

    if (syncedRef.current) return;

    const runSync = () => {
      void api
        .post('/auth/sync')
        .then(() => {
          syncedRef.current = true;
          retryIndexRef.current = 0;
        })
        .catch(() => {
          syncedRef.current = false;
          const delay = SYNC_RETRY_MS[retryIndexRef.current];
          if (delay == null) return;
          retryIndexRef.current += 1;
          retryTimerRef.current = setTimeout(runSync, delay);
        });
    };

    runSync();

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [isLoaded, isSignedIn]);
}
