import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractApiError } from '../../utils/api';

export default function WalletAdjustment({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'credit' | 'debit'>('credit');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/admin/users/${userId}/wallet-adjust`, {
        amountCents: Math.round(parseFloat(amount) * 100),
        type,
        reason,
      });
      return res.data as { balanceCents: number };
    },
    onSuccess: (data) => {
      setSuccess(`Balance: $${(data.balanceCents / 100).toFixed(2)}`);
      setError(null);
      setAmount('');
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
    },
    onError: (err: unknown) => { setError(extractApiError(err)); setSuccess(null); },
  });

  return (
    <div className="rounded border border-white/10 p-3 space-y-2">
      <h4 className="text-sm font-medium">Wallet Adjustment</h4>
      <div className="flex gap-2">
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" step="0.01" min="0"
          className="w-24 rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white" />
        <select value={type} onChange={(e) => setType(e.target.value as 'credit' | 'debit')}
          className="rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white">
          <option value="credit">Credit</option>
          <option value="debit">Debit</option>
        </select>
      </div>
      <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
        className="w-full rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white" />
      <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !amount || !reason}
        className="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1 text-sm text-white">
        {mutation.isPending ? 'Applying...' : 'Apply'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}
    </div>
  );
}
