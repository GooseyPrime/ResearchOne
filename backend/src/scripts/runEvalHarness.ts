/**
 * Runs the measurement harness against a live ResearchOne deployment.
 *
 * The admin sign-in is used only to submit tasks. Progress and results are
 * read from the database this command already connects to. It refuses to
 * start unless --confirm-spend is present.
 *
 *   npm run eval:harness -- --confirm-spend --limit 3
 */
import { loadEnv } from '../bootstrap/loadEnv';
import { initDb, query } from '../db/pool';
import { approveGeneratedPlanAsOwner } from '../services/planning/confirmGeneratedPlan';
import {
  loadStoredRun,
  runHarness,
  SignInRejectedError,
  submitTaskThroughAdminRoute,
  type EvalTransport,
} from '../services/eval/runHarness';
import { loadEvalTasks, type EvalTask } from '../services/eval/taskSet';

export const DEFAULT_TASK_LIMIT = 3;
export const RUN_TIMEOUT_MS = 45 * 60 * 1000;
const POLL_MS = 15_000;

export function assertSpendConfirmed(argv: string[]): void {
  if (!argv.includes('--confirm-spend')) {
    throw new Error('Refusing to start: pass --confirm-spend. Recorded cost is a floor, not a bill.');
  }
}

export function selectHarnessTasks(tasks: EvalTask[], limit: number): EvalTask[] {
  const picked: EvalTask[] = [];
  for (const kind of ['factual', 'survey', 'challenge'] as const) {
    const match = tasks.find((task) => task.kind === kind);
    if (match) picked.push(match);
  }
  for (const task of tasks) {
    if (picked.length >= limit) break;
    if (!picked.includes(task)) picked.push(task);
  }
  return picked.slice(0, limit);
}

export function parseFlagOverrides(argv: string[]): Record<string, boolean> | null {
  const flags: Record<string, boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--flag') continue;
    const raw = argv[i + 1] ?? '';
    const [name, value] = raw.split('=');
    if (!name || (value !== 'true' && value !== 'false')) throw new Error('--flag must be NAME=true or NAME=false');
    flags[name] = value === 'true';
  }
  return Object.keys(flags).length > 0 ? flags : null;
}

export function parseLimit(argv: string[]): number {
  const index = argv.indexOf('--limit');
  if (index === -1) return DEFAULT_TASK_LIMIT;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error('--limit must be a positive integer');
  return value;
}

export interface SubmittedTask {
  task: EvalTask;
  runId: string;
  reference: string;
  submittedAt: number;
}

export async function submitSelectedTasks(args: {
  tasks: EvalTask[];
  submit: (task: EvalTask) => Promise<{ runId: string }>;
  lookupReference: (runId: string) => Promise<string | null>;
  print: (line: string) => void;
  now?: () => number;
}): Promise<SubmittedTask[]> {
  const now = args.now ?? Date.now;
  const submitted: SubmittedTask[] = [];
  for (const task of args.tasks) {
    let started: { runId: string };
    try {
      started = await args.submit(task);
    } catch (err) {
      if (err instanceof SignInRejectedError) {
        throw new SignInRejectedError();
      }
      throw err;
    }
    const reference = (await args.lookupReference(started.runId)) ?? started.runId;
    args.print(`${task.id} reference=${reference} run=${started.runId}`);
    submitted.push({ task, runId: started.runId, reference, submittedAt: now() });
  }
  return submitted;
}

export interface RunProgress {
  status: string | null;
  reason: string | null;
}

