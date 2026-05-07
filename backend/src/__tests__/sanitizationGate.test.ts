import { describe, expect, it } from 'vitest';
import { sanitize, type SanitizationInput } from '../services/ingestion/sanitizationGate';

function makeInput(overrides: Partial<SanitizationInput> = {}): SanitizationInput {
  return {
    runId: 'run_test',
    reportMarkdown: overrides.reportMarkdown ?? 'Clean report text.',
    claims: overrides.claims ?? [],
    contradictions: overrides.contradictions ?? [],
    metadata: overrides.metadata ?? {},
    userDisplayName: overrides.userDisplayName,
  };
}

describe('sanitizationGate', () => {
  describe('PII stripping', () => {
    it('strips email addresses', () => {
      const result = sanitize(makeInput({ reportMarkdown: 'Contact john@example.com for details.' }));
      expect(result.reportMarkdown).toBe('Contact [EMAIL_REDACTED] for details.');
      expect(result.reportMarkdown).not.toContain('john@example.com');
    });

    it('strips phone numbers', () => {
      const result = sanitize(makeInput({ reportMarkdown: 'Call (555) 123-4567 now.' }));
      expect(result.reportMarkdown).toContain('[PHONE_REDACTED]');
      expect(result.reportMarkdown).not.toContain('555');
    });

    it('strips private URLs (localhost, RFC1918)', () => {
      const result = sanitize(makeInput({ reportMarkdown: 'See http://192.168.1.1/admin for config.' }));
      expect(result.reportMarkdown).toContain('[PRIVATE_URL_REDACTED]');
      expect(result.reportMarkdown).not.toContain('192.168');
    });

    it('strips SSN patterns', () => {
      const result = sanitize(makeInput({ reportMarkdown: 'SSN is 123-45-6789.' }));
      expect(result.reportMarkdown).toContain('[SSN_REDACTED]');
      expect(result.reportMarkdown).not.toContain('123-45-6789');
    });

    it('strips user display name from claim text', () => {
      const result = sanitize(makeInput({
        claims: [{ text: 'John Smith found that X implies Y.' }],
        userDisplayName: 'John Smith',
      }));
      expect(result.claims[0].text).toContain('[USER_REDACTED]');
      expect(result.claims[0].text).not.toContain('John Smith');
    });

    it('strips credit card numbers', () => {
      const result = sanitize(makeInput({ reportMarkdown: 'Card 4111 1111 1111 1111 on file.' }));
      expect(result.reportMarkdown).toContain('[CC_REDACTED]');
      expect(result.reportMarkdown).not.toContain('4111');
    });

    it('strips PII from contradiction text', () => {
      const result = sanitize(makeInput({
        contradictions: [{ text: 'Researcher at admin@lab.org disagrees.' }],
      }));
      expect(result.contradictions[0].text).toContain('[EMAIL_REDACTED]');
    });
  });

  describe('metadata allowlist', () => {
    it('passes allowed metadata fields through', () => {
      const result = sanitize(makeInput({
        metadata: {
          title: 'Test Report',
          doi: '10.1234/test',
          scite_supporting_count: 5,
          scite_institutional_status: 'verified',
        },
      }));
      expect(result.metadata.title).toBe('Test Report');
      expect(result.metadata.doi).toBe('10.1234/test');
      expect(result.metadata.scite_supporting_count).toBe(5);
      expect(result.metadata.scite_institutional_status).toBe('verified');
    });

    it('strips non-allowed metadata fields', () => {
      const result = sanitize(makeInput({
        metadata: {
          title: 'Test',
          user_email: 'secret@test.com',
          internal_notes: 'private stuff',
        },
      }));
      expect(result.metadata.title).toBe('Test');
      expect(result.metadata).not.toHaveProperty('user_email');
      expect(result.metadata).not.toHaveProperty('internal_notes');
    });

    it('strips PII within allowed metadata string values', () => {
      const result = sanitize(makeInput({
        metadata: { title: 'Report by john@example.com' },
      }));
      expect(result.metadata.title).toBe('Report by [EMAIL_REDACTED]');
    });
  });

  describe('idempotency', () => {
    it('produces byte-equal output on repeated calls', () => {
      const input = makeInput({
        reportMarkdown: 'Contact test@email.com for info.',
        claims: [{ text: 'Claim with john@lab.org reference.' }],
        metadata: { title: 'Test', doi: '10.1/x', secret: 'hidden' },
        userDisplayName: 'Test User',
      });

      const first = sanitize(input);
      const second = sanitize(input);

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.contentHash).toBe(second.contentHash);
    });

    it('different inputs produce different hashes', () => {
      const a = sanitize(makeInput({ reportMarkdown: 'Report A' }));
      const b = sanitize(makeInput({ reportMarkdown: 'Report B' }));
      expect(a.contentHash).not.toBe(b.contentHash);
    });
  });

  describe('content hash', () => {
    it('is a 64-char hex SHA-256', () => {
      const result = sanitize(makeInput());
      expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
