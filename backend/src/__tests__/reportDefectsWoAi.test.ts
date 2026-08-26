/**
 * WO-AI — the six defects the operator found in a real report, 2026-08-25.
 *
 * Every case here is something he saw on screen, not something I imagined a
 * pipeline could do:
 *
 *   AI-1  headings that read "16.16" and "18.18"
 *   AI-2  prose where the request asked for a table
 *   AI-3  a table that stops at 13 rows and continues underneath as text
 *   AI-4  nine sources for a long, detail-heavy report
 *   AI-5  a Reddit depression review and a bacteriology paper in a market report
 *   AI-6  sources whose title is their own URL
 */
import { describe, expect, it } from 'vitest';

import {
  composeItemHeading,
  extractItemName,
  stripLeadingOrdinal,
  stripLeadingSectionHeading,
  parseRefinedSections,
} from '../services/reasoning/reportGenerator';
import {
  checkTableContract,
  findOrphanTableRows,
  resolveTableExpectation,
} from '../services/reasoning/tableContract';
import { resolveSourceIngestBudget, MAX_SOURCES_PER_RUN } from '../services/discovery/sourceBudget';
import {
  partitionByRelevance,
  scoreCandidateRelevance,
  selectByRelevance,
  topicTerms,
} from '../services/discovery/candidateRelevance';
import {
  looksLikePdf,
  parseHtmlToContent,
  titleFromUrl,
  titleIsJustTheUrl,
} from '../services/ingestion/ingestionService';

describe('AI-1 — a section is numbered once', () => {
  it('drops the ordinal the drafter put on its own item name', () => {
    const { itemName } = extractItemName('ITEM NAME: 16. Vertical SaaS for dental labs\n\nBody text.');
    expect(itemName).toBe('Vertical SaaS for dental labs');
    expect(composeItemHeading({ ordinal: 16, label: 'Opportunity', itemName })).toBe(
      '16. Vertical SaaS for dental labs'
    );
  });

  it.each([
    ['16. Name', 'Name'],
    ['16.1 Name', 'Name'],
    ['16) Name', 'Name'],
    ['#16 — Name', 'Name'],
    ['Item 18: Name', 'Name'],
    ['Opportunity 3 — Name', 'Name'],
  ])('strips %s', (input, expected) => {
    expect(stripLeadingOrdinal(input)).toBe(expected);
  });

  it('leaves a name that IS a number alone', () => {
    // "3. 2024" is correct output: the item is numbered 3 and it is about 2024.
    expect(stripLeadingOrdinal('2024')).toBe('2024');
    expect(composeItemHeading({ ordinal: 3, label: 'Year', itemName: '2024' })).toBe('3. 2024');
  });

  it.each([
    'ISO 27001: Security controls',
    'Type 2: Diabetes care',
    'GPT 4: Enterprise automation',
    'Section 508: Accessibility',
  ])('does not eat the subject of %s', (name) => {
    // The prefix allowance was `[A-Za-z][A-Za-z ]{0,20}`, which matched any
    // short word before a number — so these names were reduced to whatever
    // followed the colon, corrupting the heading it was meant to fix.
    expect(stripLeadingOrdinal(name)).toBe(name);
  });

  it("removes the drafter's copy of the heading the assembler will add", () => {
    expect(stripLeadingSectionHeading('## 16. Vertical SaaS\n\nBody text.', '16. Vertical SaaS')).toBe(
      'Body text.'
    );
    // Numbering and punctuation are set aside when comparing.
    expect(stripLeadingSectionHeading('### Vertical SaaS!\n\nBody.', '16. Vertical SaaS')).toBe('Body.');
    expect(stripLeadingSectionHeading('### 概述\n\n正文。', '概述')).toBe('正文。');
  });

  it('keeps a leading subsection heading that is NOT the section title', () => {
    // The first version removed any leading heading of any level, so a section
    // opening with `### Risks` kept its text and lost its label.
    const body = '### Risks\n\nSome risks.';
    expect(stripLeadingSectionHeading(body, '4. Vertical SaaS')).toBe(body);
    expect(stripLeadingSectionHeading('#### Implementation details\n\nBody.', 'Overview')).toBe(
      '#### Implementation details\n\nBody.'
    );
    expect(stripLeadingSectionHeading('### 风险\n\n正文。', '概述')).toBe('### 风险\n\n正文。');
  });

  it('keeps headings that are further down the section', () => {
    const body = 'Opening paragraph.\n\n### Risks\n\nSome risks.';
    expect(stripLeadingSectionHeading(body, 'Overview')).toBe(body);
  });

  it('keeps a body that is nothing but a heading rather than blanking the section', () => {
    expect(stripLeadingSectionHeading('## Only a heading', 'Only a heading')).toBe('## Only a heading');
  });

  it('strips a refiner heading at any level when it repeats the section title', () => {
    const titles = new Map([['summary', '4. Summary']]);
    const refined = parseRefinedSections(
      '<<<SECTION key="summary">>>\n### 4. Summary\n\nReal body.\n<<<END SECTION>>>',
      titles
    );
    expect(refined.get('summary')).toBe('Real body.');
  });

  it('leaves a refiner subsection heading alone', () => {
    const titles = new Map([['summary', '4. Summary']]);
    const refined = parseRefinedSections(
      '<<<SECTION key="summary">>>\n### Risks\n\nReal body.\n<<<END SECTION>>>',
      titles
    );
    expect(refined.get('summary')).toBe('### Risks\n\nReal body.');
  });
});