export async function waitForRunInDatabase(args: {
  runId: string;
  readStatus: (runId: string) => Promise<RunProgress>;
  approvePlan?: (runId: string) => Promise<void>;
  timeoutMs: number;
  startedAt?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{ status: string; reason: string | null }> {
  const sleep = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = args.now ?? Date.now;
  const started = args.startedAt ?? now();
  let approved = false;
  for (;;) {
    if (now() - started > args.timeoutMs) throw new Error(`run ${args.runId} timed out`);
    const progress = await args.readStatus(args.runId);
    if (progress.status === 'plan_pending_confirmation' && !approved) {
      approved = true;
      await args.approvePlan?.(args.runId);
    }
    if (
      progress.status === 'completed' ||
      progress.status === 'failed' ||
      progress.status === 'cancelled' ||
      progress.status === 'aborted'
    ) {
      return { status: progress.status, reason: progress.reason };
    }
    await sleep(POLL_MS);
  }
}

export function followSubmittedRuns(
  items: SubmittedTask[],
  args: {
    readStatus: (runId: string) => Promise<RunProgress>;
    approvePlan?: (runId: string) => Promise<void>;
    timeoutMs: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  }
): Promise<Array<{ runId: string; status: string; reason: string | null }>> {
  return Promise.all(
    items.map(async (item) => {
      const outcome = await waitForRunInDatabase({
        runId: item.runId,
        readStatus: args.readStatus,
        approvePlan: args.approvePlan,
        timeoutMs: args.timeoutMs,
        startedAt: item.submittedAt,
        sleep: args.sleep,
        now: args.now,
      });
      return { runId: item.runId, ...outcome };
    })
  );
}

async function lookupReference(runId: string): Promise<string | null> {
  const rows = await query<{ run_ref: string | null }>(`SELECT run_ref FROM research_runs WHERE id = $1`, [runId]);
  return rows[0]?.run_ref ?? null;
}

async function readStatus(runId: string): Promise<RunProgress> {
  const rows = await query<{ status: string; error_message: string | null }>(
    `SELECT status::text AS status, error_message FROM research_runs WHERE id = $1`,
    [runId]
  );
  return { status: rows[0]?.status ?? null, reason: rows[0]?.error_message ?? null };
}

async function main(): Promise<void> {
  assertSpendConfirmed(process.argv);
  const limit = parseLimit(process.argv);
  const flagOverrides = parseFlagOverrides(process.argv);
  const apiBase = process.env.RESEARCHONE_API_BASE;
  const authHeader = process.env.RESEARCHONE_ADMIN_AUTHORIZATION;
  if (!apiBase || !authHeader) {
    throw new Error('RESEARCHONE_API_BASE and RESEARCHONE_ADMIN_AUTHORIZATION are required');
  }
  loadEnv();
  await initDb();
  const tasks = selectHarnessTasks(loadEvalTasks(), limit);
  const submitted = await submitSelectedTasks({
    tasks,
    submit: (task) => submitTaskThroughAdminRoute(apiBase, task, task.fixtureDocuments ?? [], authHeader, flagOverrides),
    lookupReference,
    print: (line) => console.log(line),
  });
  const scored: SubmittedTask[] = [];
  const outcomes = await followSubmittedRuns(submitted, {
    readStatus,
    approvePlan: approveGeneratedPlanAsOwner,
    timeoutMs: RUN_TIMEOUT_MS,
  });
  for (const item of submitted) {
    const outcome = outcomes.find((row) => row.runId === item.runId);
    if (!outcome || outcome.status !== 'completed') {
      console.log(`${item.reference} not scored: ${outcome?.status ?? 'missing'}. ${outcome?.reason ?? 'no reason recorded'}`);
      continue;
    }
    scored.push(item);
  }
  const transport: EvalTransport = {
    start: async (task) => {
      const match = scored.find((item) => item.task.id === task.id);
      if (!match) throw new Error(`missing submission for ${task.id}`);
      return { runId: match.runId };
    },
    wait: async () => {},
    load: loadStoredRun,
  };
  const rows = await runHarness(transport, scored.map((item) => item.task), flagOverrides);
  for (const row of rows) {
    console.log(
      `${row.taskId} run=${row.runId} tokens=${row.tokens ?? 'none'} recorded_cost_usd=${row.recordedCostUsd ?? 'none'} (floor; missing prices record as zero)`
    );
  }
}

if (process.argv[1]?.includes('runEvalHarness')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
