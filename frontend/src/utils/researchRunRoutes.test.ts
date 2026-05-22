import { describe, expect, it } from 'vitest';
import {
  DEEP_RESEARCH_ENGINE_QUERY,
  DEEP_RESEARCH_PAGE_URL,
  RESEARCH_PAGE_PATH,
  dossierReportUrlForRun,
  failedRunReportUrl,
  isDeepResearchFromSearchParams,
  isDeepResearchEngine,
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
  it('always uses the unified research path', () => {
    expect(researchPagePathForEngine('v2')).toBe(RESEARCH_PAGE_PATH);
    expect(researchPagePathForEngine(undefined)).toBe(RESEARCH_PAGE_PATH);
    expect(researchPagePathForEngine('v1')).toBe(RESEARCH_PAGE_PATH);
    expect(researchPagePathForEngine(null)).toBe(RESEARCH_PAGE_PATH);
  });
});

describe('researchPagePathForRun', () => {
  it('uses unified path regardless of engine_version', () => {
    expect(researchPagePathForRun({ engine_version: 'v2' })).toBe(RESEARCH_PAGE_PATH);
    expect(researchPagePathForRun({ engine_version: null })).toBe(RESEARCH_PAGE_PATH);
  });
});

describe('isDeepResearchFromSearchParams', () => {
  it('detects engine=v2 query param', () => {
    expect(isDeepResearchFromSearchParams(new URLSearchParams('engine=v2'))).toBe(true);
    expect(isDeepResearchFromSearchParams(new URLSearchParams())).toBe(false);
    expect(isDeepResearchFromSearchParams(new URLSearchParams('engine=v1'))).toBe(false);
  });
});

describe('isDeepResearchEngine', () => {
  it('matches backend engine_version v2', () => {
    expect(isDeepResearchEngine('v2')).toBe(true);
    expect(isDeepResearchEngine('v1')).toBe(false);
    expect(isDeepResearchEngine(undefined)).toBe(false);
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

  it('builds v2 deep link with engine query and optional plan hash', () => {
    expect(liveResearchUrl(id, { engineVersion: 'v2', focusPlan: true })).toBe(
      `/app/research?runId=${encodeURIComponent(id)}&engine=${DEEP_RESEARCH_ENGINE_QUERY}#plan`
    );
  });
});

describe('DEEP_RESEARCH_PAGE_URL', () => {
  it('opens unified page in deep mode', () => {
    expect(DEEP_RESEARCH_PAGE_URL).toBe('/app/research?engine=v2');
  });
});

describe('failedRunReportUrl', () => {
  it('points at the run diagnostics page', () => {
    expect(failedRunReportUrl('x')).toBe('/app/reports/run/x');
  });
});
