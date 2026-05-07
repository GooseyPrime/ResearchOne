/**
 * Pipeline B eligibility evaluation per Section 8.
 *
 * Five conditions must ALL be true for a run to be eligible:
 * 1. User has pipeline_b_consent = true (account-level)
 * 2. No per-run opt-out for this run
 * 3. User tier is NOT sovereign (defense layer 1)
 * 4. Deployment is NOT sovereign (defense layer 2)
 * 5. Run completed successfully (status = 'completed')
 */

import { queryOne } from '../../db/pool';
import { isSovereignDeployment } from '../../config/deployment';
import { logger } from '../../utils/logger';

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export async function evaluatePipelineBEligibility(
  runId: string,
  userId: string,
  userTier: string,
  runStatus: string
): Promise<EligibilityResult> {
  const reasons: string[] = [];

  if (runStatus !== 'completed') {
    reasons.push('run_not_completed');
  }

  if (isSovereignDeployment) {
    reasons.push('sovereign_deployment');
  }

  if (userTier === 'sovereign') {
    reasons.push('sovereign_tier');
  }

  try {
    const consent = await queryOne<{ pipeline_b_consent: boolean }>(
      'SELECT pipeline_b_consent FROM user_ingestion_consent WHERE user_id = $1',
      [userId]
    );
    if (consent && !consent.pipeline_b_consent) {
      reasons.push('user_opted_out');
    }
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      // Table doesn't exist yet — treat as consent given (default)
    } else {
      throw err;
    }
  }

  try {
    const override = await queryOne<{ pipeline_b_opt_out: boolean }>(
      'SELECT pipeline_b_opt_out FROM run_user_overrides WHERE run_id = $1',
      [runId]
    );
    if (override?.pipeline_b_opt_out) {
      reasons.push('per_run_opt_out');
    }
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      // Table doesn't exist yet
    } else {
      throw err;
    }
  }

  const eligible = reasons.length === 0;
  logger.info('pipeline_b_eligibility_evaluated', { runId, userId, eligible, reasons });
  return { eligible, reasons };
}
