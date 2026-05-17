import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/react';
import api from '../utils/api';

/** Belt-and-braces: ensure local `users` + `user_tiers` exist after Clerk sign-in. */
export function useEnsureUserSynced(): void {
  const { isLoaded, isSignedIn } = useAuth();
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || syncedRef.current) return;
    syncedRef.current = true;
    void api.post('/auth/sync').catch(() => {
      syncedRef.current = false;
    });
  }, [isLoaded, isSignedIn]);
}
