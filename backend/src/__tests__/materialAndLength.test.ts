import { describe, expect, it, vi } from 'vitest';
import { resolveReportWordTarget } from '../services/reasoning/reportGenerator';
import { gateFallbackStep, materialStep, readerInsufficientMessage } from '../services/reasoning/materialSufficiency';
import { logger } from '../utils/logger';

describe('report length when the user did not choose one', () => {
  it('uses a single-fact plan estimate and keeps a chosen length', () => {
    const fitted = resolveReportWordTarget({ estimatedLength: { minWords: 60, maxWords: 150 } });
    expect(fitted.source).toBe('planner');
    expect(fitted.target).toBeLessThan(200);
    const chosen = resolveReportWordTarget({ userTarget: 4000, estimatedLength: { minWords: 60, maxWords: 150 } });
    expect(chosen).toEqual({ target: 4000, source: 'user' });
  });

  it('uses the standard default and logs it when the plan has no estimate', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const missing = resolveReportWordTarget({});
    expect(missing).toEqual({ target: 2200, source: 'default' });
    logger.warn('report_length_defaulted', { target: missing.target, reason: 'plan_missing_estimated_length' });
    expect(warn).toHaveBeenCalledWith('report_length_defaulted', expect.objectContaining({ target: 2200 }));
    warn.mockRestore();
  });
});

describe('material judgement before a report is written', () => {
  it('does not search again when the material can answer', () => {
    expect(materialStep({ judgement: { sufficient: true, reason: 'The date is in the material.', missing: [] }, judgeFailed: false, discoveryAvailable: true, extraPassUsed: false, corpusSealedByDesign: false })).toBe('proceed');
  });

  it('searches once when the material cannot answer and outside search is available', () => {
    expect(materialStep({ judgement: { sufficient: false, reason: 'The date is not here.', missing: ['The authorization date'] }, judgeFailed: false, discoveryAvailable: true, extraPassUsed: false, corpusSealedByDesign: false })).toBe('discover_once');
    expect(materialStep({ judgement: { sufficient: false, reason: 'Still missing.', missing: ['The authorization date'] }, judgeFailed: false, discoveryAvailable: true, extraPassUsed: true, corpusSealedByDesign: false })).toBe('stop');
  });

  it('stops with a reader message when outside search is not part of the run', () => {
    expect(materialStep({ judgement: { sufficient: false, reason: 'Not enough.', missing: ['The authorization date'] }, judgeFailed: false, discoveryAvailable: false, extraPassUsed: false, corpusSealedByDesign: false })).toBe('stop');
    expect(readerInsufficientMessage(['the authorization date'], false)).toContain('Outside search was not part of this run');
    expect(readerInsufficientMessage(['the authorization date'], false)).not.toMatch(/discovery|chunk|stage/i);
  });

  it('uses the existing evidence check when both judge calls fail', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    expect(materialStep({ judgement: null, judgeFailed: true, discoveryAvailable: true, extraPassUsed: false, corpusSealedByDesign: false })).toBe('use_gate');
    expect(gateFallbackStep('rediscover', true, false)).toBe('discover_once');
    expect(gateFallbackStep('sufficient', false, false)).toBe('proceed');
    logger.warn('material_judgement_fell_back_to_source_gate', { action: 'sufficient', reason: 'sufficient' });
    expect(warn).toHaveBeenCalledWith('material_judgement_fell_back_to_source_gate', expect.any(Object));
    warn.mockRestore();
  });

  it('does not treat a sealed corpus as insufficient', () => {
    expect(materialStep({ judgement: { sufficient: false, reason: 'Sealed.', missing: [] }, judgeFailed: false, discoveryAvailable: false, extraPassUsed: false, corpusSealedByDesign: true })).toBe('proceed');
  });
});
