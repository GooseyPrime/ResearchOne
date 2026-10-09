import type { Server as SocketIOServer } from 'socket.io';
import { rlsStore } from '../db/pool';
import { logger } from '../utils/logger';
import { userRoom } from './rooms';

interface RoomEmitter {
  emit(event: string, data: unknown): boolean;
}

/**
 * What HTTP route handlers get from `req.app.get('io')`.
 *
 * It looks like the Socket.IO server but cannot reach every connected page:
 *  - `to(room).emit(...)` delivers to that room, whose members were checked
 *    when they joined (see socketAccess.ts);
 *  - `emit(...)` — a global broadcast on the real server — is delivered only
 *    to the signed-in user who made the current request. With no signed-in
 *    request in scope it is dropped.
 */
export class RouteIo {
  constructor(private readonly io: SocketIOServer) {}

  to(room: string | string[]): RoomEmitter {
    return this.io.to(room);
  }

  in(room: string | string[]): RoomEmitter {
    return this.io.to(room);
  }

  emit(event: string, data: unknown): boolean {
    const userId = rlsStore.getStore()?.userId ?? null;
    if (!userId) {
      logger.warn('realtime_unaddressed_event_dropped', { event });
      return false;
    }
    return this.io.to(userRoom(userId)).emit(event, data);
  }
}

/**
 * Routes are typed against the Socket.IO server; this is the one place the
 * restricted stand-in is handed to them under that type.
 */
export function createRouteIo(io: SocketIOServer): SocketIOServer {
  return new RouteIo(io) as unknown as SocketIOServer;
}
