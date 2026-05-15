import clsx from 'clsx';

const RUN_STATUS_STYLES: Record<string, string> = {
  completed: 'text-green-400 bg-green-900/20 border-green-800/30',
  failed: 'text-red-400 bg-red-900/20 border-red-800/30',
  running: 'text-accent bg-accent/10 border-accent/30',
  queued: 'text-amber-400 bg-amber-900/20 border-amber-800/30',
  cancelled: 'text-slate-400 bg-slate-800/30 border-slate-700/30',
};

export default function DossierStatusBadge({ status }: { status: string }) {
  const cls = RUN_STATUS_STYLES[status] ?? 'text-slate-300 bg-slate-900/30 border-slate-700/30';
  return <span className={clsx('badge border text-[10px]', cls)}>{status}</span>;
}
