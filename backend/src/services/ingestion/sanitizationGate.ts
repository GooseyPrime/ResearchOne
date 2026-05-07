/**
 * Sanitization gate for Pipeline B ingestion per Section 8.
 *
 * Strips PII from research artifacts before sending to InTellMe.
 * The output must be deterministic (idempotent): same input produces
 * byte-equal output on every call.
 */

import { createHash } from 'crypto';

const METADATA_ALLOWLIST = new Set([
  'title',
  'abstract',
  'doi',
  'publication_date',
  'journal',
  'authors_count',
  'source_type',
  'language',
  'word_count',
  'section_count',
  'claim_count',
  'contradiction_count',
  'research_objective',
  'engine_version',
  'scite_institutional_status',
  'scite_supporting_count',
  'scite_contrasting_count',
  'scite_mentioning_count',
  'scite_contrasting_paper_dois',
  'scite_citation_section',
]);

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_REGEX = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;
const PRIVATE_URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)[^\s]*/gi;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;

export interface SanitizationInput {
  runId: string;
  reportMarkdown: string;
  claims: Array<{ text: string; source?: string; metadata?: Record<string, unknown> }>;
  contradictions: Array<{ text: string; metadata?: Record<string, unknown> }>;
  metadata: Record<string, unknown>;
  userDisplayName?: string;
}

export interface SanitizedOutput {
  runId: string;
  reportMarkdown: string;
  claims: Array<{ text: string; source?: string; metadata?: Record<string, unknown> }>;
  contradictions: Array<{ text: string; metadata?: Record<string, unknown> }>;
  metadata: Record<string, unknown>;
  contentHash: string;
}

function stripPii(text: string, userDisplayName?: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(EMAIL_REGEX, '[EMAIL_REDACTED]');
  cleaned = cleaned.replace(PHONE_REGEX, '[PHONE_REDACTED]');
  cleaned = cleaned.replace(PRIVATE_URL_REGEX, '[PRIVATE_URL_REDACTED]');
  cleaned = cleaned.replace(SSN_REGEX, '[SSN_REDACTED]');
  cleaned = cleaned.replace(CREDIT_CARD_REGEX, '[CC_REDACTED]');

  if (userDisplayName && userDisplayName.length > 2) {
    const escaped = userDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escaped, 'gi'), '[USER_REDACTED]');
  }

  return cleaned;
}

function filterMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (METADATA_ALLOWLIST.has(key)) {
      if (typeof value === 'string') {
        filtered[key] = stripPii(value);
      } else {
        filtered[key] = value;
      }
    }
  }
  return filtered;
}

/**
 * Sanitizes a research run artifact for Pipeline B ingestion.
 * Deterministic: same input always produces byte-equal output.
 */
export function sanitize(input: SanitizationInput): SanitizedOutput {
  const reportMarkdown = stripPii(input.reportMarkdown, input.userDisplayName);

  const claims = input.claims.map((c) => ({
    text: stripPii(c.text, input.userDisplayName),
    source: c.source,
    metadata: c.metadata ? filterMetadata(c.metadata) : undefined,
  }));

  const contradictions = input.contradictions.map((c) => ({
    text: stripPii(c.text, input.userDisplayName),
    metadata: c.metadata ? filterMetadata(c.metadata) : undefined,
  }));

  const metadata = filterMetadata(input.metadata);

  const canonical = JSON.stringify({ reportMarkdown, claims, contradictions, metadata });
  const contentHash = createHash('sha256').update(canonical).digest('hex');

  return {
    runId: input.runId,
    reportMarkdown,
    claims,
    contradictions,
    metadata,
    contentHash,
  };
}
