import { createContext, useContext } from 'react';

export type ResearchPageShellContextValue = {
  /** Child pages hide duplicate page titles when rendered inside the unified shell. */
  embeddedInShell: boolean;
  /** Sync `?engine=v2` when opening a Deep Research run. */
  syncEngineForRun: (engineVersion?: string | null) => void;
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
      syncEngineForRun: () => {},
    }
  );
}
