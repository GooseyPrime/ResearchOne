/**
 * Socket.IO room names. Every real-time event that carries user data is sent
 * to one of these rooms — never to all connected sockets.
 *
 *  - `user:<clerkUserId>`      joined by the server when the connection is
 *                              authenticated; holds only that user's sockets.
 *  - `job:<id>`                a research run, ingestion job or report; joined
 *                              only after an ownership check.
 *  - `job:revision:<reportId>` report revision progress; same check.
 */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function jobRoom(id: string): string {
  return `job:${id}`;
}

export function revisionRoom(reportId: string): string {
  return `job:revision:${reportId}`;
}
