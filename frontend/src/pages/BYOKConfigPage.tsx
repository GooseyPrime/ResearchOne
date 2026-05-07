import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractApiError } from '../utils/api';

type BYOKProvider = 'openrouter' | 'anthropic' | 'openai' | 'google';

const PROVIDERS: { value: BYOKProvider; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
];

interface KeyStatusResponse {
  has_key: boolean;
  key_last_four: string | null;
  key_status: string | null;
  provider: string;
  key_validated_at: string | null;
}

export default function BYOKConfigPage() {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<BYOKProvider>('openrouter');
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['byok-status', provider],
    queryFn: async () => (await api.get<KeyStatusResponse>(`/byok/keys/status?provider=${provider}`)).data,
  });

  const storeMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ stored: boolean; key_last_four: string }>('/byok/keys', {
        key: keyInput,
        provider,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setKeyInput('');
      setError(null);
      setSuccess(`Key stored (****${data.key_last_four})`);
      void queryClient.invalidateQueries({ queryKey: ['byok-status', provider] });
    },
    onError: (err: unknown) => {
      setSuccess(null);
      setError(extractApiError(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/byok/keys?provider=${provider}`);
    },
    onSuccess: () => {
      setError(null);
      setSuccess('Key deleted');
      void queryClient.invalidateQueries({ queryKey: ['byok-status', provider] });
    },
    onError: (err: unknown) => {
      setSuccess(null);
      setError(extractApiError(err));
    },
  });

  const status = statusQuery.data;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">BYOK Key Management</h1>
      <p className="text-sm text-slate-400">
        Bring Your Own Keys — supply your own API keys to route research runs through your account.
      </p>

      <section className="rounded-lg border border-white/10 bg-slate-900/50 p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Provider</label>
          <select
            value={provider}
            onChange={(e) => { setProvider(e.target.value as BYOKProvider); setError(null); setSuccess(null); }}
            className="w-full rounded bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {status?.has_key && (
          <div className="rounded bg-slate-800/50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-slate-300">Current key: </span>
                <span className="font-mono text-white">****{status.key_last_four}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${status.key_status === 'valid' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
                  {status.key_status}
                </span>
              </div>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
            {status.key_validated_at && (
              <p className="mt-1 text-xs text-slate-500">
                Validated: {new Date(status.key_validated_at).toLocaleDateString()}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            {status?.has_key ? 'Replace key' : 'API Key'}
          </label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={`Enter your ${PROVIDERS.find((p) => p.value === provider)?.label} API key`}
            className="w-full rounded bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
        </div>

        <button
          onClick={() => storeMutation.mutate()}
          disabled={storeMutation.isPending || !keyInput.trim()}
          className="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 px-4 py-2 text-sm font-medium text-white transition"
        >
          {storeMutation.isPending ? 'Validating & storing...' : 'Validate & Store Key'}
        </button>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-emerald-400">{success}</p>}
      </section>

      <section className="rounded-lg border border-white/10 bg-slate-900/30 p-4 text-sm text-slate-400">
        <h3 className="font-medium text-slate-300 mb-2">How it works</h3>
        <ul className="space-y-1 list-disc list-inside">
          <li>Your key is validated against the provider's API before storage.</li>
          <li>Keys are encrypted at rest using AES-256-GCM.</li>
          <li>The plaintext key is never logged or returned in API responses.</li>
          <li>When you run research, your key is used instead of the platform key.</li>
          <li>Delete your key at any time to revert to platform routing.</li>
        </ul>
      </section>
    </div>
  );
}
