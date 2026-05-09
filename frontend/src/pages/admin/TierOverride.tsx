import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractApiError } from '../../utils/api';

const TIERS = ['anonymous', 'free_demo', 'student', 'wallet', 'pro', 'team', 'byok', 'sovereign', 'admin'];

export default function TierOverride({ userId, currentTier }: { userId: string; currentTier: string }) {
  const queryClient = useQueryClient();
  const [tier, setTier] = useState(currentTier);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post(`/admin/users/${userId}/tier-override`, { tier, reason });
    },
    onSuccess: () => {
      setSuccess(`Tier set to ${tier}`);
      setError(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
    },
    onError: (err: unknown) => { setError(extractApiError(err)); setSuccess(null); },
  });

  return (
    <div className="rounded border border-white/10 p-3 space-y-2">
      <h4 className="text-sm font-medium">Tier Override</h4>
      <select value={tier} onChange={(e) => setTier(e.target.value)}
        className="w-full rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white">
        {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
        className="w-full rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white" />
      <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !reason || tier === currentTier}
        className="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1 text-sm text-white">
        {mutation.isPending ? 'Applying...' : 'Override Tier'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}
    </div>
  );
}
