import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import WalletAdjustment from './WalletAdjustment';
import TierOverride from './TierOverride';

interface UserDetail {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
  tier?: string;
  balance_cents?: number;
  current_period_reports_used?: number;
  lifetime_reports_used?: number;
}

export default function UserLookup() {
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const searchQuery = useQuery({
    queryKey: ['admin-user-search', search],
    queryFn: async () => (await api.get<{ users: UserDetail[] }>(`/admin/users?email=${encodeURIComponent(search)}`)).data.users,
    enabled: search.length >= 3,
  });

  const detailQuery = useQuery({
    queryKey: ['admin-user-detail', selectedUserId],
    queryFn: async () => (await api.get<UserDetail>(`/admin/users/${selectedUserId}`)).data,
    enabled: !!selectedUserId,
  });

  const user = detailQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email..."
          className="flex-1 rounded bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
        />
      </div>

      {searchQuery.data && searchQuery.data.length > 0 && (
        <ul className="rounded border border-white/10 divide-y divide-white/5">
          {searchQuery.data.map((u) => (
            <li
              key={u.id}
              onClick={() => setSelectedUserId(u.id)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-slate-800 flex justify-between"
            >
              <span>{u.email ?? u.id}</span>
              <span className="text-slate-500 text-xs">{u.id.slice(0, 12)}...</span>
            </li>
          ))}
        </ul>
      )}

      {user && (
        <div className="space-y-4 rounded-lg border border-white/10 bg-slate-900/50 p-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-slate-400">Name:</span> {user.first_name} {user.last_name}</div>
            <div><span className="text-slate-400">Email:</span> {user.email}</div>
            <div><span className="text-slate-400">Tier:</span> <span className="font-mono">{user.tier ?? 'free_demo'}</span></div>
            <div><span className="text-slate-400">Balance:</span> ${((user.balance_cents ?? 0) / 100).toFixed(2)}</div>
            <div><span className="text-slate-400">Reports (period):</span> {user.current_period_reports_used ?? 0}</div>
            <div><span className="text-slate-400">Reports (lifetime):</span> {user.lifetime_reports_used ?? 0}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <WalletAdjustment key={`wa-${user.id}`} userId={user.id} />
            <TierOverride key={`to-${user.id}`} userId={user.id} currentTier={user.tier ?? 'free_demo'} />
          </div>
        </div>
      )}
    </div>
  );
}
