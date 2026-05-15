/**
 * Wave 5.4 — client-side eligibility for plan auto-confirm (mirrors Wave-5.md intent;
 * competence strings are free-form LLM output, so this is a conservative heuristic).
 */
export const PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT = 5;

const OOD_HINT_PATTERNS: RegExp[] = [
  /\bout[-\s]?of[-\s]?distribution\b/i,
  /\bo\.?\s*o\.?\s*d\.?\b/i,
  /\bhighly novel\b/i,
  /\bnovel topic\b/i,
  /\bunfamiliar domain\b/i,
  /\boutside (the )?(typical|usual) scope\b/i,
  /\bnot in[-\s]distribution\b/i,
  /\bpoorly supported\b.*\bweb\b/i,
  /\b(edge of|beyond) (our|the) (training|breadth|stack)\b/i,
  /\b(high|elevated) (epistemic )?risk\b/i,
];

/** When true, suppress auto-confirm and show the full gate (Wave 5.4 OOD rule). */
export function suppressPlanAutoConfirmFromCompetence(competenceAssessment: string): boolean {
  const t = competenceAssessment.trim();
  if (!t) return false;
  return OOD_HINT_PATTERNS.some((r) => r.test(t));
}

export function readPlanIntentConfidence(planPayload: Record<string, unknown>): number | null {
  const intent = planPayload.intent as Record<string, unknown> | undefined;
  const raw = intent?.confidence;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function readTopicCompetenceAssessment(planPayload: Record<string, unknown>): string {
  const topic = planPayload.topicAnalysis as Record<string, unknown> | undefined;
  const v = topic?.competenceAssessment;
  return typeof v === 'string' ? v : '';
}

export interface PlanAutoConfirmPrefsSlice {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number;
  confirmedStreak: number;
}

/** Wave 5.4 — gate still renders; countdown only when prefs resolved and eligibility holds. */
export function shouldStartPlanAutoConfirmCountdown(
  prefs: PlanAutoConfirmPrefsSlice | null | undefined,
  planPayload: Record<string, unknown>,
  refinementRounds: number
): boolean {
  if (!prefs?.autoConfirmEnabled) return false;
  if (prefs.confirmedStreak < PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT) return false;
  if (refinementRounds > 0) return false;
  const c = readPlanIntentConfidence(planPayload);
  if (c == null || c < prefs.autoConfirmThreshold) return false;
  if (suppressPlanAutoConfirmFromCompetence(readTopicCompetenceAssessment(planPayload))) return false;
  return true;
}
