import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseRunIdFromSearchParams } from '../utils/researchRunRoutes';

/**
 * Keeps `?runId=` in sync with the actively tracked run on a research page.
 * `onRunIdFromUrl` fires when the URL carries a run id (mount + external navigation).
 */
export function useResearchRunUrlSync({
  trackingRunId,
  onRunIdFromUrl,
  enabled = true,
}: {
  trackingRunId: string | null;
  onRunIdFromUrl: (runId: string) => void;
  enabled?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlRunId = parseRunIdFromSearchParams(searchParams);
  /** Run ids we must not auto-reattach from URL after intentional detach. */
  const suppressedUrlRunIdRef = useRef<string | null>(null);

  const setUrlRunId = useCallback(
    (runId: string | null, replace = true) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (runId) {
            next.set('runId', runId);
            suppressedUrlRunIdRef.current = null;
          } else {
            const clearing = parseRunIdFromSearchParams(prev);
            if (clearing) suppressedUrlRunIdRef.current = clearing;
            next.delete('runId');
          }
          return next;
        },
        { replace }
      );
    },
    [setSearchParams]
  );

  /** Call before clearing tracking so `?runId=` does not immediately re-attach. */
  const dismissUrlReattach = useCallback(
    (runId?: string | null) => {
      const id = runId ?? urlRunId ?? suppressedUrlRunIdRef.current;
      if (id) suppressedUrlRunIdRef.current = id;
    },
    [urlRunId]
  );

  useEffect(() => {
    if (!enabled) return;
    if (trackingRunId) {
      if (urlRunId !== trackingRunId) setUrlRunId(trackingRunId, true);
      return;
    }
    if (!urlRunId || urlRunId === suppressedUrlRunIdRef.current) return;
    suppressedUrlRunIdRef.current = urlRunId;
    onRunIdFromUrl(urlRunId);
  }, [enabled, trackingRunId, urlRunId, setUrlRunId, onRunIdFromUrl]);

  return { urlRunId, setUrlRunId, dismissUrlReattach };
}
