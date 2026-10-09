/**
 * What happens to a run's payment when the run ends (RJ-019).
 *
 * One rule, in one place, so the two paths that end a run cannot disagree:
 * a customer pays only for a report that was delivered.
 *
 *   - `charge`: the run completed. The reserved payment is taken and, on a
 *     subscription, the report is counted.
 *   - `keep_hold_for_run_again`: the run failed but can be run again (an AI
 *     provider out of credit, rate-limited or down). Nothing is taken. The
 *     reservation stays so that running the same run again uses it, and is not
 *     a second payment.
 *   - `release_hold`: the run ended any other way. Nothing is taken and the
 *     reservation is given back at once.
 */
export type RunChargeDecision = 'charge' | 'keep_hold_for_run_again' | 'release_hold';

export function runChargeDecision(args: { status: string; retryable?: boolean }): RunChargeDecision {
  if (args.status === 'completed') return 'charge';
  if (args.status === 'failed' && args.retryable === true) return 'keep_hold_for_run_again';
  return 'release_hold';
}
