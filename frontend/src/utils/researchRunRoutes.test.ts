import { describe, expect, it } from 'vitest';
import {
  dossierReportUrlForRun,
  failedRunReportUrl,
  liveResearchUrl,
  parsePrefillRunIdFromSearchParams,
  requestPrefillUrl,
  parseRunIdFromSearchParams,
} from './researchRunRoutes';

describe('dossierReportUrlForRun', () => {
  it('uses dossier id path with report hash', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(dossierReportUrlForRun(id)).toBe(`/app/dossiers/${id}#report`);
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

  it('points at the run’s own workspace, not the request page', () => {
    // It used to return `/app/research?runId=…`, which `ResearchPage` then
    // redirected to `/app/run/…` — except with `#plan`, where it stayed put.
    // Which page a click landed on depended on the run's state at that moment.
    expect(liveResearchUrl(id)).toBe(`/app/run/${encodeURIComponent(id)}`);
  });

  it('keeps #plan meaning “take me to the gate”', () => {
    // The gate renders at id="plan" inside the workspace, so the anchor
    // resolves without a second navigation.
    expect(liveResearchUrl(id, { focusPlan: true })).toBe(
      `/app/run/${encodeURIComponent(id)}#plan`
    );
  });

  it('encodes a run id that needs it', () => {
    expect(liveResearchUrl('a/b?c')).toBe('/app/run/a%2Fb%3Fc');
  });
});

describe('requestPrefillUrl', () => {
  it('carries a run back to the request page so cancel does not discard it', () => {
    expect(requestPrefillUrl('run-9')).toBe('/app/research?prefill=run-9');
  });

  it('round-trips through the parser', () => {
    const url = new URL(requestPrefillUrl('run-9'), 'https://x.test');
    expect(parsePrefillRunIdFromSearchParams(url.searchParams)).toBe('run-9');
  });

  it('treats a blank prefill param as absent', () => {
    expect(parsePrefillRunIdFromSearchParams(new URLSearchParams('prefill='))).toBeNull();
    expect(parsePrefillRunIdFromSearchParams(new URLSearchParams('prefill=%20'))).toBeNull();
  });
});

describe('failedRunReportUrl', () => {
  it('points at the run diagnostics page', () => {
    expect(failedRunReportUrl('x')).toBe('/app/reports/run/x');
  });
});