describe('AI-2 / AI-3 — a requested table is a table, whole', () => {
  const TRUNCATED = [
    '| Rank | Niche | Score |',
    '| --- | --- | --- |',
    '| 1 | A | 9 |',
    '| 2 | B | 8 |',
    '',
    'Continuing:',
    '| 3 | C | 7 |',
    '| 4 | D | 6 |',
  ].join('\n');

  it('flags rows that fell out of the table and continued as text', () => {
    const orphans = findOrphanTableRows(TRUNCATED);
    expect(orphans.length).toBe(2);
    expect(orphans[0]).toContain('| 3 | C | 7 |');
  });

  it('fails the contract on a truncated table instead of counting the fragment', () => {
    const issues = checkTableContract(TRUNCATED, { required: true, expectedRowCount: 4 });
    expect(issues.map((i) => i.code)).toContain('table_truncated');
  });

  it('does not mistake ordinary prose for a stranded row', () => {
    const prose = 'We compared A and B. Throughput | latency tradeoffs are discussed below.';
    expect(findOrphanTableRows(prose)).toEqual([]);
  });

  it('does not flag a table inside a fenced code block', () => {
    const fenced = ['```', '| a | b | c |', '| 1 | 2 | 3 |', '```'].join('\n');
    expect(findOrphanTableRows(fenced)).toEqual([]);
  });

  it('requires a table when the user asked for one as a FORMAT, not only in the brief', () => {
    // The drafter was told to emit a table by the requested format; the auditor
    // read only the brief, so choosing "Comparison table" instructed the writer
    // and verified nothing.
    const withoutFormat = resolveTableExpectation({ requestedArtifacts: [] }, 20);
    expect(withoutFormat.required).toBe(false);

    const withFormat = resolveTableExpectation({ requestedArtifacts: [] }, 20, ['comparison_table']);
    expect(withFormat.required).toBe(true);
    expect(withFormat.expectedRowCount).toBe(20);

    expect(checkTableContract('Just prose, no table here.', withFormat).map((i) => i.code)).toContain(
      'table_missing'
    );
  });

  it('still requires nothing when no table was asked for anywhere', () => {
    const expectation = resolveTableExpectation({ requestedArtifacts: [] }, undefined, ['narrative_briefing']);
    expect(expectation.required).toBe(false);
    expect(checkTableContract('Prose.', expectation)).toEqual([]);
  });
});

