import { Link } from 'react-router-dom';
import { GitBranch, PencilLine } from 'lucide-react';
import clsx from 'clsx';

type Props = {
  reportId: string;
  onEditInPlace?: () => void;
  editDisabled?: boolean;
  className?: string;
};

export default function ReportForkActions({ reportId, onEditInPlace, editDisabled, className }: Props) {
  return (
    <div
      className={clsx(
        'rounded-lg border border-indigo-900/30 bg-surface-200/60 p-4 space-y-3 print:hidden',
        className,
      )}
    >
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Continue this report</h2>
        <p className="text-xs text-slate-500 mt-1">
          Edit in place rewrites sections of this report. A spinoff starts a new research run that inherits context
          but produces a separate dossier.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {onEditInPlace ? (
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 text-sm"
            onClick={onEditInPlace}
            disabled={editDisabled}
          >
            <PencilLine size={14} />
            Edit in place
          </button>
        ) : null}
        <Link
          to={`/app/reports/${reportId}/spinoff`}
          className="btn-primary inline-flex items-center gap-2 text-sm"
        >
          <GitBranch size={14} />
          New research spinoff
        </Link>
      </div>
    </div>
  );
}
