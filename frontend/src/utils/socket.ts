import { io, Socket } from 'socket.io-client';
import { setSocketHealthProvider } from './apiRateLimit';
import { getClerkJwtForApi } from './clerkSession';

let socket: Socket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Rooms this page asked for, re-requested after every (re)connect. */
const wantedJobs = new Set<string>();
const wantedRevisions = new Set<string>();

/** How often an open connection proves its session is still valid. */
const SESSION_REFRESH_MS = 30000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const AUTH_RETRY_MS = 2000;
const AUTH_RETRY_MAX_MS = 30000;
let refusedAttempts = 0;

export function getSocket(): Socket {
  if (!socket) {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const created = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      withCredentials: false,
      // The server accepts signed-in users only. A fresh session token is
      // fetched for every connection attempt (tokens are short-lived).
      auth: (cb) => {
        void getClerkJwtForApi().then((token) => cb({ token: token ?? '' }));
      },
    });
    created.on('connect', () => {
      refusedAttempts = 0;
      for (const id of wantedJobs) created.emit('subscribe:job', id);
      for (const id of wantedRevisions) created.emit('subscribe:revision', id);
    });
    // A refused handshake (not signed in yet, or the session is still
    // loading) and a connection the server closed (its session ran out) are
    // not retried by the client on its own.
    const retryLater = () => {
      if (created.active || retryTimer !== null) return;
      const wait = Math.min(AUTH_RETRY_MS * 2 ** refusedAttempts, AUTH_RETRY_MAX_MS);
      refusedAttempts += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (socket === created && !created.connected) created.connect();
      }, wait);
    };
    created.on('connect_error', retryLater);
    created.on('disconnect', (reason: string) => {
      if (reason === 'io server disconnect') retryLater();
    });
    // The server keeps a connection only while its session is valid: send it
    // the current session token on a timer so it can tell.
    if (refreshTimer === null) {
      refreshTimer = setInterval(() => {
        if (!created.connected) return;
        void getClerkJwtForApi().then((token) => {
          if (token && created.connected) created.emit('auth:refresh', token);
        });
      }, SESSION_REFRESH_MS);
    }
    socket = created;
    // Register the connection-state provider so polling hooks can back off
    // when live events are flowing (WO-AE-4 / getAdaptiveRefetchIntervalMs).
    setSocketHealthProvider(() => socket?.connected ?? false);
  }
  return socket;
}

/**
 * Reconnect under the current session. Called when the signed-in user
 * changes so one browser tab never keeps another account's connection.
 */
export function reconnectSocketForSessionChange(): void {
  wantedJobs.clear();
  wantedRevisions.clear();
  refusedAttempts = 0;
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

export function subscribeToJob(jobId: string) {
  wantedJobs.add(jobId);
  const s = getSocket();
  if (s.connected) s.emit('subscribe:job', jobId);
}

/**
 * Report revision progress/completion (`job:revision:<reportId>` only).
 * Use `subscribeToJob(reportId)` separately if you need the generic `job:${reportId}` room.
 */
export function subscribeToRevisionJob(reportId: string) {
  wantedRevisions.add(reportId);
  const s = getSocket();
  if (s.connected) s.emit('subscribe:revision', reportId);
}

export function subscribeToCorpus() {
  // Library updates arrive on the signed-in user's own channel, which the
  // server joins at connect time; opening the connection is all that is needed.
  getSocket();
}
