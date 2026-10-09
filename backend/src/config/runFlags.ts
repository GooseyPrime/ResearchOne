/**
 * Switches recorded for one run.
 *
 * An allowlisted admin may start a run with a switch turned on for that run
 * only (`eval_run_overrides`, written by the research route). The worker loads
 * what was recorded and runs the job inside this scope, so the run behaves as
 * if the switch were on while every other run keeps the process setting.
 *
 * Nothing here reads the database. The scope is set by whoever starts the job.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const runFlagScope = new AsyncLocalStorage<Readonly<Record<string, boolean>>>();

export function runWithFlags<T>(flags: Record<string, boolean> | null | undefined, work: () => T): T {
  return runFlagScope.run(Object.freeze({ ...(flags ?? {}) }), work);
}

/** The value recorded for this run, else the process setting. Unset and unrecognized values are off. */
export function switchEnabled(name: string): boolean {
  const recorded = runFlagScope.getStore()?.[name];
  if (typeof recorded === 'boolean') return recorded;
  return process.env[name] === 'true';
}

/**
 * A safeguard switch: on unless it is set to "false", for this run or for the
 * process. Used where forgetting to set a value must not turn a protection off.
 */
export function switchEnabledByDefault(name: string): boolean {
  const recorded = runFlagScope.getStore()?.[name];
  if (typeof recorded === 'boolean') return recorded;
  return process.env[name] !== 'false';
}
