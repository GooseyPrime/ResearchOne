import { describe, expect, it } from 'vitest';
import { redactPii } from '../middleware/errorHandler';

describe('observability', () => {
  describe('PII redaction', () => {
    it('redacts email addresses', () => {
      expect(redactPii('Error for user john@example.com')).toBe('Error for user [EMAIL_REDACTED]');
    });

    it('redacts Bearer tokens', () => {
      expect(redactPii('Authorization: Bearer sk-or-v1-abc123def456xyz')).toContain('[TOKEN_REDACTED]');
      expect(redactPii('Authorization: Bearer sk-or-v1-abc123def456xyz')).not.toContain('abc123');
    });

    it('redacts OpenRouter key fragments', () => {
      expect(redactPii('Key: sk-or-v1-abcdef123456')).toContain('[KEY_REDACTED]');
    });

    it('redacts Stripe webhook secrets', () => {
      expect(redactPii('Secret: whsec_abc123def456')).toContain('[SECRET_REDACTED]');
    });

    it('redacts generic sk- key prefixes including hyphenated formats', () => {
      const result = redactPii('API key sk-proj-abc123-def456');
      expect(result).toContain('[KEY_REDACTED]');
      expect(result).not.toContain('abc123');
      expect(result).not.toContain('def456');
    });

    it('handles multiple PII types in one string', () => {
      const input = 'User john@test.com with key sk-or-v1-secret123';
      const result = redactPii(input);
      expect(result).not.toContain('john@test.com');
      expect(result).not.toContain('secret123');
    });

    it('preserves non-PII content', () => {
      const input = 'Research run failed at stage planning with error code 500';
      expect(redactPii(input)).toBe(input);
    });
  });

  describe('health endpoint additions', () => {
    it('health.ts exports buildHealth', async () => {
      const healthModule = await import('../api/routes/health');
      expect(healthModule.buildHealth).toBeTypeOf('function');
    });
  });

  describe('middleware exports', () => {
    it('errorHandler exports centralErrorHandler and redactPii', async () => {
      const mod = await import('../middleware/errorHandler');
      expect(mod.centralErrorHandler).toBeTypeOf('function');
      expect(mod.redactPii).toBeTypeOf('function');
    });

    it('requestLogger exports requestLoggerMiddleware', async () => {
      const mod = await import('../middleware/requestLogger');
      expect(mod.requestLoggerMiddleware).toBeTypeOf('function');
    });
  });
});
