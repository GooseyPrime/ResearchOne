import { describe, expect, it } from 'vitest';
import {
  UNTITLED_RUN_LABEL,
  isReferenceTitle,
  runDisplayTitle,
} from '../utils/runDisplayTitle';

const REF = 'R1-20260823-1557-4K7Q2-9';

describe('runDisplayTitle', () => {
  it('prefers the server-written display_title', () => {
    expect(
      runDisplayTitle({ display_title: 'EU vs US device pathways', report_title: 'Report', run_ref: REF })
    ).toBe('EU vs US device pathways');
  });

  it('does not change a run’s name when its report finalises', () => {
    // display_title outranks report_title on purpose. A name that shifts under
    // the reader reads as a bug even when both values are correct.
    const inFlight = { display_title: 'EU vs US device pathways', run_ref: REF };
    const finished = { ...inFlight, report_title: 'Comparative Regulatory Analysis' };
    expect(runDisplayTitle(finished)).toBe(runDisplayTitle(inFlight));
  });

  it('falls back to the report title for a historical run', () => {
    // Migration 057 deliberately does not backfill, so every pre-057 run has a
    // NULL display_title and reaches the title deriveGeneratedReportTitle made.
    expect(runDisplayTitle({ display_title: null, report_title: 'Zero-Cost Comparison Sites', run_ref: REF }))
      .toBe('Zero-Cost Comparison Sites');
  });

  it('falls back to the run reference, which every run has', () => {
    expect(runDisplayTitle({ run_ref: REF })).toBe(REF);
    expect(runDisplayTitle({ display_title: null, report_title: null, run_ref: REF })).toBe(REF);
  });

  it('treats whitespace as absent rather than as a title', () => {
    expect(runDisplayTitle({ display_title: '   ', run_ref: REF })).toBe(REF);
  });

  it('never returns a prompt, even when the row carries one', () => {
    // The shipped defect. `title` and `query` are not inputs to this module,
    // so a caller cannot accidentally reintroduce them by passing the row.
    const row = {
      title: '# Research Objective: Identify and Rank the 20 Best Affiliate…',
      query: '# Research Objective: Identify and Rank the 20 Best Affiliate…',
      run_ref: REF,
    };
    expect(runDisplayTitle(row)).toBe(REF);
  });

  it('degrades to a label when even the reference is missing', () => {
    expect(runDisplayTitle({})).toBe(UNTITLED_RUN_LABEL);
    expect(runDisplayTitle(null)).toBe(UNTITLED_RUN_LABEL);
    expect(runDisplayTitle(undefined)).toBe(UNTITLED_RUN_LABEL);
  });
});

describe('isReferenceTitle', () => {
  it('reports whether the caller got a name or a reference', () => {
    expect(isReferenceTitle({ display_title: 'A name', run_ref: REF })).toBe(false);
    expect(isReferenceTitle({ report_title: 'A name', run_ref: REF })).toBe(false);
    expect(isReferenceTitle({ run_ref: REF })).toBe(true);
    expect(isReferenceTitle(null)).toBe(true);
  });
});
