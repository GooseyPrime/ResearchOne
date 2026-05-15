import { describe, expect, it } from 'vitest';
import { dossierReportUrlForRun } from './researchRunRoutes';

describe('dossierReportUrlForRun', () => {
  it('uses dossier id path with report hash', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(dossierReportUrlForRun(id)).toBe(`/app/dossiers/${id}#report`);
  });
});
