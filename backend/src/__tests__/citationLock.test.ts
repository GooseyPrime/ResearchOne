import { describe, expect, test } from 'vitest';
import { citationRows, formatReference, issueAliases, renderReaderCitations, sectionAliasContext, sourceCountSetsStatus, unknownAliases } from '../services/reasoning/citationLock';
import { resolveDoi, retractionAllowsCitation } from '../services/verification/doiResolve';
import { readerFacingLabelHits, stripInternalLabelsFromReport } from '../services/formatting/reportPresentation';
import { judgeReportQuality } from '../services/eval/reportQualityJudge';
import { REPORT_QUALITY_PROMPT } from '../services/eval/reportQualityPrompt';

const chunks = [
  { id: 'c1', content: 'The treaty was signed in 1992.', source_url: 'https://example.edu/a', source_title: 'Treaty note', authors: 'Ada Lovelace', provider: 'crossref', doi: '10.1000/a' },
  { id: 'c2', content: 'A later page restates the date.', source_url: 'https://example.edu/a', source_title: 'Treaty note', authors: 'Ada Lovelace', provider: 'crossref' },
  { id: 'c3', content: 'The archive lists the same year.', source_url: 'https://news.example/b', source_title: 'Archive', source_publisher: null, provider: 'web' },
];

describe('slice 4 citation lock', () => {
  test('a section is given only the quotes it may cite', () => {
    const aliases = issueAliases(chunks);
    const context = sectionAliasContext(aliases);
    expect(context).toContain('[E1]');
    expect(context).toContain('The treaty was signed in 1992.');
    expect(context).not.toContain('Evidence Tier');
  });

  test('an alias the section was not given is unknown', () => {
    expect(unknownAliases('Signed in 1992. [E9]', issueAliases(chunks))).toEqual(['E9']);
  });

  test('three passages from two sources render two numbers in first-citation order', () => {
    const aliases = issueAliases(chunks);
    const rendered = renderReaderCitations('First [E1]. Again [E2]. Other [E3].', aliases);
    expect(rendered.markdown).toContain('[1](#passage-c1)');
    expect(rendered.markdown).toContain('[1](#passage-c2)');
    expect(rendered.markdown).toContain('[2](#passage-c3)');
    expect(rendered.references.split('\n')).toHaveLength(2);
    expect(rendered.markers).toHaveLength(3);
    expect(new Set(rendered.markers.map((marker) => marker.chunkId)).size).toBe(3);
  });

  test('a web page without authors shows its site name and no unknown', () => {
    const alias = issueAliases(chunks)[2];
    const entry = formatReference(1, alias, 'numeric', '2 Oct 2026');
    expect(entry).toContain('news.example');
    expect(entry).toContain('Accessed 2 Oct 2026');
    expect(entry.toLowerCase()).not.toContain('unknown');
  });

  test('a chosen style changes the reference line', () => {
    const alias = issueAliases(chunks)[0];
    expect(formatReference(1, alias, 'apa', '2 Oct 2026')).toContain('Ada Lovelace');
    expect(formatReference(1, alias, 'numeric', '2 Oct 2026')).toMatch(/^1\./);
  });

  test('a failed binding does not publish an empty reference list', () => {
    const rendered = renderReaderCitations('Cited [E9].', issueAliases(chunks));
    expect(rendered.references).toBe('');
    expect(rendered.markdown).not.toContain('[E9]');
    expect(citationRows('Cited [E9].', issueAliases(chunks))).toHaveLength(0);
  });

  test('source count does not set status on a switched-on non-adjudicative run', () => {
    expect(sourceCountSetsStatus(true, false)).toBe(false);
    expect(sourceCountSetsStatus(false, false)).toBe(true);
    expect(sourceCountSetsStatus(true, true)).toBe(true);
  });
});

describe('slice 4 doi', () => {
  test('200 passes, 404 fails support, 405 then 200 passes', async () => {
    const ok = await resolveDoi('10.1/ok', async () => ({ status: 200 }));
    const missing = await resolveDoi('10.1/missing', async () => ({ status: 404 }));
    const calls: string[] = [];
    const retried = await resolveDoi('10.1/retry', async (_url, method) => {
      calls.push(method);
      return method === 'HEAD' ? { status: 405 } : { status: 200 };
    });
    expect(ok.status).toBe('resolved');
    expect(missing.status).toBe('unresolved');
    expect(retried.status).toBe('resolved');
    expect(calls).toEqual(['HEAD', 'GET']);
  });

  test('a retracted source cannot be cited without the retraction in the sentence', () => {
    expect(retractionAllowsCitation('A 2019 study reported it.', 'retracted')).toBe(false);
    expect(retractionAllowsCitation('A 2019 study, since retracted, reported it.', 'retracted')).toBe(true);
  });
});

describe('slice 4 reader labels', () => {
  test('chunk markers and grade labels fail the check; ordinary words pass', () => {
    expect(readerFacingLabelHits('See [Chunk 12] and [Chunks 2, 13].')).toContain('chunk marker');
    expect(readerFacingLabelHits('CHUNK 4 was used. (Strong_Evidence)')).toEqual(expect.arrayContaining(['chunk marker', 'grade label']));
    expect(readerFacingLabelHits('The testimony and the inference agree.')).toEqual([]);
    expect(stripInternalLabelsFromReport('Signed [Chunk 12]. (Testimony)')).not.toMatch(/Chunk|Testimony/);
  });
});

describe('slice 4 quality judge', () => {
  test('a clean report scores above the same report with each defect', async () => {
    const recorded: Record<string, string> = {
      clean: '{"answer_first":5,"readable_structure":5,"plain_neutral_prose":5,"citation_clarity":5,"honest_disagreement":5,"appropriate_length":5}',
      labels: '{"answer_first":4,"readable_structure":4,"plain_neutral_prose":2,"citation_clarity":3,"honest_disagreement":4,"appropriate_length":4}',
      chunk: '{"answer_first":4,"readable_structure":4,"plain_neutral_prose":4,"citation_clarity":2,"honest_disagreement":4,"appropriate_length":4}',
      repeat: '{"answer_first":3,"readable_structure":3,"plain_neutral_prose":3,"citation_clarity":3,"honest_disagreement":3,"appropriate_length":3}',
      none: '{"answer_first":4,"readable_structure":4,"plain_neutral_prose":4,"citation_clarity":1,"honest_disagreement":4,"appropriate_length":4}',
    };
    const call = async (options: { messages: Array<{ content: string }> }) => ({
      content: recorded[options.messages[1].content],
      role: 'verifier',
      model: 'recorded',
      provider: 'recorded',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    });
    expect(REPORT_QUALITY_PROMPT).toMatch(/grade label/);
    const clean = await judgeReportQuality('clean', call as never);
    const labels = await judgeReportQuality('labels', call as never);
    const chunk = await judgeReportQuality('chunk', call as never);
    const repeat = await judgeReportQuality('repeat', call as never);
    const none = await judgeReportQuality('none', call as never);
    expect(clean && labels && chunk && repeat && none).toBeTruthy();
    expect(clean!.mean).toBeGreaterThan(labels!.mean);
    expect(clean!.mean).toBeGreaterThan(chunk!.mean);
    expect(clean!.mean).toBeGreaterThan(repeat!.mean);
    expect(clean!.mean).toBeGreaterThan(none!.mean);
  });
});
