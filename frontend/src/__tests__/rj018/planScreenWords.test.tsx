/** @vitest-environment jsdom */
/**
 * RJ-018 item 7. "How well we can research this" printed the planning model's
 * own vocabulary: "In-distribution for investigative research … Novelty lies in
 * future-facing assessment". The planning step is now told to write plain words
 * (held on the server by `rj018PlanPlainWords.test.ts`); this is the page's own
 * check on what it is given, and on what used to ride on that vocabulary.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlanConfirmationPanel from '../../components/research/PlanConfirmationPanel';
import { customerOption } from '../../content/customerOptions';
import { plainPlanNote, readPlanHardToResearch, shouldStartPlanAutoConfirmCountdown } from '../../utils/planAutoConfirm';

afterEach(() => cleanup());

const SHOWN_ON_9_OCT = 'In-distribution for investigative research. Novelty lies in future-facing assessment.';
const PLAIN = 'There is plenty of published material on this. Plans announced after this summer may not be online yet.';
const FIT = customerOption('plan_field', 'research_fit').name;

function renderPlan(topicAnalysis: Record<string, unknown>) {
  return render(
    <MemoryRouter>
      <PlanConfirmationPanel
        snapshot={{ runId: 'run-1', planId: 'plan-1', refinementRounds: 0, planPayload: { intent: { id: 'investigation', confidence: 0.92 }, orchestrationProfile: {}, topicAnalysis } }}
        busy={false}
        onBusy={vi.fn()}
        onAfterConfirm={vi.fn()}
        onAfterCancel={vi.fn()}
        onNotify={vi.fn()}
        planPrefs={null}
      />
    </MemoryRouter>
  );
}

describe('"How well we can research this"', () => {
  it('is named as the registry names it', () => {
    expect(FIT).toBe('How well we can research this');
  });

  it("does not print a note written in the planning model's vocabulary", () => {
    renderPlan({ summary: 'You want to know how the 2026 election is protected.', competenceAssessment: SHOWN_ON_9_OCT });
    const text = document.body.textContent ?? '';
    // On main the note was printed as sent.
    expect(text).not.toMatch(/in-distribution|novelty|future-facing assessment/i);
    expect(screen.queryByText(FIT)).toBeNull();
    expect(text).toContain('You want to know how the 2026 election is protected.');
  });

  it('prints a note written in plain words', () => {
    renderPlan({ summary: 'You want to know how the 2026 election is protected.', competenceAssessment: PLAIN });
    expect(screen.getByText(FIT)).toBeInTheDocument();
    expect(screen.getByText(PLAIN)).toBeInTheDocument();
  });

  it('the rule: plain words are kept, the model vocabulary and empty stand-ins are not', () => {
    expect(plainPlanNote(PLAIN)).toBe(PLAIN);
    for (const jargon of [SHOWN_ON_9_OCT, 'Out-of-distribution; flag OOD.', 'Well covered by the web-retrieval stack.', 'High epistemic risk.', 'Competence assessment unavailable.', 'Topic analysis unavailable.', '', null, undefined]) {
      expect(plainPlanNote(jargon), String(jargon)).toBe('');
    }
  });
});

describe('a plan on a hard subject still waits to be confirmed', () => {
  const prefs = { autoConfirmEnabled: true, autoConfirmThreshold: 0.85, confirmedStreak: 9 };
  const plan = (topicAnalysis: Record<string, unknown>) => ({ intent: { id: 'investigation', confidence: 0.95 }, topicAnalysis });

  it('reads the flag the plan now carries, since the note no longer says it in code words', () => {
    expect(readPlanHardToResearch(plan({ competenceAssessment: PLAIN, hardToResearch: true }))).toBe(true);
    expect(readPlanHardToResearch(plan({ competenceAssessment: PLAIN }))).toBe(false);
    // On main only the wording was read, so a plainly worded note let a hard plan confirm itself.
    expect(shouldStartPlanAutoConfirmCountdown(prefs, plan({ competenceAssessment: PLAIN, hardToResearch: true }), 0)).toBe(false);
    expect(shouldStartPlanAutoConfirmCountdown(prefs, plan({ competenceAssessment: PLAIN, hardToResearch: false }), 0)).toBe(true);
  });
});
