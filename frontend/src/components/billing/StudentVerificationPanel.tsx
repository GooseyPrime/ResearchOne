import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { extractApiError } from '../../utils/api';

const STUDENT_STATUS_QUERY_KEY = ['billing-student-status'] as const;

type StudentStatusResponse = {
  verified: boolean;
  programIdConfigured: boolean;
  programId: string | null;
  devBypassAvailable: boolean;
};

type SheerIdVerificationResponse = {
  verificationId?: string;
  currentStep?: string;
};

type SheerIdFormController = {
  on?: (
    hook: 'ON_VERIFICATION_SUCCESS',
    callback: (payload: SheerIdVerificationResponse) => void,
  ) => (() => void) | void;
  cleanup?: () => void;
};

/** @sheerid/jslib@1 UMD global — see loadInlineIframe + ON_VERIFICATION_SUCCESS hooks. */
type SheerIdSdk = {
  loadInlineIframe?: (programId: string, element: HTMLElement) => SheerIdFormController;
};

declare global {
  interface Window {
    sheerid?: SheerIdSdk;
  }
}

const SHEERID_JSLIB = 'https://cdn.jsdelivr.net/npm/@sheerid/jslib@1/sheerid.js';

function loadSheerIdScript(): Promise<void> {
  if (window.sheerid?.loadInlineIframe) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>('script[data-researchone-sheerid="true"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('SheerID script failed to load')), {
        once: true,
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SHEERID_JSLIB;
    script.async = true;
    script.dataset.researchoneSheerid = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('SheerID script failed to load'));
    document.head.appendChild(script);
  });
}

type StudentVerificationPanelProps = {
  onVerified?: () => void;
  compact?: boolean;
};

export default function StudentVerificationPanel({ onVerified, compact = false }: StudentVerificationPanelProps) {
  const formId = useId().replace(/:/g, '');
  const formRef = useRef<HTMLDivElement | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [devVerificationId, setDevVerificationId] = useState('');
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: STUDENT_STATUS_QUERY_KEY,
    queryFn: async () => (await api.get<StudentStatusResponse>('/billing/student/status')).data,
    staleTime: 30_000,
  });

  const verifyMutation = useMutation({
    mutationFn: async (verificationId: string) =>
      (await api.post<{ verified: boolean }>('/billing/student/verify', { verificationId })).data,
    onSuccess: (data) => {
      if (data.verified) {
        void queryClient.invalidateQueries({ queryKey: STUDENT_STATUS_QUERY_KEY });
        onVerified?.();
      }
    },
  });

  useEffect(() => {
    const programId = statusQuery.data?.programId;
    if (!programId || statusQuery.data?.verified || !formRef.current) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let controller: SheerIdFormController | undefined;

    void loadSheerIdScript()
      .then(() => {
        if (cancelled || !formRef.current || !window.sheerid?.loadInlineIframe) {
          if (!cancelled && !window.sheerid?.loadInlineIframe) {
            setWidgetError('SheerID widget is unavailable on this deployment.');
          }
          return;
        }

        controller = window.sheerid.loadInlineIframe(programId, formRef.current);
        const unsubResult = controller.on?.('ON_VERIFICATION_SUCCESS', (payload) => {
          const verificationId = payload?.verificationId?.trim();
          if (!verificationId) {
            setWidgetError('Verification completed but no verification id was returned.');
            return;
          }
          verifyMutation.mutate(verificationId);
        });
        if (typeof unsubResult === 'function') {
          unsubscribe = unsubResult;
        }
      })
      .catch(() => {
        if (!cancelled) setWidgetError('Could not load the SheerID verification widget.');
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      controller?.cleanup?.();
    };
  }, [statusQuery.data?.programId, statusQuery.data?.verified, verifyMutation]);

  if (statusQuery.isLoading) {
    return <p className="text-xs text-r1-text-muted">Checking student verification…</p>;
  }

  if (statusQuery.isError) {
    return <p className="text-xs text-red-400">{extractApiError(statusQuery.error)}</p>;
  }

  if (statusQuery.data?.verified) {
    return (
      <p className="text-xs text-emerald-400">
        Student status verified — you can subscribe at the student rate.
      </p>
    );
  }

  const showDevBypass = import.meta.env.DEV && statusQuery.data?.devBypassAvailable === true;

  return (
    <div className={compact ? 'mt-2 space-y-2' : 'mt-3 space-y-3 rounded-md border border-white/10 bg-slate-900/40 p-3'}>
      <p className="text-xs text-r1-text-muted">
        Verify your student status with SheerID before checkout. Pricing includes 15 Standard and 4 Deep reports
        per month.
      </p>

      {statusQuery.data?.programId ? (
        <div id={formId} ref={formRef} className="min-h-[120px]" aria-label="SheerID student verification form" />
      ) : (
        <p className="text-xs text-amber-400">
          SheerID is not configured on this deployment.
          {showDevBypass ? ' Use dev verification below if enabled.' : ' Contact support if you believe this is an error.'}
        </p>
      )}

      {showDevBypass ? (
        <div className="space-y-2 border-t border-white/5 pt-2">
          <label className="block text-xs text-slate-400" htmlFor={`${formId}-dev-id`}>
            Dev verification id (prefix with <code className="text-slate-300">dev-</code> when backend bypass is on)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${formId}-dev-id`}
              type="text"
              className="min-w-[12rem] flex-1 rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-slate-200"
              value={devVerificationId}
              onChange={(e) => setDevVerificationId(e.target.value)}
              placeholder="dev-your-id"
            />
            <button
              type="button"
              className="rounded bg-slate-700 px-3 py-1 text-xs text-white hover:bg-slate-600 disabled:opacity-50"
              disabled={verifyMutation.isPending || !devVerificationId.trim()}
              onClick={() => verifyMutation.mutate(devVerificationId.trim())}
            >
              {verifyMutation.isPending ? 'Verifying…' : 'Submit verification'}
            </button>
          </div>
        </div>
      ) : null}

      {verifyMutation.isError ? (
        <p className="text-xs text-red-400">{extractApiError(verifyMutation.error)}</p>
      ) : null}
      {widgetError ? <p className="text-xs text-red-400">{widgetError}</p> : null}
    </div>
  );
}
