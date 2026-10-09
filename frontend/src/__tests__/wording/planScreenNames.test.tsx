/** @vitest-environment jsdom */
/**
 * The plan screen (RJ-017). It is where Brandon was shown a feature name with
 * no explanation. Every name on it now comes with what it does and an example.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlanConfirmationPanel from '../../components/research/PlanConfirmationPanel';
import { DOUBLE_CHECK, customerOption, customerOptionHelp, customerOptionsIn } from '../../content/customerOptions';

afterEach(() => cleanup());

function renderPlan(intentId: string, profile: Record<string, unknown>) {
  return render(
    <MemoryRouter>
      <PlanConfirmationPanel
        snapshot={{
          runId: 'run-1',
          planId: 'plan-1',
          refinementRounds: 0,
          planPayload: {
            intent: { id: intentId, displayLabel: 'A name the server sent', confidence: 0.92 },
            orchestrationProfile: profile,
            topicAnalysis: { summary: 'Whether a statement about paper ballots is true.' },
          },
        }}
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

describe('the plan screen', () => {
  it('names the checking step Double-check and says, with the example, what it does', () => {
    renderPlan('adjudication', { name: 'Adjudication', doubleCheckMode: 'gate', strongestFormMode: 'standard' });
    const block = screen.getByTestId('plan-double-check');
    expect(block).toHaveTextContent(DOUBLE_CHECK.name);
    expect(block).toHaveTextContent(DOUBLE_CHECK.description);
    expect(block).toHaveTextContent(DOUBLE_CHECK.example);
    // How it applies to this report, each with its own description and example.
    expect(block).toHaveTextContent(customerOption('check_timing', 'gate').name);
    expect(block).toHaveTextContent(customerOptionHelp(customerOption('check_timing', 'gate')));
    expect(block).toHaveTextContent(customerOptionHelp(customerOption('restatement_style', 'standard')));
  });

  it('shows the report type by its plain name, with its description and example, never the name the server sent', () => {
    renderPlan('adjudication', { name: 'Adjudication', doubleCheckMode: 'gate', strongestFormMode: 'standard' });
    const type = customerOption('report_type', 'adjudication');
    expect(screen.getAllByText(type.name).length).toBeGreaterThan(0);
    expect(screen.getByText(type.description)).toBeInTheDocument();
    expect(screen.getByText(`Example: ${type.example}`)).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Adjudication|A name the server sent/);
    expect(text).not.toMatch(/challenge pass|epistemic|posture|\bintent\b|refinement rounds|competence/i);
  });

  it('offers every other report type by its registry name and explains the one picked', () => {
    renderPlan('factual_report', { doubleCheckMode: 'annotate', strongestFormMode: 'off' });
    const select = screen.getByLabelText(customerOption('plan_field', 'change_report_type').name);
    const offered = [...select.querySelectorAll('option')].filter((option) => option.value).map((option) => option.value);
    expect(offered.sort()).toEqual(
      customerOptionsIn('report_type')
        .map((option) => option.id)
        .filter((id) => id !== 'factual_report' && id !== 'legacy')
        .sort()
    );
    fireEvent.change(select, { target: { value: 'timeline' } });
    expect(screen.getByTestId('report-type-choice-help')).toHaveTextContent(customerOptionHelp(customerOption('report_type', 'timeline')));
  });

  it('a report type or a way of checking it has no words for is not shown by its id', () => {
    renderPlan('some_new_type', { doubleCheckMode: 'some_new_mode', strongestFormMode: 'another_new_mode' });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/some_new_type|some_new_mode|another_new_mode|new mode/i);
    expect(text).toContain('Some new type');
    expect(screen.getByTestId('plan-double-check')).toHaveTextContent(DOUBLE_CHECK.description);
  });
});
