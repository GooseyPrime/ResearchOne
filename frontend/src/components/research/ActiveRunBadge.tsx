import { useStore } from '../../store/useStore';
import { Activity } from 'lucide-react';

export default function ActiveRunBadge() {
  const { activeRun } = useStore();

  if (!activeRun) return null;

  return (
    <div className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-full px-3 py-1">
      <Activity size={12} className="text-accent animate-pulse" />
      <span className="text-xs text-accent font-medium truncate max-w-32">
        {activeRun.stage}: {activeRun.percent}%
      </span>
    </div>
  );
}
