import { io, Socket } from 'socket.io-client';
import { setSocketHealthProvider } from './apiRateLimit';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      withCredentials: false,
    });
    // Register the connection-state provider so polling hooks can back off
    // when live events are flowing (WO-AE-4 / getAdaptiveRefetchIntervalMs).
    setSocketHealthProvider(() => socket?.connected ?? false);
  }
  return socket;
}

export function subscribeToJob(jobId: string) {
  getSocket().emit('subscribe:job', jobId);
}

/**
 * Report revision progress/completion (`job:revision:<reportId>` only).
 * Use `subscribeToJob(reportId)` separately if you need the generic `job:${reportId}` room.
 */
export function subscribeToRevisionJob(reportId: string) {
  getSocket().emit('subscribe:revision', reportId);
}

export function subscribeToCorpus() {
  getSocket().emit('subscribe:corpus');
}