describe('AI-4 — the source budget follows the size of the deliverable', () => {
  it('gives a long report more than the flat ten sources', () => {
    // The operator's report: long-form, and nine sources. The cap was ten.
    expect(resolveSourceIngestBudget({ configuredCap: 10, targetWordCount: 7000 })).toBeGreaterThan(10);
  });

  it('gives a twenty-item deliverable at least a source per item', () => {
    expect(
      resolveSourceIngestBudget({ configuredCap: 10, requestedArtifactCount: 20 })
    ).toBeGreaterThanOrEqual(20);
  });

  it('never drops below the configured baseline for an ordinary run', () => {
    expect(resolveSourceIngestBudget({ configuredCap: 10 })).toBe(10);
    expect(resolveSourceIngestBudget({ configuredCap: 10, targetWordCount: 800 })).toBe(10);
  });

  it('respects a hard ceiling so a huge request cannot run the cost away', () => {
    expect(
      resolveSourceIngestBudget({ configuredCap: 10, targetWordCount: 100_000, requestedArtifactCount: 500 })
    ).toBe(MAX_SOURCES_PER_RUN);
  });

  it('keeps an add-on override that is higher', () => {
    expect(resolveSourceIngestBudget({ configuredCap: 10, addonCapOverride: 25 })).toBe(25);
  });
});

describe('AI-5 — a source has to be about the request', () => {
  const QUERY = 'affiliate marketing niches with high income potential for solo operators';

  const OFF_TOPIC = [
    { title: 'A scoping review of depression discourse on Reddit', snippet: 'mental health forum analysis', url: 'https://example.test/a' },
    { title: 'Identification of Enterobacteriaceae from clinical isolates', snippet: 'gram-negative bacilli', url: 'https://example.test/b' },
    { title: 'HPLC quantification of nitrite in cured meats', snippet: 'chromatography assay', url: 'https://example.test/c' },
  ];
  const ON_TOPIC = [
    { title: 'The highest-income affiliate marketing niches in 2026', snippet: 'commission rates by niche', url: 'https://example.test/d' },
    { title: 'Solo operator affiliate income benchmarks', snippet: 'marketing revenue per niche', url: 'https://example.test/e' },
    { title: 'Choosing an affiliate niche: demand and competition', snippet: 'marketing niches compared', url: 'https://example.test/f' },
  ];

  it('separates the bacteriology paper from the market sources', () => {
    const { onTopic, offTopic } = partitionByRelevance(QUERY, [...OFF_TOPIC, ...ON_TOPIC]);
    expect(onTopic.map((c) => c.url)).toEqual(ON_TOPIC.map((c) => c.url));
    expect(offTopic.map((c) => c.url)).toEqual(OFF_TOPIC.map((c) => c.url));
  });

  it('judges relevance from the words, not from which provider returned it', () => {
    const terms = topicTerms(QUERY);
    expect(scoreCandidateRelevance(terms, ON_TOPIC[0]!).onTopic).toBe(true);
    expect(scoreCandidateRelevance(terms, OFF_TOPIC[1]!).onTopic).toBe(false);
  });

  it('matches singular and plural forms of the same word', () => {
    const terms = topicTerms('battery recycling capacity');
    expect(scoreCandidateRelevance(terms, { title: 'Batteries recycling capacities in the EU' }).onTopic).toBe(true);
  });

  it('accepts everything when the query has no topic words to match', () => {
    const { onTopic, offTopic } = partitionByRelevance('the and of', ON_TOPIC);
    expect(offTopic).toEqual([]);
    expect(onTopic.length).toBe(ON_TOPIC.length);
  });

  it('does not let off-topic candidates fill the rest of the ingest budget', () => {
    // The first version appended every off-topic candidate after the on-topic
    // ones, and the selection loop runs until it has `maxIngest` sources — so
    // a large run with three relevant results still fetched and embedded the
    // rest, recreating the failure the filter exists to prevent.
    const { ranked, dropped, toppedUpUrls } = selectByRelevance(QUERY, [...ON_TOPIC, ...OFF_TOPIC], 3);
    expect(ranked.map((c) => c.url)).toEqual(ON_TOPIC.map((c) => c.url));
    expect(dropped).toBe(OFF_TOPIC.length);
    expect(toppedUpUrls.size).toBe(0);
  });

  it('tops up with off-topic candidates only as far as the floor', () => {
    // Starving a run of sources is the other failure. One on-topic result and
    // a floor of three means exactly two off-topic results are borrowed.
    const { ranked, dropped, toppedUpUrls } = selectByRelevance(
      QUERY,
      [ON_TOPIC[0]!, ...OFF_TOPIC],
      3
    );
    expect(ranked).toHaveLength(3);
    expect(toppedUpUrls.size).toBe(2);
    expect(dropped).toBe(OFF_TOPIC.length - 2);
  });
  it('needs only one match on a very short query', () => {
    const terms = topicTerms('tokamak');
    expect(scoreCandidateRelevance(terms, { title: 'Tokamak confinement scaling' }).onTopic).toBe(true);
    expect(scoreCandidateRelevance(terms, { title: 'Sourdough hydration ratios' }).onTopic).toBe(false);
  });
});

