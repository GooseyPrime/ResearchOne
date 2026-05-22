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
  const lastHandledUrlRunId = useRef<string | null>(null);

  const setUrlRunId = useCallback(
    (runId: string | null, replace = true) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (runId) next.set('runId', runId);
          else next.delete('runId');
          return next;
        },
        { replace }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (!enabled) return;
    if (trackingRunId) {
      if (urlRunId !== trackingRunId) setUrlRunId(trackingRunId, true);
      return;
    }
    if (urlRunId && urlRunId !== lastHandledUrlRunId.current) {
      lastHandledUrlRunId.current = urlRunId;
      onRunIdFromUrl(urlRunId);
    }
  }, [enabled, trackingRunId, urlRunId, setUrlRunId, onRunIdFromUrl]);

  return { urlRunId, setUrlRunId };
}
