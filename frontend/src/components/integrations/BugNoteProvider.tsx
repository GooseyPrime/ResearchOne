import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

export type BugNoteContextValue = {
  enabled: boolean;
  captureError: (message: string, context?: Record<string, unknown>) => void;
};

const BugNoteContext = createContext<BugNoteContextValue>({
  enabled: false,
  captureError: () => {},
});

type BugNoteSdk = {
  identify?: (traits: Record<string, unknown>) => void;
  capture?: (payload: Record<string, unknown>) => void;
  captureException?: (error: Error, context?: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    BugNote?: BugNoteSdk;
  }
}

function bugNoteEnabled(): boolean {
  return (
    import.meta.env.VITE_BUGNOTE_ENABLED === 'true' &&
    Boolean(import.meta.env.VITE_BUGNOTE_WIDGET_URL?.trim())
  );
}

function widgetScriptUrl(): string | null {
  const url = import.meta.env.VITE_BUGNOTE_WIDGET_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export type BugNoteProviderProps = {
  children: ReactNode;
  userId?: string | null;
  route?: string | null;
  runId?: string | null;
};

export function BugNoteProvider({ children, userId, route, runId }: BugNoteProviderProps) {
  const enabled = bugNoteEnabled();
  const widgetUrl = widgetScriptUrl();

  useEffect(() => {
    if (!enabled || !widgetUrl) return;

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-researchone-bugnote="true"]'
    );
    if (existing) return;

    const script = document.createElement('script');
    script.src = widgetUrl;
    script.async = true;
    script.defer = true;
    script.dataset.researchoneBugnote = 'true';
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [enabled, widgetUrl]);

  useEffect(() => {
    if (!enabled) return;

    const traits: Record<string, unknown> = {};
    if (userId) traits.userId = userId;
    if (route) traits.route = route;
    if (runId) traits.runId = runId;

    if (Object.keys(traits).length === 0) return;

    try {
      window.BugNote?.identify?.(traits);
    } catch {
      // Widget API unverified — never break the app shell.
    }
  }, [enabled, userId, route, runId]);

  const captureError = useCallback(
    (message: string, context?: Record<string, unknown>) => {
      if (!enabled) return;

      const payload = { ...context, route, runId, userId: userId ?? undefined, message };

      try {
        const sdk = window.BugNote;
        if (sdk?.captureException) {
          sdk.captureException(new Error(message), payload);
          return;
        }
        if (sdk?.capture) {
          sdk.capture(payload);
          return;
        }
      } catch {
        // Swallow SDK failures until Phase B verifies the contract.
      }
    },
    [enabled, route, runId, userId]
  );

  const value = useMemo(
    (): BugNoteContextValue => ({
      enabled,
      captureError,
    }),
    [enabled, captureError]
  );

  return <BugNoteContext.Provider value={value}>{children}</BugNoteContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBugNote(): BugNoteContextValue {
  return useContext(BugNoteContext);
}
