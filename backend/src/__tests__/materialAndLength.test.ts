import { describe, expect, it, vi } from 'vitest';
import { resolveReportWordTarget, synthesisLengthArgs, userChosenWordTarget } from '../services/reasoning/reportGenerator';
import { digestRetrievedMaterial, gateFallbackStep, materialStep, readerInsufficientMessage } from '../services/reasoning/materialSufficiency';
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
    expect(materialStep({ judgement: { sufficient: true, reason: 'The date is in the material.', missing: [] }, judgeFailed: false, discoveryAvailable: true, extraPassUsed: false })).toBe('proceed');
  });

  it('searches once when the server allows it even if the profile omits discovery', () => {
    expect(materialStep({ judgement: { sufficient: false, reason: 'The date is not here.', missing: ['The authorization date'] }, judgeFailed: false, discoveryAvailable: true, extraPassUsed: false })).toBe('discover_once');
  });

  it('says search ran and does not tell the reader to turn search on when it is unavailable', () => {
    expect(readerInsufficientMessage(['the authorization date'], 'search_ran')).toContain('Outside search ran and did not find enough');
    expect(readerInsufficientMessage(['the authorization date'], 'search_ran')).toContain('narrow the request');
    expect(readerInsufficientMessage(['the authorization date'], 'search_unavailable')).not.toMatch(/turn on|outside search/i);
    expect(readerInsufficientMessage(['the authorization date'], 'search_unavailable')).toContain('Add sources');
  });

  it('does not treat a sealed corpus as a reason to skip the judgement', () => {
    expect(materialStep({ judgement: { sufficient: false, reason: 'The run material does not answer.', missing: ['The date'] }, judgeFailed: false, discoveryAvailable: false, extraPassUsed: true })).toBe('stop');
  });

  it('keeps a later chunk in the judge input', () => {
    const chunks = Array.from({ length: 20 }, (_, index) => ({ label: `Source ${index}`, text: (index === 19 ? 'LATE-CHUNK-MARKER ' : '') + 'x'.repeat(500) }));
    const digest = digestRetrievedMaterial(chunks);
    expect(digest.length).toBeGreaterThan(8000);
    expect(digest).toContain('LATE-CHUNK-MARKER');
  });

  it('uses the existing evidence check when both judge calls fail', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    expect(materialStep({ judgement: null, judgeFailed: true, discoveryAvailable: true, extraPassUsed: false })).toBe('use_gate');
    expect(gateFallbackStep('rediscover', true, false)).toBe('discover_once');
    logger.warn('material_judgement_fell_back_to_source_gate', { action: 'sufficient', reason: 'sufficient' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a length nobody chose does not block growth to fit requested items', () => {
  it('treats only a user choice as explicit', () => {
    expect(userChosenWordTarget(4000, 'user')).toBe(4000);
    expect(userChosenWordTarget(4000, undefined)).toBe(4000);
    expect(userChosenWordTarget(undefined, undefined)).toBeUndefined();
    expect(userChosenWordTarget(105, 'planner')).toBeUndefined();
    expect(userChosenWordTarget(2200, 'default')).toBeUndefined();
  });

  it('passes the writer exactly what the user sent when the switch is off', () => {
    const decision = { target: 2200, source: 'user' as const };
    expect(synthesisLengthArgs(false, undefined, decision)).toEqual({ targetWordCount: undefined });
    expect(synthesisLengthArgs(false, 4000, decision)).toEqual({ targetWordCount: 4000 });
    expect(synthesisLengthArgs(true, undefined, { target: 105, source: 'planner' })).toEqual({ targetWordCount: 105, lengthSource: 'planner' });
  });
});
