/**
 * AES-256-GCM encryption helpers for BYOK key storage.
 *
 * Uses BYOK_ENCRYPTION_KEY env var (32-byte hex-encoded master key).
 * The design supports key rotation by allowing a secondary decryption
 * key (BYOK_ENCRYPTION_KEY_PREVIOUS) for read-path fallback.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function parseHexKey(hex: string, label: string): Buffer {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes (got ${buf.length}). Provide a 64-char hex string.`);
  }
  return buf;
}

function getMasterKey(): Buffer {
  const hex = process.env.BYOK_ENCRYPTION_KEY ?? '';
  if (!hex || hex.length !== 64) {
    throw new Error('BYOK_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return parseHexKey(hex, 'BYOK_ENCRYPTION_KEY');
}

function getPreviousMasterKey(): Buffer | null {
  const hex = process.env.BYOK_ENCRYPTION_KEY_PREVIOUS ?? '';
  if (!hex || hex.length !== 64) return null;
  return parseHexKey(hex, 'BYOK_ENCRYPTION_KEY_PREVIOUS');
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encrypt(plaintext: string): EncryptedPayload {
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = getMasterKey();
  try {
    return decryptWithKey(payload, key);
  } catch (primaryErr) {
    const prevKey = getPreviousMasterKey();
    if (prevKey) {
      try {
        return decryptWithKey(payload, prevKey);
      } catch {
        // Fall through to throw the primary error
      }
    }
    throw primaryErr;
  }
}

function decryptWithKey(payload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  if (iv.length !== IV_BYTES) throw new Error('Invalid IV length');
  if (tag.length !== TAG_BYTES) throw new Error('Invalid auth tag length');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function extractLastFour(key: string): string {
  return key.slice(-4);
}
