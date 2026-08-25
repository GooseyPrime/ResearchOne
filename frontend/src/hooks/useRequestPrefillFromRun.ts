import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getResearchRun, type ResearchRun } from '../utils/api';
import {
  REQUEST_PREFILL_PARAM,
  parsePrefillRunIdFromSearchParams,
} from '../utils/researchRunRoutes';

/**
 * Restore a previous run's inputs into the request form.
 *
 * Cancelling at the plan gate used to call `applyRequestFormFromRun` directly,
 * because the gate rendered on the same page as the form. The gate now lives in
 * the run's workspace, so "cancel" has to carry the request back across a
 * navigation — `?prefill=<runId>` — and this hook is the other half of that.
 *
 * Without it, cancelling would silently discard what the user typed, which is
 * the opposite of what cancel meant before (Rule 44 T4).
 *
 * Applied at most once per run id. A second application would stamp on edits
 * the user had already started making, and the param survives in history.
 */
export function useRequestPrefillFromRun(apply: (run: ResearchRun) => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedRef = useRef<string | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const prefillRunId = parsePrefillRunIdFromSearchParams(searchParams);

  useEffect(() => {
    if (!prefillRunId || appliedRef.current === prefillRunId) return;
    appliedRef.current = prefillRunId;

    let cancelled = false;
    void (async () => {
      try {
        const run = await getResearchRun(prefillRunId);
        if (!cancelled && run) applyRef.current(run);
      } catch {
        // The run is gone or unreadable. An empty form is a worse outcome than
        // a prefilled one but a better outcome than an error page, and the user
        // still has their request in the run they just cancelled.
      } finally {
        if (!cancelled) {
          // Strip the param so a refresh does not re-apply it over edits.
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete(REQUEST_PREFILL_PARAM);
              return next;
            },
            { replace: true }
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [prefillRunId, setSearchParams]);
}
