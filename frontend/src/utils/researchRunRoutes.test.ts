import { describe, expect, it } from 'vitest';
import {
  dossierReportUrlForRun,
  failedRunReportUrl,
  liveResearchUrl,
  parseRunIdFromSearchParams,
  researchPagePathForEngine,
  researchPagePathForRun,
} from './researchRunRoutes';

describe('dossierReportUrlForRun', () => {
  it('uses dossier id path with report hash', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(dossierReportUrlForRun(id)).toBe(`/app/dossiers/${id}#report`);
  });
});

describe('researchPagePathForEngine', () => {
  it('routes v2 runs to Deep Research', () => {
    expect(researchPagePathForEngine('v2')).toBe('/app/research-v2');
  });

  it('routes non-v2 runs to Standard research', () => {
    expect(researchPagePathForEngine(undefined)).toBe('/app/research');
    expect(researchPagePathForEngine('v1')).toBe('/app/research');
    expect(researchPagePathForEngine(null)).toBe('/app/research');
  });
});

describe('researchPagePathForRun', () => {
  it('uses engine_version on the run row', () => {
    expect(researchPagePathForRun({ engine_version: 'v2' })).toBe('/app/research-v2');
    expect(researchPagePathForRun({ engine_version: null })).toBe('/app/research');
  });
});

describe('parseRunIdFromSearchParams', () => {
  it('returns trimmed runId when present', () => {
    const params = new URLSearchParams('runId=abc-123&foo=bar');
    expect(parseRunIdFromSearchParams(params)).toBe('abc-123');
  });

  it('returns null for missing or blank runId', () => {
    expect(parseRunIdFromSearchParams(new URLSearchParams())).toBeNull();
    expect(parseRunIdFromSearchParams(new URLSearchParams('runId='))).toBeNull();
    expect(parseRunIdFromSearchParams(new URLSearchParams('runId=%20%20'))).toBeNull();
  });
});

describe('liveResearchUrl', () => {
  const id = 'run-uuid-1';

  it('builds standard research deep link', () => {
    expect(liveResearchUrl(id)).toBe(`/app/research?runId=${encodeURIComponent(id)}`);
  });

  it('builds v2 deep link with optional plan hash', () => {
    expect(liveResearchUrl(id, { engineVersion: 'v2', focusPlan: true })).toBe(
      `/app/research-v2?runId=${encodeURIComponent(id)}#plan`
    );
  });
});

describe('failedRunReportUrl', () => {
  it('points at the run diagnostics page', () => {
    expect(failedRunReportUrl('x')).toBe('/app/reports/run/x');
  });
});