describe('AI-6 — a source is never titled with its own address', () => {
  it('recognises a URL masquerading as a title', () => {
    expect(titleIsJustTheUrl('https://arxiv.org/pdf/2204.08880v1', 'https://arxiv.org/pdf/2204.08880v1')).toBe(true);
    expect(titleIsJustTheUrl('', 'https://arxiv.org/pdf/2204.08880v1')).toBe(true);
    expect(titleIsJustTheUrl('Scaling laws for neural language models', 'https://arxiv.org/pdf/2204.08880v1')).toBe(false);
  });

  it('names an identifier-only path by where it came from', () => {
    expect(titleFromUrl('https://arxiv.org/pdf/2204.08880v1')).toBe('arxiv.org 2204.08880v1');
  });

  it('turns a readable slug into readable words', () => {
    expect(titleFromUrl('https://www.example.com/blog/affiliate-marketing-niches-2026.html')).toBe(
      'affiliate marketing niches 2026 (example.com)'
    );
  });

  it('never stores the address as the title when a page has no <title>', () => {
    // The check that actually runs on ingest, not just the helper it calls.
    const url = 'https://arxiv.org/pdf/2204.08880v1';
    const parsed = parseHtmlToContent('%PDF-1.5 binary-ish body with no title tag', url);
    expect(parsed.title).not.toBe(url);
    expect(parsed.title).toBe('arxiv.org 2204.08880v1');
  });

  it('keeps a real page title', () => {
    const parsed = parseHtmlToContent(
      '<html><head><title>Affiliate niche benchmarks</title></head><body>x</body></html>',
      'https://example.com/whatever'
    );
    expect(parsed.title).toBe('Affiliate niche benchmarks');
  });

  it('knows a PDF from a page by its first bytes, not by its path', () => {
    // `https://arxiv.org/pdf/2204.08880v1` has no extension, and
    // `https://example.com/pdf/guide.html` has the wrong one — guessing from
    // the path gets both of them wrong in opposite directions.
    expect(looksLikePdf(null, Buffer.from('%PDF-1.5\n...'))).toBe(true);
    expect(looksLikePdf('application/pdf; charset=binary')).toBe(true);
    expect(looksLikePdf('text/html', Buffer.from('<html><body>pdf</body></html>'))).toBe(false);
    expect(looksLikePdf(null, Buffer.from('<html>/pdf/ guide</html>'))).toBe(false);
    expect(looksLikePdf(null)).toBe(false);
  });
});
