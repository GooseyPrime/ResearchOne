import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';

export default function AuditLogViewer() {
  const [userId, setUserId] = useState('');
  const [eventType, setEventType] = useState('');

  const auditQuery = useQuery({
    queryKey: ['admin-audit', userId, eventType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (userId) params.set('user_id', userId);
      if (eventType) params.set('event_type', eventType);
      params.set('limit', '50');
      return (await api.get(`/admin/audit-log?${params}`)).data as {
        entries: Array<{ id: number; admin_user_id: string; target_user_id: string; action: string; reason: string; created_at: string }>;
      };
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Audit Log</h2>
      <div className="flex gap-2">
        <input type="text" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Filter by user ID..."
          className="flex-1 rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white" />
        <input type="text" value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="Filter by action..."
          className="flex-1 rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white" />
      </div>

      {auditQuery.data?.entries && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-white/10">
              <th className="py-2">Time</th>
              <th>Admin</th>
              <th>Target</th>
              <th>Action</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {auditQuery.data.entries.map((row) => (
              <tr key={row.id} className="border-b border-white/5 text-xs">
                <td className="py-1">{new Date(row.created_at).toLocaleString()}</td>
                <td className="font-mono">{row.admin_user_id?.slice(0, 10)}</td>
                <td className="font-mono">{row.target_user_id?.slice(0, 10)}</td>
                <td>{row.action}</td>
                <td className="text-slate-400">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
