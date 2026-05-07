import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'crypto';

const TEST_KEY_HEX = randomBytes(32).toString('hex');
const WRONG_KEY_HEX = randomBytes(32).toString('hex');

describe('BYOK encryption', () => {
  beforeAll(() => {
    process.env.BYOK_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  afterAll(() => {
    delete process.env.BYOK_ENCRYPTION_KEY;
  });

  it('encrypts and decrypts correctly', async () => {
    const { encrypt, decrypt } = await import('../services/byok/encryption');
    const plaintext = 'sk-or-v1-abc123def456';
    const encrypted = encrypt(plaintext);

    expect(encrypted.ciphertext).not.toBe(plaintext);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('fails to decrypt with wrong master key', async () => {
    const { encrypt, decrypt } = await import('../services/byok/encryption');
    const plaintext = 'sk-or-v1-secret-key-here';
    const encrypted = encrypt(plaintext);

    const originalKey = process.env.BYOK_ENCRYPTION_KEY;
    process.env.BYOK_ENCRYPTION_KEY = WRONG_KEY_HEX;

    expect(() => decrypt(encrypted)).toThrow();

    process.env.BYOK_ENCRYPTION_KEY = originalKey;
  });

  it('fails to decrypt with tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('../services/byok/encryption');
    const plaintext = 'sk-or-v1-tamper-test';
    const encrypted = encrypt(plaintext);

    const tamperedCt = Buffer.from(encrypted.ciphertext, 'base64');
    tamperedCt[0] ^= 0xff;
    encrypted.ciphertext = tamperedCt.toString('base64');

    expect(() => decrypt(encrypted)).toThrow();
  });

  it('fails to decrypt with tampered auth tag', async () => {
    const { encrypt, decrypt } = await import('../services/byok/encryption');
    const plaintext = 'sk-or-v1-tag-tamper';
    const encrypted = encrypt(plaintext);

    const tamperedTag = Buffer.from(encrypted.tag, 'base64');
    tamperedTag[0] ^= 0xff;
    encrypted.tag = tamperedTag.toString('base64');

    expect(() => decrypt(encrypted)).toThrow();
  });

  it('produces different ciphertext for same plaintext (unique IV)', async () => {
    const { encrypt } = await import('../services/byok/encryption');
    const plaintext = 'sk-or-v1-same-key';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('extracts last four characters', async () => {
    const { extractLastFour } = await import('../services/byok/encryption');
    expect(extractLastFour('sk-or-v1-abcd1234')).toBe('1234');
    expect(extractLastFour('xy')).toBe('xy');
  });

  it('supports key rotation (decrypts with previous key)', async () => {
    const { encrypt, decrypt } = await import('../services/byok/encryption');
    const plaintext = 'sk-or-v1-rotate-me';

    const encrypted = encrypt(plaintext);

    const newKeyHex = randomBytes(32).toString('hex');
    process.env.BYOK_ENCRYPTION_KEY_PREVIOUS = TEST_KEY_HEX;
    process.env.BYOK_ENCRYPTION_KEY = newKeyHex;

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);

    process.env.BYOK_ENCRYPTION_KEY = TEST_KEY_HEX;
    delete process.env.BYOK_ENCRYPTION_KEY_PREVIOUS;
  });

  it('key never appears in API response shape', async () => {
    const { encrypt, extractLastFour } = await import('../services/byok/encryption');
    const fullKey = 'sk-or-v1-should-never-appear-in-response';
    const encrypted = encrypt(fullKey);
    const lastFour = extractLastFour(fullKey);

    const responseShape = {
      has_key: true,
      key_last_four: lastFour,
      key_status: 'valid',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
    };

    const serialized = JSON.stringify(responseShape);
    expect(serialized).not.toContain(fullKey);
    expect(serialized).toContain(lastFour);
  });
});
