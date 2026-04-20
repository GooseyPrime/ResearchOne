import { useStore } from '../../store/useStore';
import { Activity, AlertTriangle } from 'lucide-react';

function stageLabel(stage?: string): string {
  if (!stage) return 'running';
  return stage.replace(/_/g, ' ');
}

export default function ActiveRunBadge() {
  const { activeRun } = useStore();

  if (!activeRun) return null;

  const isWarning = activeRun.eventType === 'run_failed' || activeRun.stage === 'failed';

  return (
    <div className={isWarning
      ? 'flex items-center gap-2 bg-amber-900/20 border border-amber-700/40 rounded-full px-3 py-1'
      : 'flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-full px-3 py-1'}>
      {isWarning ? (
        <AlertTriangle size={12} className='text-amber-400' />
      ) : (
        <Activity size={12} className='text-accent animate-pulse' />
      )}
      <span className={isWarning ? 'text-xs text-amber-300 font-medium truncate max-w-48' : 'text-xs text-accent font-medium truncate max-w-48'}>
        {stageLabel(activeRun.stage)}: {Math.max(0, Math.round(activeRun.percent ?? 0))}%
      </span>
    </div>
  );
}
