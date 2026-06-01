import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Paperclip } from 'lucide-react';
import type { RevisionAttachmentAudit } from '@/utils/api';

function statusTone(status: string | undefined, failedValues: string[]): string {
  if (!status) return 'text-slate-400';
  if (failedValues.includes(status)) return 'text-amber-300';
  if (status === 'success' || status === 'completed' || status === 'included' || status === 'ok') {
    return 'text-green-400';
  }
  return 'text-slate-300';
}

function labelForAttachment(a: RevisionAttachmentAudit): string {
  if (a.kind === 'url') return a.url ?? 'URL';
  return a.filename ?? 'File';
}

export default function RevisionAttachmentAuditPanel({
  attachments,
  className,
}: {
  attachments: RevisionAttachmentAudit[];
  className?: string;
}) {
  if (!attachments.length) return null;

  const failed = attachments.filter(
    (a) =>
      a.fetch_status === 'failed' ||
      a.inline_status === 'failed' ||
      a.retrieval_status === 'failed',
  );

  return (
    <div
      className={clsx(
        'rounded-lg border p-4 space-y-3 text-xs',
        failed.length > 0 ? 'border-amber-800/40 bg-amber-950/20' : 'border-indigo-900/30 bg-surface-200/40',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {failed.length > 0 ? (
          <AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
        ) : (
          <CheckCircle2 size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
        )}
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Supplemental attachment audit</h3>
          <p className="text-slate-400 mt-0.5">
            {failed.length > 0
              ? `${failed.length} attachment${failed.length === 1 ? '' : 's'} failed fetch or ingest — revision continued without that content.`
              : 'All attachments were fetched and reviewed for this revision.'}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {attachments.map((a, i) => (
          <li
            key={`${a.ingestion_job_id}-${i}`}
            className="rounded-md border border-indigo-900/25 bg-surface-900/50 px-3 py-2 space-y-1"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Paperclip size={12} className="text-slate-500 flex-shrink-0" />
              <span className="text-slate-200 truncate" title={labelForAttachment(a)}>
                {labelForAttachment(a)}
              </span>
              <span className="text-[10px] uppercase text-slate-500 ml-auto flex-shrink-0">{a.kind}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
              <span className={statusTone(a.fetch_status, ['failed'])}>
                fetch: {a.fetch_status ?? '—'}
              </span>
              <span className={statusTone(a.ingestion_status, ['failed'])}>
                ingest: {a.ingestion_status ?? '—'}
              </span>
              <span className={statusTone(a.inline_status, ['failed', 'skipped'])}>
                inline: {a.inline_status ?? '—'}
              </span>
              <span className={statusTone(a.retrieval_status, ['failed'])}>
                retrieval: {a.retrieval_status ?? '—'}
              </span>
              {typeof a.extractedChars === 'number' ? (
                <span className="text-slate-500">{a.extractedChars.toLocaleString()} chars</span>
              ) : null}
            </div>
            {a.fetch_error ? (
              <p className="text-amber-200/90 whitespace-pre-wrap break-words">{a.fetch_error}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
