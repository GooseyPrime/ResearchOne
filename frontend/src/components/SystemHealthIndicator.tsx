import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
}

export default function SystemHealthIndicator() {
  const healthQuery = useQuery({
    queryKey: ['system-health'],
    queryFn: async () => (await api.get<HealthResponse>('/health/ready')).data,
    refetchInterval: 30000,
    retry: 1,
  });

  const status = healthQuery.data?.status ?? (healthQuery.isError ? 'down' : 'ok');
  const colors = { ok: 'bg-emerald-500', degraded: 'bg-yellow-500', down: 'bg-red-500' };
  const labels = { ok: 'System online', degraded: 'Degraded', down: 'System issues' };

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400">
      <span className={`h-2 w-2 rounded-full ${colors[status]}`} />
      <span>{labels[status]}</span>
    </div>
  );
}
