import { describe, expect, it } from 'vitest';
import {
  cleanSourceTitle,
  decodeHtmlEntities,
  formatReference,
  formatReferenceList,
  resolveReferenceStyle,
  siteName,
  sourceKindInWords,
  type ReferenceSource,
} from '../services/formatting/referenceList';
import { readerFacingLabelHits } from '../services/formatting/reportPresentation';

const STUDY: ReferenceSource = {
  title: 'Historical construction costs of global nuclear power reactors',
  authors: ['Lovering, Jessica R.', 'Yip, Arthur', 'Nordhaus, Ted'],
  publisher: 'Energy Policy',
  date: '2016-04-01',
  url: 'https://doi.org/10.1016/j.enpol.2016.01.011',
  kind: 'peer-reviewed study',
};
const PAGE: ReferenceSource = {
  title: 'FDA Approves First Gene Therapies to Treat Patients with Sickle Cell Disease',
  url: 'https://www.fda.gov/news-events/press-announcements/fda-approves-first-gene-therapies',
  date: '2023-12-08',
  kind: 'web page',
  accessed: '2026-10-04',
};

describe('reference entries', () => {
  it('writes authors, title, publisher, date, kind and link in the numbered default', () => {
    expect(formatReference(STUDY)).toBe(
      'Jessica R. Lovering, Arthur Yip, and Ted Nordhaus. Historical construction costs of global nuclear power reactors. Energy Policy. 1 Apr 2016. Peer-reviewed study. https://doi.org/10.1016/j.enpol.2016.01.011'
    );
  });

  it('uses the site name for a page with no author or publisher, and the day it was read', () => {
    expect(formatReference(PAGE)).toBe(
      'fda.gov. FDA Approves First Gene Therapies to Treat Patients with Sickle Cell Disease. 8 Dec 2023. Web page. https://www.fda.gov/news-events/press-announcements/fda-approves-first-gene-therapies Accessed 4 Oct 2026.'
    );
  });

  it('leaves out what is not known and never says unknown', () => {
    const bare = formatReference({ title: 'Board minutes' });
    expect(bare).toBe('Board minutes.');
    for (const style of ['numeric', 'apa', 'mla', 'chicago-author-date', 'chicago-note', 'ieee', 'harvard'] as const) {
      const entry = formatReference({ title: 'Board minutes', kind: 'uploaded document' }, style);
      expect(entry).not.toMatch(/unknown|undefined|null|\(\s*\)|,\s*,|\.\s*\./i);
      expect(entry).toContain('Board minutes');
    }
  });

  it('shortens a long author list in the numbered default', () => {
    const entry = formatReference({ ...STUDY, authors: ['A One', 'B Two', 'C Three', 'D Four'] });
    expect(entry.startsWith('A One et al. Historical')).toBe(true);
  });

  it('does not double the full stop after a title that ends a sentence itself', () => {
    expect(formatReference({ title: 'Can America Build Nuclear Again?', publisher: 'AEI' })).toBe('AEI. Can America Build Nuclear Again?');
  });

  it('writes each named style in its own form, with the same facts', () => {
    expect(formatReference(STUDY, 'apa')).toBe(
      'Lovering, J. R., Yip, A., & Nordhaus, T. (2016, April 1). Historical construction costs of global nuclear power reactors. Energy Policy. https://doi.org/10.1016/j.enpol.2016.01.011'
    );
    expect(formatReference(STUDY, 'mla')).toBe(
      'Lovering, Jessica R., et al. "Historical construction costs of global nuclear power reactors." Energy Policy, 1 Apr. 2016, https://doi.org/10.1016/j.enpol.2016.01.011.'
    );
    expect(formatReference(STUDY, 'chicago-author-date')).toBe(
      'Lovering, Jessica R., Arthur Yip, and Ted Nordhaus. 2016. "Historical construction costs of global nuclear power reactors." Energy Policy. April 1. https://doi.org/10.1016/j.enpol.2016.01.011.'
    );
    expect(formatReference(STUDY, 'chicago-note')).toBe(
      'Jessica R. Lovering, Arthur Yip, and Ted Nordhaus, "Historical construction costs of global nuclear power reactors," Energy Policy, April 1, 2016, https://doi.org/10.1016/j.enpol.2016.01.011.'
    );
    expect(formatReference(STUDY, 'ieee')).toBe(
      'J. R. Lovering, A. Yip, and T. Nordhaus, "Historical construction costs of global nuclear power reactors," Energy Policy, Apr. 1, 2016. [Online]. Available: https://doi.org/10.1016/j.enpol.2016.01.011'
    );
    expect(formatReference(STUDY, 'harvard')).toBe(
      'Lovering, J. R., Yip, A., and Nordhaus, T. (2016) Historical construction costs of global nuclear power reactors. Energy Policy. Available at: https://doi.org/10.1016/j.enpol.2016.01.011'
    );
  });

  it('keeps a date that is not a calendar day as the source gave it', () => {
    expect(formatReference({ title: 'Report', publisher: 'Agency', date: 'December 2023' })).toBe('Agency. Report. December 2023.');
    expect(formatReference({ title: 'Report', publisher: 'Agency', date: 'December 2023' }, 'harvard')).toBe('Agency (2023) Report.');
    expect(formatReference({ title: 'Report', publisher: 'Agency' }, 'apa')).toBe('Agency. (n.d.). Report.');
  });

  it('numbers the list in the order given, one entry per line', () => {
    const list = formatReferenceList([PAGE, STUDY]);
    const lines = list.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('1. fda.gov.')).toBe(true);
    expect(lines[1].startsWith('2. Jessica R. Lovering')).toBe(true);
    expect(formatReferenceList([])).toBe('');
  });
});

