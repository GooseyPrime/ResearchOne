import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { Server as SocketIOServer } from 'socket.io';
import {
  attachSocketAccessControl,
  SESSION_GRACE_MS,
  SUBSCRIBE_LIMIT_PER_MINUTE,
  type SocketAccessDeps,
} from '../realtime/socketAccess';
import { createPrivateEmitter, type OwnerLookups } from '../realtime/privateEmit';
import { createRouteIo } from '../realtime/routeIo';
import { rlsStore } from '../db/pool';

/**
 * RJ-020 — real-time privacy.
 *
 * The production access control and emitter run against a small in-memory
 * stand-in for the Socket.IO server that implements the parts they use
 * (handshake middleware, connection handler, rooms, room-addressed emit and a
 * global emit). Token verification and ownership lookups are supplied by the
 * test, so no database or Clerk account is needed.
 */

const RUN_A = '11111111-1111-4111-8111-111111111111';
const REPORT_A = '22222222-2222-4222-8222-222222222222';
const INGEST_A = '33333333-3333-4333-8333-333333333333';
const EXPORT_A = '44444444-4444-4444-8444-444444444444';
const SOURCE_A = '55555555-5555-4555-8555-555555555555';

const TOKENS: Record<string, string> = {
  'token-a': 'user_a',
  'token-b': 'user_b',
  'token-admin': 'user_admin',
};

/** Session lifetime handed out with each token; undefined means the token states none. */
let tokenLifetimeMs: number | undefined;
let jobChecks = 0;

const deps: SocketAccessDeps = {
  verifySessionToken: async (token) => {
    const userId = TOKENS[token];
    if (!userId) return null;
    return {
      userId,
      orgId: null,
      expiresAtMs: tokenLifetimeMs === undefined ? undefined : Date.now() + tokenLifetimeMs,
    };
  },
  isAdmin: (userId) => userId === 'user_admin',
  canAccessJob: async (id, who) => {
    jobChecks += 1;
    return who.userId === 'user_a' && (id === RUN_A || id === REPORT_A || id === INGEST_A);
  },
  canAccessReport: async (id, who) => who.userId === 'user_a' && id === REPORT_A,
};

const lookups: OwnerLookups = {
  runOwner: async (id) => (id === RUN_A ? 'user_a' : null),
  ingestionJobOwner: async (id) => (id === INGEST_A ? 'user_a' : null),
  reportOwner: async (id) => (id === REPORT_A ? 'user_a' : null),
  atlasExportOwner: async (id) => (id === EXPORT_A ? 'user_a' : null),
  sourceOwners: async (id) => (id === SOURCE_A ? ['user_a'] : []),
};

type Listener = (...args: unknown[]) => void;
type Middleware = (socket: FakeSocket, next: (err?: Error) => void) => void;

class FakeSocket {
  readonly rooms = new Set<string>();
  readonly data: Record<string, unknown> = {};
  readonly handshake: { auth: Record<string, unknown>; headers: Record<string, string> };
  readonly received: Array<{ event: string; data: unknown }> = [];
  private readonly listeners = new Map<string, Listener>();
  connected = true;

  constructor(token: string | null) {
    this.handshake = { auth: token === null ? {} : { token }, headers: {} };
  }
  join(room: string): void {
    this.rooms.add(room);
  }
  on(event: string, listener: Listener): this {
    this.listeners.set(event, listener);
    return this;
  }
  disconnect(): void {
    this.connected = false;
  }
  /** What a browser page does: send an event to the server and await the ack. */
  send(event: string, id: string): Promise<{ ok: boolean }> {
    return new Promise((resolve) => this.listeners.get(event)?.(id, resolve));
  }
}

class FakeIo {
  readonly sockets: FakeSocket[] = [];
  private readonly middleware: Middleware[] = [];
  private onConnection: (socket: FakeSocket) => void = () => undefined;

  use(fn: Middleware): this {
    this.middleware.push(fn);
    return this;
  }
  on(_event: 'connection', handler: (socket: FakeSocket) => void): this {
    this.onConnection = handler;
    return this;
  }
  to(rooms: string | string[]): { emit: (event: string, data: unknown) => void } {
    const wanted = Array.isArray(rooms) ? rooms : [rooms];
    return {
      emit: (event, data) => {
        for (const s of this.sockets) {
          if (wanted.some((r) => s.rooms.has(r))) s.received.push({ event, data });
        }
      },
    };
  }
  /** A global broadcast — what the code must never use for user data. */
  emit(event: string, data: unknown): void {
    for (const s of this.sockets) s.received.push({ event, data });
  }
  members(room: string): FakeSocket[] {
    return this.sockets.filter((s) => s.rooms.has(room));
  }
  async connect(token: string | null): Promise<FakeSocket> {
    const socket = new FakeSocket(token);
    for (const fn of this.middleware) {
      await new Promise<void>((resolve, reject) =>
        fn(socket, (err) => (err ? reject(err) : resolve())),
      );
    }
    this.sockets.push(socket);
    this.onConnection(socket);
    return socket;
  }
}

