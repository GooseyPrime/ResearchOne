/**
 * Standard research shows no evidence or courtroom words (14 Oct 2026).
 *
 * A standard run showed "weighing the evidence" on its run page. These checks
 * cover the places that wording came from: the run steps the homepage and the
 * run page draw, the stage labels, the role words, and messages already stored
 * in older runs, which are reworded when they are shown.
 */
import { describe, expect, it } from 'vitest';
import { RUN_STEPS, customerOptionsIn } from '../../content/customerOptions';
import { HOW_RESEARCHONE_THINKS_SHORT } from '../../content/howResearchOneThinks';
import { READER_STAGE_WORDS, readerStageLabel } from '../../lib/researchone/stageLabels';
import { PLAIN_ROLE_WORDS, plainLabel, plainProgressText } from '../../lib/researchone/plainWords';
import { TAB_LABELS } from '../../components/reports/reader/readerModel';

const COURTROOM = /\b(evidence|weigh(?:s|ing|ed)?|verdicts?|adjudicat\w*|prosecut\w*|cross[- ]examin\w*|courtroom)\b/i;

describe('standard research wording', () => {
  it('the reasoner step is "Analyze sources" on the homepage and the run page', () => {
    expect(RUN_STEPS.find((step) => step.id === 'reasoner')?.name).toBe('Analyze sources');
    for (const step of RUN_STEPS) {
      expect(`${step.name} ${step.description} ${step.example}`).not.toMatch(COURTROOM);
    }
  });

  it('no stage label, role word or report tab uses evidence or courtroom words', () => {
    for (const words of Object.values(READER_STAGE_WORDS)) expect(words).not.toMatch(COURTROOM);
    for (const words of Object.values(PLAIN_ROLE_WORDS)) expect(words).not.toMatch(COURTROOM);
    for (const words of Object.values(TAB_LABELS)) expect(words).not.toMatch(COURTROOM);
    expect(readerStageLabel('reasoner')).toBe('Analyzing the sources');
    expect(readerStageLabel('reasoning')).toBe('Analyzing the sources');
    expect(plainLabel('reasoner')).toBe('Source analysis');
  });

  it('report types, research objectives, plan fields and the plan-screen summary say sources', () => {
    for (const category of ['report_type', 'research_objective', 'plan_field', 'verdict'] as const) {
      for (const option of customerOptionsIn(category)) {
        expect(`${option.name} ${option.description}`).not.toMatch(COURTROOM);
      }
    }
    expect(HOW_RESEARCHONE_THINKS_SHORT).not.toMatch(COURTROOM);
    // Double-check is optional, so the summary does not list it as a step every run takes.
    expect(HOW_RESEARCHONE_THINKS_SHORT).toMatch(/When you turn on Double-check/);
  });

  it.each([
    ['Analyzing retrieved evidence...', 'Analyzing the sources that were found...'],
    ['Re-analyzing evidence after targeted re-discovery...', 'Analyzing the sources again after a targeted new search...'],
    ['Working through the evidence is not needed for this kind of request', 'Analyzing the sources is not needed for this kind of request'],
    ['Checking the report against the evidence...', 'Checking the report against its sources...'],
    ['Weighing the evidence', 'Analyzing the sources'],
    ['Supporting evidence was limited; writing the full report with the uncertainty clearly marked.', 'Supporting source material was limited; writing the full report with the uncertainty clearly marked.'],
    ['No independent evidence was found for a finding that needs verifying; stopping rather than guessing.', 'No independent source material was found for a finding that needs verifying; stopping rather than guessing.'],
    ['Added 4 more source passage(s) to the evidence for this run.', 'Added 4 more source passage(s) to the sources for this run.'],
    ['Evidence Reasoner finished', 'Source analyst finished'],
  ])('a message stored in an older run, "%s", is shown as "%s"', (stored, shown) => {
    expect(plainProgressText(stored)).toBe(shown);
    expect(plainProgressText(stored)).not.toMatch(COURTROOM);
  });

  it('leaves quoted words as written: a question or a source title is not product copy', () => {
    expect(plainProgressText('Searching for "evidence-based policing" studies')).toBe('Searching for "evidence-based policing" studies');
    expect(plainProgressText('Reading “The Evidence Act” and weighing the evidence')).toBe('Reading “The Evidence Act” and analyzing the sources');
  });

  it('leaves a message that has no such words unchanged', () => {
    expect(plainProgressText('Reasoning across sources...')).toBe('Reasoning across sources...');
  });
});
