/**
 * Runs the measurement harness against a live ResearchOne deployment.
 *
 * This talks to the production start route and the production database.
 * The results table exists only after the harness pull request has merged
 * and the backend deploy has finished. It refuses to start unless
 * --confirm-spend is present.
 *
 *   npm run eval:harness -- --confirm-spend --limit 3
 */
import { loadEnv } from '../bootstrap/loadEnv';
import { initDb } from '../db/pool';
import { loadStoredRun, runHarness, submitTaskThroughAdminRoute, type EvalTransport } from '../services/eval/runHarness';
import { loadEvalTasks, type EvalTask } from '../services/eval/taskSet';

export const HARNESS_CONCURRENCY = 2;
export const DEFAULT_TASK_LIMIT = 3;
const POLL_MS = 15_000;
const TIMEOUT_MS = 45 * 60 * 1000;

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

async function pollRun(apiBase: string, runId: string, authHeader: string): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`run ${runId} timed out`);
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/research/${runId}`, {
      headers: { authorization: authHeader },
    });
    if (!response.ok) throw new Error(`poll failed: ${response.status}`);
    const body = (await response.json()) as { status?: string };
    if (body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled') return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
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
  const transport: EvalTransport = {
    start: (task, files, overrides) => submitTaskThroughAdminRoute(apiBase, task, files, authHeader, overrides),
    wait: (runId) => pollRun(apiBase, runId, authHeader),
    load: loadStoredRun,
  };
  const rows = [];
  for (let i = 0; i < tasks.length; i += HARNESS_CONCURRENCY) {
    const batch = tasks.slice(i, i + HARNESS_CONCURRENCY);
    rows.push(...(await runHarness(transport, batch, flagOverrides)));
  }
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
