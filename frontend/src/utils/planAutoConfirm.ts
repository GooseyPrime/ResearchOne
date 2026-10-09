/**
 * the revision-spinoff pass — client-side eligibility for plan auto-confirm (mirrors Wave-5.md intent;
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

/** When true, suppress auto-confirm and show the full gate (the revision-spinoff pass OOD rule). */
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

/**
 * RJ-018 — the plan now records difficulty as a flag (`hardToResearch`), because
 * the note beside it is written in plain words and no longer carries the
 * phrases `OOD_HINT_PATTERNS` reads.
 */
export function readPlanHardToResearch(planPayload: Record<string, unknown>): boolean {
  const topic = planPayload.topicAnalysis as Record<string, unknown> | undefined;
  return topic?.hardToResearch === true;
}

/**
 * Words of the planning model's own vocabulary that the plan screen printed
 * under "How well we can research this" ("In-distribution for investigative
 * research … Novelty lies in future-facing assessment").
 */
const PLANNING_JARGON =
  /\b(?:in[-\s]distribution|out[-\s]of[-\s]distribution|o\.?o\.?d\.?|distribution(?:al)?\s+shift|novelty|web[-\s]retrieval|retrieval\s+(?:stack|pipeline|system)|research\s+stack|corpus|training\s+data|epistemic|multi[-\s]layer(?:ed)?|orchestration|llm|tokens?)\b/i;
/** Stand-ins the server stores when the planning step wrote nothing; they tell a customer nothing. */
const PLACEHOLDER_NOTE = /^(?:competence assessment unavailable|topic analysis unavailable|unknown\b.*not parseable)\.?$/i;

/** A plan note as the plan screen prints it: the note when it is in plain words, otherwise nothing. */
export function plainPlanNote(note: string | null | undefined): string {
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text || PLANNING_JARGON.test(text) || PLACEHOLDER_NOTE.test(text)) return '';
  return text;
}

export interface PlanAutoConfirmPrefsSlice {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number;
  confirmedStreak: number;
}

/** the revision-spinoff pass — gate still renders; countdown only when prefs resolved and eligibility holds. */
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
  if (readPlanHardToResearch(planPayload)) return false;
  if (suppressPlanAutoConfirmFromCompetence(readTopicCompetenceAssessment(planPayload))) return false;
  return true;
}