describe('source details', () => {
  it('decodes markup left in a stored title', () => {
    expect(decodeHtmlEntities('CASGEVY&#x2122; (gene editing) &#8211; TIF &amp; partners')).toBe('CASGEVY™ (gene editing) – TIF & partners');
    expect(decodeHtmlEntities('AT&T; R&D &bogus; &#0;')).toBe('AT&T; R&D &bogus; &#0;');
  });

  it('takes the saving program and the file extension off a title', () => {
    expect(cleanSourceTitle('Microsoft Word - Nuclear Power Plant Construction Costs - July 2008.doc')).toBe('Nuclear Power Plant Construction Costs - July 2008');
    expect(cleanSourceTitle('  Annual\n report.pdf ')).toBe('Annual report');
    expect(cleanSourceTitle('Microsoft Word and the office market')).toBe('Microsoft Word and the office market');
  });

  it('names the site a page is on', () => {
    expect(siteName('https://www.fda.gov/x')).toBe('fda.gov');
    expect(siteName('not a url')).toBeNull();
    expect(siteName(null)).toBeNull();
  });

  it('names the kind of source from the provider and the address', () => {
    expect(sourceKindInWords({ provider: 'crossref', url: 'https://doi.org/10.1/x' })).toBe('peer-reviewed study');
    expect(sourceKindInWords({ provider: 'pmc', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/' })).toBe('peer-reviewed study');
    expect(sourceKindInWords({ url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/' })).toBe('peer-reviewed study');
    expect(sourceKindInWords({ url: 'https://www.ncbi.nlm.nih.gov/books/NBK1/' })).toBe('web page');
    expect(sourceKindInWords({ provider: 'arxiv', url: 'https://arxiv.org/pdf/2401.00001' })).toBe('preprint');
    expect(sourceKindInWords({ url: 'https://export.arxiv.org/abs/2401.00001' })).toBe('preprint');
    expect(sourceKindInWords({ provider: 'tavily', url: 'https://example.org/post' })).toBe('web page');
    expect(sourceKindInWords({ url: null, hasFile: true })).toBe('uploaded document');
    expect(sourceKindInWords({ url: null })).toBe('document');
  });

  it('falls back to the numbered default for a style it does not know', () => {
    expect(resolveReferenceStyle('APA')).toBe('apa');
    expect(resolveReferenceStyle(undefined)).toBe('numeric');
    expect(resolveReferenceStyle('vancouver')).toBe('numeric');
  });
});

describe('the reference list and the wording check', () => {
  it('does not treat a word in a source title as the report\'s own wording', () => {
    const report = '## Summary\nThe rule changed in 2019 [1].\n\n## References\n1. Agency. Health claims made on foods: the claim register. https://example.org/x\n\n## About this report\n1 source was read on 4 Oct 2026.';
    expect(readerFacingLabelHits(report)).toEqual([]);
    expect(readerFacingLabelHits('## Summary\nThe agency claims the rule changed [1].')).toContain('claims wording');
  });

  it('reads the report\'s own words, not a direct quotation or a term of the subject', () => {
    expect(readerFacingLabelHits('The group said "these claims are false" [2].')).toEqual([]);
    expect(readerFacingLabelHits('The first patent claim covers the method [1]. Insurance claims rose [2].')).toEqual([]);
    expect(readerFacingLabelHits('As noted by the quantitative quality auditor, samples differ [4].')).toContain('internal step');
    expect(readerFacingLabelHits('The evidence establishes that costs rose [1].')).toContain('courtroom');
    expect(readerFacingLabelHits('The planner at the utility chose one design [1].')).toEqual([]);
  });
});
