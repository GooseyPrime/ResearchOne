import axios from 'axios';
import { AlertCircle, RotateCcw, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { retryResearchRunFromFailure } from '../../utils/api';
import { formatFailureReason } from '../../utils/researchFailureFormat';
import { failureCardHeadline, isResumeAvailable, type LiveStatus } from '../../utils/researchLiveStatus';

export interface ResearchRunFailureSocketPayload {
  runId: string;
  stage: string;
  percent: number;
  message: string;
  error?: string;
  retryable?: boolean;
  terminal?: boolean;
  failureMeta?: Record<string, unknown>;
}

export default function ResearchRunFailureCard({
  failure,
  derivedState,
  onRetried,
  onError,
  onInfo,
}: {
  failure: ResearchRunFailureSocketPayload;
  derivedState: LiveStatus;
  onRetried: (runId: string) => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}) {
  const fmeta = failure.failureMeta ?? {};
  const role = typeof fmeta.role === 'string' ? fmeta.role : undefined;
  const model = typeof fmeta.model === 'string' ? fmeta.model : undefined;
  const upstream = typeof fmeta.upstream === 'string' ? fmeta.upstream : undefined;
  const classification = typeof fmeta.classification === 'string' ? fmeta.classification : undefined;
  const retryAttempts = typeof fmeta.retryAttempts === 'number' ? fmeta.retryAttempts : undefined;
  const retryBudget = typeof fmeta.retryBudget === 'number' ? fmeta.retryBudget : undefined;
  const attemptsRemaining =
    typeof fmeta.attemptsRemaining === 'number' ? fmeta.attemptsRemaining : undefined;
  const abortReason = typeof fmeta.abortReason === 'string' ? fmeta.abortReason : undefined;

  const isTerminal = derivedState === 'aborted';
  const showResume = isResumeAvailable(derivedState);

  const tone = isTerminal ? 'red' : 'amber';
  const headlineClass = isTerminal ? 'text-red-300' : 'text-amber-300';
  const containerClass = isTerminal
    ? 'border-red-700/40 bg-red-950/30'
    : 'border-amber-700/40 bg-amber-950/30';

  const reason = formatFailureReason(failure.error || failure.message, fmeta);
  const headline = failureCardHeadline(derivedState) ?? 'Run encountered an error.';

  const guidance: string[] = [];
  if (isTerminal) {
    if (abortReason === 'auth_error') {
      guidance.push(
        'The upstream rejected the call as unauthenticated. The server-side OPENROUTER_API_KEY / HF_TOKEN may be missing or expired — contact the operator.'
      );
    } else if (abortReason === 'invalid_request') {
      guidance.push(
        'The orchestrator classified this request as malformed. Inspect the query / supplemental files and start a new run.'
      );
    } else if (abortReason === 'budget_exhausted') {
      guidance.push(
        `The retry budget (${retryBudget ?? 3}) is exhausted. Start a new run with the same query if you want to try again.`
      );
    } else {
      guidance.push(
        'The orchestrator marked this failure non-recoverable. Start a new run with the same query if you want to try again.'
      );
    }
  } else if (showResume) {
    guidance.push(
      'Click "Resume from last failure" to re-queue this run from the saved checkpoint with the same models, ensemble, and supplemental context.'
    );
    if (typeof retryAttempts === 'number' && typeof retryBudget === 'number') {
      guidance.push(`Retries used so far: ${retryAttempts} of ${retryBudget}.`);
    }
  }
  if (classification === 'provider_unavailable' && upstream === 'huggingface_inference') {
    guidance.push(
      'The Hugging Face Inference Provider for this exact repo was temporarily unavailable. If this keeps happening, switch the role to a different model in the per-run model panel above.'
    );
  }
  if (classification === 'auth_error') {
    guidance.push(
      'The upstream rejected the call as unauthenticated. The server-side OPENROUTER_API_KEY / HF_TOKEN may be missing or expired — contact the operator.'
    );
  }
  if (classification === 'rate_limited') {
    guidance.push('You are being rate-limited by the upstream provider. Wait briefly before resuming.');
  }

  return (
    <div className={clsx('border rounded-lg p-4 space-y-2', containerClass)}>
      <div className="flex items-center gap-2">
        {isTerminal ? (
          <XCircle size={16} className="text-red-400" />
        ) : (
          <AlertCircle size={16} className="text-amber-400" />
        )}
        <p className={clsx('text-sm font-medium', headlineClass)}>{headline}</p>
      </div>

      <div className={clsx('text-xs space-y-1', tone === 'red' ? 'text-red-200' : 'text-amber-200')}>
        <p>
          <span className="text-slate-400">Stage:</span> {failure.stage || 'unknown'}
          {role ? (
            <span>
              {' '}
              · <span className="text-slate-400">Role:</span> {role}
            </span>
          ) : null}
          {model ? (
            <span>
              {' '}
              · <span className="text-slate-400">Model:</span> {model}
            </span>
          ) : null}
          {upstream ? (
            <span>
              {' '}
              · <span className="text-slate-400">Upstream:</span> {upstream}
            </span>
          ) : null}
          {classification ? (
            <span>
              {' '}
              · <span className="text-slate-400">Class:</span> {classification}
            </span>
          ) : null}
        </p>
        <p className="opacity-90">{reason}</p>
        {typeof retryAttempts === 'number' && typeof retryBudget === 'number' && (
          <p className="text-slate-400">
            Retries used: <span className="text-slate-300">{retryAttempts}</span> of{' '}
            <span className="text-slate-300">{retryBudget}</span>
            {typeof attemptsRemaining === 'number' && attemptsRemaining > 0 ? (
              isTerminal ? (
                <span>
                  {' '}
                  ·{' '}
                  <span className="text-slate-500">
                    {attemptsRemaining} unused (budget locked: {abortReason ?? 'non-recoverable'})
                  </span>
                </span>
              ) : (
                <span>
                  {' '}
                  · <span className="text-slate-300">{attemptsRemaining}</span> remaining
                </span>
              )
            ) : null}
          </p>
        )}
      </div>

      {guidance.length > 0 && (
        <ul className="text-xs space-y-1 text-slate-300 pl-4 list-disc">
          {guidance.map((g, idx) => (
            <li key={idx}>{g}</li>
          ))}
        </ul>
      )}

      {showResume && (
        <button
          type="button"
          className="btn-ghost text-xs mt-1"
          onClick={async () => {
            if (!failure.runId) return;
            try {
              const result = await retryResearchRunFromFailure(failure.runId);
              onRetried(failure.runId);
              if (typeof result?.attemptsRemaining === 'number') {
                onInfo(
                  `${result.attemptsRemaining} ${
                    result.attemptsRemaining === 1 ? 'retry' : 'retries'
                  } remaining after this attempt.`
                );
              }
            } catch (err) {
              if (axios.isAxiosError(err)) {
                const d = err.response?.data as
                  | { error?: string; reason?: string; hint?: string; terminal?: boolean }
                  | undefined;
                const detail = [d?.error, d?.reason, d?.hint].filter(Boolean).join(' — ');
                onError(detail || err.message || 'Failed to queue retry');
              } else {
                onError(err instanceof Error ? err.message : 'Failed to queue retry');
              }
            }
          }}
        >
          <RotateCcw size={12} />
          Resume from last failure
        </button>
      )}
    </div>
  );
}
