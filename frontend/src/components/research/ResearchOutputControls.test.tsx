/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchOutputControls, { normalizeReportFormats, resolveTargetWordCount } from './ResearchOutputControls';

describe('ResearchOutputControls', () => {
  afterEach(() => cleanup());

  it('renders compact controls including citation style', () => {
    render(
      <ResearchOutputControls
        objective="AUTO"
        onObjectiveChange={vi.fn()}
        reportFormats={['automatic']}
        onReportFormatsChange={vi.fn()}
        reportLengthPreset="automatic"
        onReportLengthPresetChange={vi.fn()}
        reportLengthCustom={2200}
        onReportLengthCustomChange={vi.fn()}
        citationStyle="apa"
        onCitationStyleChange={vi.fn()}
        compact
      />
    );

    expect(screen.getByText('Research Objective')).toBeInTheDocument();
    expect(screen.getByText('Report Format')).toBeInTheDocument();
    expect(screen.getByText('Report Length')).toBeInTheDocument();
    expect(screen.getByText('Citation Style')).toBeInTheDocument();
    expect(screen.getByText('Automatic')).toBeInTheDocument();
  });

  it('makes automatic format mutually exclusive', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ResearchOutputControls
        objective="AUTO"
        onObjectiveChange={vi.fn()}
        reportFormats={['automatic']}
        onReportFormatsChange={onChange}
        reportLengthPreset="automatic"
        onReportLengthPresetChange={vi.fn()}
        reportLengthCustom={2200}
        onReportLengthCustomChange={vi.fn()}
      />
    );

    fireEvent.click(within(container).getByRole('button', { name: 'Ranked options' }));
    expect(onChange).toHaveBeenCalledWith(['ranked_options']);
  });

  it('shows custom length input and clamps word count helper', () => {
    const { container } = render(
      <ResearchOutputControls
        objective="AUTO"
        onObjectiveChange={vi.fn()}
        reportFormats={['automatic']}
        onReportFormatsChange={vi.fn()}
        reportLengthPreset="custom"
        onReportLengthPresetChange={vi.fn()}
        reportLengthCustom={15000}
        onReportLengthCustomChange={vi.fn()}
      />
    );

    expect(within(container).getByRole('spinbutton')).toBeInTheDocument();
    expect(resolveTargetWordCount('standard', 2200)).toBe(2200);
    expect(resolveTargetWordCount('automatic', 2200)).toBeUndefined();
    expect(resolveTargetWordCount('custom', 15000)).toBe(12000);
    expect(resolveTargetWordCount('custom', 700)).toBe(800);
    expect(normalizeReportFormats(['automatic', 'comparison_table'])).toEqual(['automatic']);
  });

  it('can hide the research objective control', () => {
    render(
      <ResearchOutputControls
        objective="AUTO"
        onObjectiveChange={vi.fn()}
        showObjective={false}
        reportFormats={['automatic']}
        onReportFormatsChange={vi.fn()}
        reportLengthPreset="automatic"
        onReportLengthPresetChange={vi.fn()}
        reportLengthCustom={2200}
        onReportLengthCustomChange={vi.fn()}
      />
    );

    expect(screen.queryByText('Research Objective')).not.toBeInTheDocument();
    expect(screen.getByText('Report Format')).toBeInTheDocument();
  });
});
