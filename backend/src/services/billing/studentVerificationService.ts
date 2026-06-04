import { config } from '../../config';
import { query, queryOne } from '../../db/pool';
import { logger } from '../../utils/logger';

const SHEERID_VERIFICATION_URL = 'https://services.sheerid.com/rest/v2/verification';

export interface StudentVerificationResult {
  verified: boolean;
  error?: string;
}

function isMissingColumnError(err: unknown): boolean {
  return (err as { code?: string })?.code === '42703';
}

export function isStudentDevBypassAvailable(): boolean {
  return (
    !config.sheerid.apiToken.trim() &&
    config.nodeEnv !== 'production' &&
    process.env.SHEERID_DEV_BYPASS === '1'
  );
}

function devBypassAllowed(verificationId: string): boolean {
  return isStudentDevBypassAvailable() && verificationId.startsWith('dev-');
}

/** SheerID REST GET success: currentStep success (any case) or rewardData present. */
export function sheerIdPayloadIndicatesSuccess(body: Record<string, unknown>): boolean {
  const step = body.currentStep;
  if (typeof step === 'string' && step.toLowerCase() === 'success') return true;
  const rewardData = body.rewardData;
  if (rewardData != null && typeof rewardData === 'object') return true;
  const rewardCode = body.rewardCode;
  if (typeof rewardCode === 'string' && rewardCode.trim().length > 0) return true;
  return false;
}

async function verificationIdAlreadyBound(
  verificationId: string,
  userId: string,
): Promise<boolean> {
  try {
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM users
       WHERE sheerid_verification_id = $1
         AND id <> $2
       LIMIT 1`,
      [verificationId, userId],
    );
    return row != null;
  } catch (err: unknown) {
    if (isMissingColumnError(err)) return false;
    throw err;
  }
}

/**
 * Canonical URL for SheerID verification status (REST v2).
 * @see https://developer.sheerid.com/
 */
export function sheerIdVerificationStatusUrl(verificationId: string): string {
  const id = encodeURIComponent(verificationId.trim());
  return `${SHEERID_VERIFICATION_URL}/${id}`;
}

export async function isStudentVerified(userId: string): Promise<boolean> {
  try {
    const row = await queryOne<{ verified_student: boolean }>(
      'SELECT verified_student FROM users WHERE id = $1',
      [userId],
    );
    return row?.verified_student === true;
  } catch (err: unknown) {
    if (isMissingColumnError(err)) {
      logger.debug('isStudentVerified: verified_student column missing — treating as unverified', {
        userId,
      });
      return false;
    }
    throw err;
  }
}

async function persistStudentVerification(
  userId: string,
  verificationId: string,
): Promise<StudentVerificationResult> {
  try {
    await query(
      `UPDATE users
       SET verified_student = true,
           student_verified_at = NOW(),
           sheerid_verification_id = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [userId, verificationId],
    );
    return { verified: true };
  } catch (err: unknown) {
    if (isMissingColumnError(err)) {
      logger.warn('persistStudentVerification skipped — student verification columns missing', {
        userId,
      });
      return {
        verified: false,
        error: 'Student verification is not available yet. Please try again shortly.',
      };
    }
    throw err;
  }
}

async function fetchSheerIdVerificationStatus(
  verificationId: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const apiToken = config.sheerid.apiToken.trim();
  if (!apiToken) {
    return { ok: false, error: 'SheerID is not configured' };
  }

  const url = sheerIdVerificationStatusUrl(verificationId);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'SheerID request failed';
    logger.warn('sheerid_verification_fetch_failed', { verificationId, message });
    return { ok: false, error: 'Unable to reach SheerID verification service' };
  }

  if (!response.ok) {
    logger.warn('sheerid_verification_http_error', {
      verificationId,
      status: response.status,
    });
    return {
      ok: false,
      error: `SheerID verification lookup failed (${response.status})`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'SheerID returned an invalid response' };
  }

  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'SheerID returned an invalid response' };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

/**
 * Verify a SheerID verification id, then persist verified_student on the user row.
 * Side effect (SheerID GET) runs before DB write per Rule 13.
 */
export async function recordStudentVerification(
  userId: string,
  verificationId: string,
): Promise<StudentVerificationResult> {
  const trimmedId = verificationId.trim();
  if (!trimmedId) {
    return { verified: false, error: 'verificationId is required' };
  }

  if (devBypassAllowed(trimmedId)) {
    logger.info('student_verification_dev_bypass', { userId, verificationId: trimmedId });
    return persistStudentVerification(userId, trimmedId);
  }

  const sheerIdResult = await fetchSheerIdVerificationStatus(trimmedId);
  if (!sheerIdResult.ok) {
    return { verified: false, error: sheerIdResult.error };
  }

  if (!sheerIdPayloadIndicatesSuccess(sheerIdResult.body)) {
    return { verified: false, error: 'Student verification is not complete' };
  }

  if (await verificationIdAlreadyBound(trimmedId, userId)) {
    logger.warn('student_verification_id_reuse_attempt', { userId, verificationId: trimmedId });
    return {
      verified: false,
      error: 'This student verification is already linked to another account',
    };
  }

  return persistStudentVerification(userId, trimmedId);
}

export function isSheerIdProgramConfigured(): boolean {
  return Boolean(config.sheerid.programId.trim());
}
