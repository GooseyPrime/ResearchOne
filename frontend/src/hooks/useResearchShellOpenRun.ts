import { useCallback, useEffect } from 'react';
import type { ResearchRun } from '../utils/api';
import { isLiveAttachedResearchRun } from '../utils/researchOpenRun';
import { runNeedsShellModeSwitch, type ResearchShellMode } from '../utils/researchShellRunHandoff';

type UseResearchShellOpenRunArgs = {
  embeddedInShell: boolean;
  shellMode: ResearchShellMode;
  syncEngineForRun: (engineVersion?: string | null) => void;
  queueRunHandoff: (run: ResearchRun) => void;
  consumeRunHandoff: () => ResearchRun | null;
  attachRun: (args: { runId: string; runRow?: ResearchRun }) => Promise<unknown>;
  detachTracking: () => void;
  applyRequestFormFromRun: (run: ResearchRun) => void;
  addNotification: (severity: 'info' | 'error' | 'success', message: string) => void;
};

/**
 * Recent-run open handler that survives unified-console mode remounts (PR #149 Codex).
 */
export function useResearchShellOpenRun({
  embeddedInShell,
  shellMode,
  syncEngineForRun,
  queueRunHandoff,
  consumeRunHandoff,
  attachRun,
  detachTracking,
  applyRequestFormFromRun,
  addNotification,
}: UseResearchShellOpenRunArgs) {
  const finishOpenRun = useCallback(
    (run: ResearchRun) => {
      syncEngineForRun(run.engine_version);
      if (isLiveAttachedResearchRun(run.status)) {
        void attachRun({ runId: run.id, runRow: run });
        return;
      }
      detachTracking();
      applyRequestFormFromRun(run);
      addNotification('info', 'Loaded this run’s research request — edit and submit when ready.');
    },
    [syncEngineForRun, attachRun, detachTracking, applyRequestFormFromRun, addNotification]
  );

  const handleOpenRun = useCallback(
    (run: ResearchRun) => {
      if (embeddedInShell && runNeedsShellModeSwitch(run, shellMode)) {
        queueRunHandoff(run);
        syncEngineForRun(run.engine_version);
        return;
      }
      finishOpenRun(run);
    },
    [embeddedInShell, shellMode, queueRunHandoff, syncEngineForRun, finishOpenRun]
  );

  useEffect(() => {
    if (!embeddedInShell) return;
    const run = consumeRunHandoff();
    if (!run) return;
    finishOpenRun(run);
  }, [embeddedInShell, consumeRunHandoff, finishOpenRun]);

  return { handleOpenRun };
}
