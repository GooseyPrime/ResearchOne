/**
 * BYOK key vault — store, retrieve, validate, and delete user-supplied API keys.
 *
 * Keys are stored AES-256-GCM encrypted. The plaintext key never appears
 * in logs or API responses.
 */

import axios from 'axios';
import { query, queryOne } from '../../db/pool';
import { encrypt, decrypt, extractLastFour, type EncryptedPayload } from './encryption';
import { logger } from '../../utils/logger';

export type BYOKProvider = 'openrouter' | 'anthropic' | 'openai' | 'google';

export interface KeyStatus {
  hasKey: boolean;
  keyLastFour: string | null;
  keyStatus: string | null;
  provider: string;
  keyValidatedAt: string | null;
}

export interface ValidationResult {
  valid: boolean;
  lastFour: string;
  reason?: string;
}

/**
 * Validates a key against the provider's API. Never logs the plaintext key.
 * Provider dispatch table per Work Order I spec.
 */
export async function validateKey(provider: BYOKProvider, plaintextKey: string): Promise<ValidationResult> {
  const lastFour = extractLastFour(plaintextKey);

  try {
    switch (provider) {
      case 'openrouter': {
        const res = await axios.get('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${plaintextKey}` },
          timeout: 10000,
        });
        return { valid: res.status === 200, lastFour };
      }
      case 'openai': {
        const res = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${plaintextKey}` },
          timeout: 10000,
        });
        return { valid: res.status === 200, lastFour };
      }
      case 'anthropic': {
        const res = await axios.get('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': plaintextKey,
            'anthropic-version': '2023-06-01',
          },
          timeout: 10000,
        });
        return { valid: res.status === 200, lastFour };
      }
      case 'google': {
        const res = await axios.get(
          `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(plaintextKey)}`,
          { timeout: 10000 }
        );
        return { valid: res.status === 200, lastFour };
      }
      default: {
        const _exhaustive: never = provider;
        return { valid: false, lastFour, reason: `Unknown provider: ${_exhaustive}` };
      }
    }
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const reason = status === 401 || status === 403 ? 'Invalid or unauthorized key' : 'Validation request failed';
    logger.warn('byok_key_validation_failed', { provider, lastFour, status, reason });
    return { valid: false, lastFour, reason };
  }
}

/**
 * Validates and stores a BYOK key. Returns validation result.
 * Invalid keys are rejected and NOT stored.
 */
export async function storeKey(
  userId: string,
  provider: BYOKProvider,
  plaintextKey: string
): Promise<ValidationResult> {
  const validation = await validateKey(provider, plaintextKey);

  if (!validation.valid) {
    return validation;
  }

  const { ciphertext, iv, tag } = encrypt(plaintextKey);

  try {
    await query(
      `INSERT INTO byok_keys (user_id, provider, encrypted_key, encrypted_key_iv, encrypted_key_tag, key_last_four, key_validated_at, key_status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'valid')
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         encrypted_key = EXCLUDED.encrypted_key,
         encrypted_key_iv = EXCLUDED.encrypted_key_iv,
         encrypted_key_tag = EXCLUDED.encrypted_key_tag,
         key_last_four = EXCLUDED.key_last_four,
         key_validated_at = NOW(),
         key_status = 'valid',
         updated_at = NOW()`,
      [userId, provider, ciphertext, iv, tag, validation.lastFour]
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      logger.warn('byok_keys table not found — migration not applied', { userId, provider });
      return { valid: false, lastFour: validation.lastFour, reason: 'BYOK storage not available' };
    }
    throw err;
  }

  logger.info('byok_key_stored', { userId, provider, lastFour: validation.lastFour });
  return validation;
}

/**
 * Retrieves and decrypts a BYOK key for a given user and provider.
 * Returns null if no valid key exists.
 */
export async function getDecryptedKey(userId: string, provider: BYOKProvider = 'openrouter'): Promise<string | null> {
  try {
    const row = await queryOne<{
      encrypted_key: string;
      encrypted_key_iv: string;
      encrypted_key_tag: string;
      key_status: string;
    }>(
      `SELECT encrypted_key, encrypted_key_iv, encrypted_key_tag, key_status
       FROM byok_keys
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );

    if (!row || row.key_status !== 'valid') return null;

    const payload: EncryptedPayload = {
      ciphertext: row.encrypted_key,
      iv: row.encrypted_key_iv,
      tag: row.encrypted_key_tag,
    };

    return decrypt(payload);
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') return null;
    throw err;
  }
}

/**
 * Returns key status without exposing the key itself.
 */
export async function getKeyStatus(userId: string, provider: BYOKProvider = 'openrouter'): Promise<KeyStatus> {
  try {
    const row = await queryOne<{
      key_last_four: string;
      key_status: string;
      key_validated_at: string | null;
    }>(
      `SELECT key_last_four, key_status, key_validated_at
       FROM byok_keys
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );

    if (!row) {
      return { hasKey: false, keyLastFour: null, keyStatus: null, provider, keyValidatedAt: null };
    }

    return {
      hasKey: true,
      keyLastFour: row.key_last_four,
      keyStatus: row.key_status,
      provider,
      keyValidatedAt: row.key_validated_at,
    };
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      return { hasKey: false, keyLastFour: null, keyStatus: null, provider, keyValidatedAt: null };
    }
    throw err;
  }
}

/**
 * Deletes (revokes) a BYOK key.
 */
export async function deleteKey(userId: string, provider: BYOKProvider = 'openrouter'): Promise<boolean> {
  try {
    const result = await query(
      `DELETE FROM byok_keys WHERE user_id = $1 AND provider = $2 RETURNING user_id`,
      [userId, provider]
    );
    const deleted = result.length > 0;
    if (deleted) {
      logger.info('byok_key_deleted', { userId, provider });
    }
    return deleted;
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') return false;
    throw err;
  }
}
