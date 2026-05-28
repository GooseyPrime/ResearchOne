import { createContext, useContext } from 'react';
import type { ResearchRun } from '../utils/api';
import type { ResearchShellMode } from '../utils/researchShellRunHandoff';

export type ResearchPageShellContextValue = {
  /** Child pages hide duplicate page titles when rendered inside the unified shell. */
  embeddedInShell: boolean;
  /** Active Standard / Deep mode in the unified console (when embedded). */
  shellMode: ResearchShellMode;
  /** Sync `?engine=v2` when opening a Deep Research run. */
  syncEngineForRun: (engineVersion?: string | null) => void;
  /** Stash a run before a cross-mode shell swap so the target page can attach/hydrate. */
  queueRunHandoff: (run: ResearchRun) => void;
  /** Take a stashed run once (null if none). */
  consumeRunHandoff: () => ResearchRun | null;
};

const ResearchPageShellContext = createContext<ResearchPageShellContextValue | null>(null);

export function ResearchPageShellProvider({
  value,
  children,
}: {
  value: ResearchPageShellContextValue;
  children: React.ReactNode;
}) {
  return (
    <ResearchPageShellContext.Provider value={value}>{children}</ResearchPageShellContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is intentionally colocated with its provider
export function useResearchPageShell(): ResearchPageShellContextValue {
  const ctx = useContext(ResearchPageShellContext);
  return (
    ctx ?? {
      embeddedInShell: false,
      shellMode: 'standard',
      syncEngineForRun: () => {},
      queueRunHandoff: () => {},
      consumeRunHandoff: () => null,
    }
  );
}
