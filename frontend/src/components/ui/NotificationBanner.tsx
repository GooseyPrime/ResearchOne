import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import {
  listUserNotificationsApi,
  markNotificationReadApi,
  type UserNotificationRow,
} from '../../utils/api';

const POLL_INTERVAL_MS = 60_000;

/**
 * In-app notification banner. Reads from GET /api/notifications and surfaces
 * any unread notifications (most-recent-first). Currently styled for
 * payment_failed; subscription_canceled and system kinds use the same banner
 * with the supplied title/body/cta_path.
 *
 * Per Rule 10: this banner is the canonical reader for user_notifications.
 * Backend writers go through createUserNotification().
 */
export default function NotificationBanner() {
  const { isLoaded, isSignedIn } = useAuth();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['user-notifications'],
    queryFn: () => listUserNotificationsApi(),
    enabled: Boolean(isLoaded && isSignedIn),
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
    staleTime: 30_000,
  });

  const markReadMut = useMutation({
    mutationFn: (id: string) => markNotificationReadApi(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-notifications'] });
    },
  });

  const unread: UserNotificationRow[] = (data?.notifications ?? []).filter(
    (n) => !n.read_at
  );

  if (unread.length === 0) return null;

  // Show only the most recent unread notification at a time to avoid stacking.
  const top = unread[0];

  return (
    <div className="border-b border-red-700/40 bg-red-950/40 px-4 py-2">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 text-red-200">
          <AlertTriangle size={16} className="shrink-0" />
          <div>
            <span className="font-medium">{top.title}</span>
            {top.body ? <span className="ml-2 text-red-300/80">{top.body}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {top.cta_path ? (
            <Link
              to={top.cta_path}
              className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
              onClick={() => markReadMut.mutate(top.id)}
            >
              {top.kind === 'payment_failed' ? 'Update payment method' : 'Open'}
            </Link>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss notification"
            className="rounded p-1 text-red-200 hover:bg-red-900/40"
            onClick={() => markReadMut.mutate(top.id)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
