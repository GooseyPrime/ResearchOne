import type { Server as SocketIOServer } from 'socket.io';
import { adminQuery } from '../db/pool';
import { logger } from '../utils/logger';
import { jobRoom, revisionRoom, userRoom } from './rooms';

/** Looks up which user an object belongs to (replaced in tests). */
export interface OwnerLookups {
  runOwner(runId: string): Promise<string | null>;
  ingestionJobOwner(jobId: string): Promise<string | null>;
  reportOwner(reportId: string): Promise<string | null>;
  atlasExportOwner(exportId: string): Promise<string | null>;
  /** Every user who added this library source (a source can be added by several). */
  sourceOwners(sourceId: string): Promise<string[]>;
}

async function ownerFrom(table: string, id: string): Promise<string | null> {
  const rows = await adminQuery<{ user_id: string | null }>(
    `SELECT user_id FROM ${table} WHERE id::text = $1 LIMIT 1`,
    [id],
  );
  return rows[0]?.user_id ?? null;
}

export const defaultOwnerLookups: OwnerLookups = {
  runOwner: (id) => ownerFrom('research_runs', id),
  ingestionJobOwner: (id) => ownerFrom('ingestion_jobs', id),
  reportOwner: (id) => ownerFrom('reports', id),
  atlasExportOwner: (id) => ownerFrom('atlas_exports', id),
  sourceOwners: async (sourceId) => {
    const rows = await adminQuery<{ user_id: string | null }>(
      `SELECT DISTINCT user_id FROM ingestion_jobs WHERE source_id::text = $1 AND user_id IS NOT NULL`,
      [sourceId],
    );
    return rows.map((r) => r.user_id).filter((id): id is string => Boolean(id));
  },
};

const OWNER_CACHE_LIMIT = 2000;

/**
 * The only way server code sends real-time events. Each method delivers to the
 * object's own room (joined after an ownership check) and to the owner's user
 * room. There is deliberately no method that sends to every connected socket.
 */
export interface PrivateEmitter {
  toUser(userId: string | null | undefined, event: string, data: unknown): void;
  toRun(runId: string, event: string, data: unknown): Promise<void>;
  toIngestionJob(jobId: string, event: string, data: unknown): Promise<void>;
  toReport(reportId: string, event: string, data: unknown): Promise<void>;
  /** Revision progress: the report's revision room, its job room and its owner. */
  toReportRevision(reportId: string, event: string, data: unknown): Promise<void>;
  /** A change notice (no object room) for whoever owns the run / report / job. */
  notifyRunOwner(runId: string, event: string, data: unknown): Promise<void>;
  notifyReportOwner(reportId: string, event: string, data: unknown): Promise<void>;
  notifyIngestionJobOwner(jobId: string, event: string, data: unknown): Promise<void>;
  notifyAtlasExportOwner(exportId: string, event: string, data: unknown): Promise<void>;
  notifySourceOwners(sourceId: string, event: string, data: unknown): Promise<void>;
}

export function createPrivateEmitter(
  io: SocketIOServer | undefined,
  lookups: OwnerLookups = defaultOwnerLookups,
): PrivateEmitter {
  const cache = new Map<string, string>();

  const owner = async (
    kind: 'run' | 'ingestion' | 'report' | 'atlas',
    id: string,
    lookup: (id: string) => Promise<string | null>,
  ): Promise<string | null> => {
    const key = `${kind}:${id}`;
    const hit = cache.get(key);
    if (hit) return hit;
    try {
      const found = await lookup(id);
      if (found) {
        if (cache.size >= OWNER_CACHE_LIMIT) cache.clear();
        cache.set(key, found);
      }
      return found;
    } catch (err) {
      // Unknown owner: the event still reaches the object's own room, which
      // only checked subscribers are in. It is never widened.
      logger.warn('realtime_owner_lookup_failed', {
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  const send = (rooms: string[], event: string, data: unknown): void => {
    if (!io || rooms.length === 0) return;
    io.to(rooms).emit(event, data);
  };

  // Deliveries are queued so events leave in the order they were raised even
  // though the owner lookup is asynchronous.
  let tail: Promise<void> = Promise.resolve();
  const inOrder = (work: () => Promise<void>): Promise<void> => {
    tail = tail.then(work, work);
    return tail;
  };

  const withOwner = (rooms: string[], ownerId: string | null): string[] =>
    ownerId ? [...rooms, userRoom(ownerId)] : rooms;

  return {
    toUser(userId, event, data) {
      if (!userId) return;
      void inOrder(async () => send([userRoom(userId)], event, data));
    },
    toRun(runId, event, data) {
      return inOrder(async () => {
        send(withOwner([jobRoom(runId)], await owner('run', runId, lookups.runOwner)), event, data);
      });
    },
    toIngestionJob(jobId, event, data) {
      return inOrder(async () => {
        send(
          withOwner([jobRoom(jobId)], await owner('ingestion', jobId, lookups.ingestionJobOwner)),
          event,
          data,
        );
      });
    },
    toReport(reportId, event, data) {
      return inOrder(async () => {
        send(
          withOwner([jobRoom(reportId)], await owner('report', reportId, lookups.reportOwner)),
          event,
          data,
        );
      });
    },
    toReportRevision(reportId, event, data) {
      return inOrder(async () => {
        send(
          withOwner(
            [revisionRoom(reportId), jobRoom(reportId)],
            await owner('report', reportId, lookups.reportOwner),
          ),
          event,
          data,
        );
      });
    },
    notifyRunOwner(runId, event, data) {
      return inOrder(async () => {
        send(withOwner([], await owner('run', runId, lookups.runOwner)), event, data);
      });
    },
    notifyReportOwner(reportId, event, data) {
      return inOrder(async () => {
        send(withOwner([], await owner('report', reportId, lookups.reportOwner)), event, data);
      });
    },
    notifyIngestionJobOwner(jobId, event, data) {
      return inOrder(async () => {
        send(
          withOwner([], await owner('ingestion', jobId, lookups.ingestionJobOwner)),
          event,
          data,
        );
      });
    },
    notifyAtlasExportOwner(exportId, event, data) {
      return inOrder(async () => {
        send(withOwner([], await owner('atlas', exportId, lookups.atlasExportOwner)), event, data);
      });
    },
    notifySourceOwners(sourceId, event, data) {
      return inOrder(async () => {
        let owners: string[] = [];
        try {
          owners = await lookups.sourceOwners(sourceId);
        } catch (err) {
          logger.warn('realtime_owner_lookup_failed', {
            kind: 'source',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        send(owners.map(userRoom), event, data);
      });
    },
  };
}
