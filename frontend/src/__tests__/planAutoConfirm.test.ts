import { describe, expect, it } from 'vitest';
import {
  PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT,
  readPlanIntentConfidence,
  readTopicCompetenceAssessment,
  shouldStartPlanAutoConfirmCountdown,
  suppressPlanAutoConfirmFromCompetence,
} from '../utils/planAutoConfirm';

describe('planAutoConfirm', () => {
  it('exposes streak constant for UI hint parity with Wave 5.4', () => {
    expect(PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT).toBe(5);
  });

  it('suppresses auto-confirm when competence text signals OOD', () => {
    expect(suppressPlanAutoConfirmFromCompetence('Out-of-distribution topic for web retrieval.')).toBe(true);
    expect(suppressPlanAutoConfirmFromCompetence('Highly novel domain with limited corroboration.')).toBe(true);
  });

  it('does not suppress on empty or in-distribution phrasing', () => {
    expect(suppressPlanAutoConfirmFromCompetence('')).toBe(false);
    expect(suppressPlanAutoConfirmFromCompetence('   ')).toBe(false);
    expect(suppressPlanAutoConfirmFromCompetence('In-distribution; standard news and policy sources apply.')).toBe(false);
  });

  it('reads intent confidence from plan payload', () => {
    expect(readPlanIntentConfidence({ intent: { confidence: 0.91 } })).toBe(0.91);
    expect(readPlanIntentConfidence({ intent: { confidence: '0.88' } })).toBe(0.88);
    expect(readPlanIntentConfidence({})).toBeNull();
  });

  it('reads competence assessment from topicAnalysis', () => {
    expect(readTopicCompetenceAssessment({ topicAnalysis: { competenceAssessment: 'OK' } })).toBe('OK');
    expect(readTopicCompetenceAssessment({})).toBe('');
  });

  it('shouldStartPlanAutoConfirmCountdown respects streak, threshold, refinements, OOD', () => {
    const prefsOk = { autoConfirmEnabled: true, autoConfirmThreshold: 0.85, confirmedStreak: 5 };
    const payload = {
      intent: { id: 'survey', confidence: 0.9 },
      topicAnalysis: { competenceAssessment: 'In-distribution topic.' },
    };
    expect(shouldStartPlanAutoConfirmCountdown(prefsOk, payload, 0)).toBe(true);
    expect(shouldStartPlanAutoConfirmCountdown(prefsOk, payload, 1)).toBe(false);
    expect(shouldStartPlanAutoConfirmCountdown({ ...prefsOk, confirmedStreak: 4 }, payload, 0)).toBe(false);
    expect(shouldStartPlanAutoConfirmCountdown({ ...prefsOk, autoConfirmEnabled: false }, payload, 0)).toBe(false);
    expect(shouldStartPlanAutoConfirmCountdown(undefined, payload, 0)).toBe(false);
    expect(
      shouldStartPlanAutoConfirmCountdown(
        prefsOk,
        { ...payload, intent: { id: 'survey', confidence: 0.5 } },
        0
      )
    ).toBe(false);
    expect(
      shouldStartPlanAutoConfirmCountdown(
        prefsOk,
        {
          intent: { id: 'survey', confidence: 0.9 },
          topicAnalysis: { competenceAssessment: 'Highly novel — out-of-distribution.' },
        },
        0
      )
    ).toBe(false);
  });
});