let fake: FakeIo;
let io: SocketIOServer;

beforeEach(() => {
  tokenLifetimeMs = undefined;
  jobChecks = 0;
  fake = new FakeIo();
  io = fake as unknown as SocketIOServer;
  attachSocketAccessControl(io, deps);
});

const connect = (token: string | null): Promise<FakeSocket> => fake.connect(token);
const subscribe = (client: FakeSocket, event: string, id: string): Promise<{ ok: boolean }> =>
  client.send(event, id);
const record = (client: FakeSocket): Array<{ event: string; data: unknown }> => client.received;
/** Let queued deliveries finish. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const SECRET = { stage: 'retrieval', message: "user A's private research question" };

describe('socket connections require a signed-in session', () => {
  it('refuses a connection with no token', async () => {
    await expect(connect(null)).rejects.toThrow(/unauthorized/);
  });

  it('refuses a connection with an invalid token', async () => {
    await expect(connect('not-a-real-token')).rejects.toThrow(/unauthorized/);
  });

  it('accepts a valid session', async () => {
    const a = await connect('token-a');
    expect(a.connected).toBe(true);
    expect([...a.rooms]).toEqual(['user:user_a']);
  });
});

describe('room membership is checked on the server', () => {
  it("user B cannot join user A's run room", async () => {
    const b = await connect('token-b');
    expect(await subscribe(b, 'subscribe:job', RUN_A)).toEqual({ ok: false });
    expect(fake.members(`job:${RUN_A}`)).toHaveLength(0);
  });

  it("user B cannot join user A's revision room", async () => {
    const b = await connect('token-b');
    expect(await subscribe(b, 'subscribe:revision', REPORT_A)).toEqual({ ok: false });
    expect(fake.members(`job:revision:${REPORT_A}`)).toHaveLength(0);
  });

  it('the owner can join their own run room', async () => {
    const a = await connect('token-a');
    expect(await subscribe(a, 'subscribe:job', RUN_A)).toEqual({ ok: true });
    expect(fake.members(`job:${RUN_A}`)).toHaveLength(1);
  });

  it('an admin can join any run room', async () => {
    const admin = await connect('token-admin');
    expect(await subscribe(admin, 'subscribe:job', RUN_A)).toEqual({ ok: true });
  });

  it('rejects ids that are not well formed (no arbitrary room names)', async () => {
    const admin = await connect('token-admin');
    expect(await subscribe(admin, 'subscribe:job', 'revision:anything')).toEqual({ ok: false });
    expect(await subscribe(admin, 'subscribe:job', `user:user_a`)).toEqual({ ok: false });
  });

  it("a socket is only ever placed in its own user's room", async () => {
    await connect('token-b');
    const b = fake.sockets[0];
    expect(fake.members('user:user_a')).toHaveLength(0);
    expect([...(b?.rooms ?? [])]).toEqual(['user:user_b']);
  });
});

describe("user B never receives user A's events", () => {
  it('run progress, plan, completion and list notices reach A only', async () => {
    const a = await connect('token-a');
    const b = await connect('token-b');
    // B tries everything a page can do to listen in.
    await subscribe(b, 'subscribe:job', RUN_A);
    await subscribe(b, 'subscribe:revision', REPORT_A);
    await subscribe(b, 'subscribe:corpus', '');
    // Revision events go to the pages that asked for that report.
    await subscribe(a, 'subscribe:revision', REPORT_A);
    const seenA = record(a);
    const seenB = record(b);

    const live = createPrivateEmitter(io, lookups);
    await live.toRun(RUN_A, 'research:progress', SECRET);
    await live.toRun(RUN_A, 'research:plan_ready_for_confirmation', {
      runId: RUN_A,
      planPayload: SECRET,
    });
    await live.toRun(RUN_A, 'research:completed', { runId: RUN_A, reportId: REPORT_A });
    await live.toRun(RUN_A, 'run:summary', SECRET);
    await live.notifyRunOwner(RUN_A, 'runs:updated', {});
    await live.notifyRunOwner(RUN_A, 'reports:updated', {});
    await live.toReportRevision(REPORT_A, 'revision:progress', SECRET);
    await live.toReportRevision(REPORT_A, 'revision:completed', SECRET);
    await live.notifyReportOwner(REPORT_A, 'living_report:revision_completed', {
      reportId: REPORT_A,
    });
    await live.toIngestionJob(INGEST_A, 'job:progress', SECRET);
    await live.toIngestionJob(INGEST_A, 'job:completed', SECRET);
    await live.notifyIngestionJobOwner(INGEST_A, 'corpus:updated', {});
    await live.notifySourceOwners(SOURCE_A, 'corpus:updated', {});
    await live.notifyAtlasExportOwner(EXPORT_A, 'atlas:updated', SECRET);
    live.toUser('user_a', 'notification', SECRET);

    await settle();

    expect(seenB).toEqual([]);
    expect(seenA.map((e) => e.event)).toEqual([
      'research:progress',
      'research:plan_ready_for_confirmation',
      'research:completed',
      'run:summary',
      'runs:updated',
      'reports:updated',
      'revision:progress',
      'revision:completed',
      'living_report:revision_completed',
      'job:progress',
      'job:completed',
      'corpus:updated',
      'corpus:updated',
      'atlas:updated',
      'notification',
    ]);
  });

  it('the owner receives each event once even when also subscribed to the run room', async () => {
    const a = await connect('token-a');
    await subscribe(a, 'subscribe:job', RUN_A);
    const seenA = record(a);
    await createPrivateEmitter(io, lookups).toRun(RUN_A, 'research:progress', SECRET);
    await settle();
    expect(seenA).toHaveLength(1);
  });

  it('an event whose owner cannot be found reaches nobody outside its room', async () => {
    const a = await connect('token-a');
    const b = await connect('token-b');
    const seenA = record(a);
    const seenB = record(b);
    const live = createPrivateEmitter(io, lookups);
    await live.toRun('99999999-9999-4999-8999-999999999999', 'research:progress', SECRET);
    await live.notifyRunOwner('99999999-9999-4999-8999-999999999999', 'runs:updated', {});
    await settle();
    expect(seenA).toEqual([]);
    expect(seenB).toEqual([]);
  });

  it('the stand-in would expose a global broadcast (the check above is meaningful)', async () => {
    const b = await connect('token-b');
    fake.emit('research:progress', SECRET);
    expect(record(b)).toHaveLength(1);
  });

  it('with no server attached, emitting is a no-op', async () => {
    await expect(
      createPrivateEmitter(undefined, lookups).toRun(RUN_A, 'x', {}),
    ).resolves.toBeUndefined();
  });
});

describe('revision events stay with the pages that asked for that report', () => {
  it('an owner tab that did not open the report’s revision workspace does not receive them', async () => {
    const workspace = await connect('token-a');
    const otherTab = await connect('token-a');
    await subscribe(workspace, 'subscribe:revision', REPORT_A);
    await createPrivateEmitter(io, lookups).toReportRevision(
      REPORT_A,
      'revision:completed',
      SECRET,
    );
    expect(record(workspace).map((e) => e.event)).toEqual(['revision:completed']);
    expect(record(otherTab)).toEqual([]);
  });
});

describe('a connection lasts only as long as its session', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is closed once its token has expired without a fresh one', async () => {
    vi.useFakeTimers();
    tokenLifetimeMs = 60_000;
    const a = await connect('token-a');
    await vi.advanceTimersByTimeAsync(60_000 + SESSION_GRACE_MS - 1);
    expect(a.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(2);
    expect(a.connected).toBe(false);
  });

  it('stays open while the page keeps sending a fresh token', async () => {
    vi.useFakeTimers();
    tokenLifetimeMs = 60_000;
    const a = await connect('token-a');
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await subscribe(a, 'auth:refresh', 'token-a')).toEqual({ ok: true });
    }
    expect(a.connected).toBe(true);
  });

  it('is closed when the refresh token is invalid or belongs to someone else', async () => {
    const a = await connect('token-a');
    expect(await subscribe(a, 'auth:refresh', 'token-b')).toEqual({ ok: false });
    expect(a.connected).toBe(false);
    const again = await connect('token-a');
    expect(await subscribe(again, 'auth:refresh', 'not-a-real-token')).toEqual({ ok: false });
    expect(again.connected).toBe(false);
  });
});

describe('room checks cannot be used to flood the database', () => {
  const madeUpId = (n: number): string => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

  it('caps how many checks one connection may start per minute', async () => {
    const b = await connect('token-b');
    for (let i = 0; i < SUBSCRIBE_LIMIT_PER_MINUTE + 25; i += 1) {
      expect(await subscribe(b, 'subscribe:job', madeUpId(i))).toEqual({ ok: false });
    }
    expect(jobChecks).toBe(SUBSCRIBE_LIMIT_PER_MINUTE);
  });

  it('asks once for a room requested many times at once, and not again once joined', async () => {
    const a = await connect('token-a');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => subscribe(a, 'subscribe:job', RUN_A)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await subscribe(a, 'subscribe:job', RUN_A)).toEqual({ ok: true });
    expect(jobChecks).toBe(1);
  });
});

describe('events follow the current owner and do not wait on other objects', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a reassigned run stops reaching its former owner after the cache lifetime', async () => {
    vi.useFakeTimers();
    const a = await connect('token-a');
    const b = await connect('token-b');
    let ownerNow = 'user_a';
    const live = createPrivateEmitter(io, { ...lookups, runOwner: async () => ownerNow });
    await live.toRun(RUN_A, 'research:progress', SECRET);
    ownerNow = 'user_b';
    await vi.advanceTimersByTimeAsync(61_000);
    await live.toRun(RUN_A, 'research:progress', SECRET);
    expect(record(a)).toHaveLength(1);
    expect(record(b)).toHaveLength(1);
  });

  it('a slow owner lookup for one run does not delay another run’s events', async () => {
    const a = await connect('token-a');
    let release: (owner: string | null) => void = () => undefined;
    const slow = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    const OTHER_RUN = '66666666-6666-4666-8666-666666666666';
    const live = createPrivateEmitter(io, {
      ...lookups,
      runOwner: (id) => (id === OTHER_RUN ? slow : Promise.resolve('user_a')),
    });
    const stuck = live.toRun(OTHER_RUN, 'research:progress', { run: 'other' });
    await live.toRun(RUN_A, 'research:progress', { run: 'a-1' });
    await live.toRun(RUN_A, 'research:progress', { run: 'a-2' });
    expect(record(a).map((e) => e.data)).toEqual([{ run: 'a-1' }, { run: 'a-2' }]);
    release(null);
    await stuck;
  });
});

describe('route handlers cannot broadcast to every page', () => {
  it("a route's global emit reaches only the signed-in user who made the request", async () => {
    const a = await connect('token-a');
    const b = await connect('token-b');
    const routeIo = createRouteIo(io);
    rlsStore.run({ userId: 'user_a', orgId: null }, () => {
      routeIo.emit('runs:updated', {});
    });
    expect(record(a).map((e) => e.event)).toEqual(['runs:updated']);
    expect(record(b)).toEqual([]);
  });

  it('a global emit with no signed-in request in scope reaches nobody', async () => {
    const a = await connect('token-a');
    const b = await connect('token-b');
    createRouteIo(io).emit('runs:updated', {});
    expect(record(a)).toEqual([]);
    expect(record(b)).toEqual([]);
  });

  it("a route's room emit reaches only checked members of that room", async () => {
    const a = await connect('token-a');
    const b = await connect('token-b');
    await subscribe(a, 'subscribe:job', RUN_A);
    await subscribe(b, 'subscribe:job', RUN_A);
    await subscribe(a, 'subscribe:revision', REPORT_A);
    await subscribe(b, 'subscribe:revision', REPORT_A);
    const routeIo = createRouteIo(io);
    routeIo.to(`job:${RUN_A}`).emit('research:plan_refined', SECRET);
    routeIo.to(`job:revision:${REPORT_A}`).emit('revision:progress', SECRET);
    routeIo.to('reports').emit('reports:updated', {});
    expect(record(a).map((e) => e.event)).toEqual(['research:plan_refined', 'revision:progress']);
    expect(record(b)).toEqual([]);
  });
});

describe('no server code sends to every connected socket', () => {
  const srcRoot = path.join(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(full);
      }
    }
  };
  walk(srcRoot);

  it('workers and services never use the raw server to emit or join', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(srcRoot, file);
      if (rel.startsWith('realtime')) continue;
      // Route handlers only ever hold the restricted handle (see RouteIo).
      const isRoute = rel.startsWith(path.join('api', 'routes'));
      const text = fs.readFileSync(file, 'utf8');
      if (!isRoute && /\bio\??\.emit\(/.test(text)) offenders.push(`${rel}: io.emit`);
      if (!isRoute && /\bio\??\.(sockets\.)?(to|in)\(/.test(text)) offenders.push(`${rel}: io.to`);
      if (/socket\.join\(/.test(text)) offenders.push(`${rel}: socket.join`);
    }
    expect(offenders).toEqual([]);
  });

  it('the server entry point installs the access control and the restricted route handle', () => {
    const entry = fs.readFileSync(path.join(srcRoot, 'index.ts'), 'utf8');
    expect(entry).toContain('attachSocketAccessControl(io)');
    expect(entry).toContain("app.set('io', createRouteIo(io))");
    expect(entry).not.toContain("app.set('io', io)");
  });
});
