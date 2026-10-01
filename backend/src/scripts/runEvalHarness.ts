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
}

export async function submitSelectedTasks(args: {
  tasks: EvalTask[];
  submit: (task: EvalTask) => Promise<{ runId: string }>;
  lookupReference: (runId: string) => Promise<string | null>;
  print: (line: string) => void;
}): Promise<SubmittedTask[]> {
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
    submitted.push({ task, runId: started.runId, reference });
  }
  return submitted;
}

export async function waitForRunInDatabase(args: {
  runId: string;
  readStatus: (runId: string) => Promise<string | null>;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<void> {
  const sleep = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = args.now ?? Date.now;
  const started = now();
  for (;;) {
    if (now() - started > args.timeoutMs) throw new Error(`run ${args.runId} timed out`);
    const status = await args.readStatus(args.runId);
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return;
    await sleep(POLL_MS);
  }
}

async function lookupReference(runId: string): Promise<string | null> {
  const rows = await query<{ run_ref: string | null }>(`SELECT run_ref FROM research_runs WHERE id = $1`, [runId]);
  return rows[0]?.run_ref ?? null;
}

async function readStatus(runId: string): Promise<string | null> {
  const rows = await query<{ status: string }>(`SELECT status FROM research_runs WHERE id = $1`, [runId]);
  return rows[0]?.status ?? null;
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
  const transport: EvalTransport = {
    start: async (task) => {
      const match = submitted.find((item) => item.task.id === task.id);
      if (!match) throw new Error(`missing submission for ${task.id}`);
      return { runId: match.runId };
    },
    wait: (runId) => waitForRunInDatabase({ runId, readStatus, timeoutMs: RUN_TIMEOUT_MS }),
    load: loadStoredRun,
  };
  const rows = await runHarness(transport, submitted.map((item) => item.task), flagOverrides);
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
