import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../utils/api';

/**
 * Look up a research run by the reference a user quotes.
 *
 * References are assigned to every run INCLUDING failures, which is the point:
 * a user writing in about a run that failed still has an identifier, and that
 * is precisely when support needs one.
 */

interface RunLookupResult {
  id: string;
  run_ref: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  user_id: string | null;
  user_email: string | null;
  org_id: string | null;
  engine_version: string | null;
  research_objective: string | null;
  failure_reason: string | null;
  spinoff_from_run_id: string | null;
  report_id: string | null;
  report_status: string | null;
}

interface LookupError {
  error: string;
  reason?: 'empty' | 'malformed' | 'check_failed';
}

const STATUS_TONE: Record<string, string> = {
  completed: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  completed_degraded: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  failed: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  contract_failed: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  verification_failed: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  cancelled: 'text-slate-300 border-slate-500/40 bg-slate-500/10',
};

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <span className="text-slate-400">{label}:</span>{' '}
      <span className={mono ? 'font-mono text-xs' : undefined}>{value ?? '—'}</span>
    </div>
  );
}

export default function RunLookup() {
  const [ref, setRef] = useState('');

  const lookup = useMutation<RunLookupResult, { response?: { data?: LookupError } }, string>({
    mutationFn: async (value: string) =>
      (await api.get<{ run: RunLookupResult }>(`/admin/runs/lookup?ref=${encodeURIComponent(value)}`)).data.run,
  });

  const errorBody = lookup.error?.response?.data;
  const run = lookup.data;

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ref.trim()) lookup.mutate(ref.trim());
        }}
      >
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="R1-20260818-0042-7K3M9-4"
          spellCheck={false}
          className="flex-1 rounded bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white font-mono"
        />
        <button
          type="submit"
          disabled={!ref.trim() || lookup.isPending}
          className="rounded bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {lookup.isPending ? 'Looking up…' : 'Look up'}
        </button>
      </form>

      <p className="text-xs text-slate-500">
        Case, spacing and dashes are ignored. Every run has a reference, including
        runs that failed.
      </p>

      {errorBody && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {errorBody.error}
          {errorBody.reason === 'check_failed' && (
            <span className="block text-xs text-amber-300/80 mt-1">
              The reference is self-checking, so this is a transcription error rather
              than a missing run. Ask for it to be pasted rather than retyped.
            </span>
          )}
        </div>
      )}

      {run && (
        <div className="space-y-4 rounded-lg border border-white/10 bg-slate-900/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-sm text-white">{run.run_ref}</span>
            <span
              className={`rounded border px-2 py-0.5 text-xs ${
                STATUS_TONE[run.status] ?? 'text-slate-300 border-slate-500/40 bg-slate-500/10'
              }`}
            >
              {run.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Title" value={run.title} />
            <Field label="Created" value={new Date(run.created_at).toLocaleString()} />
            <Field label="User" value={run.user_email ?? run.user_id} />
            <Field label="Org" value={run.org_id} mono />
            <Field label="Engine" value={run.engine_version} />
            <Field label="Objective" value={run.research_objective} />
            <Field label="Run ID" value={run.id} mono />
            <Field label="Report" value={run.report_id} mono />
          </div>

          {run.failure_reason && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              <span className="text-rose-300/80 text-xs block mb-1">Failure reason</span>
              {run.failure_reason}
            </div>
          )}

          {run.spinoff_from_run_id && (
            <div className="text-xs text-slate-400">
              Spun off from run <span className="font-mono">{run.spinoff_from_run_id}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
