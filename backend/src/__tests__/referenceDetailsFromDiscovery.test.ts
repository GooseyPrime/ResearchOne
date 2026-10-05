/**
 * Who wrote and published a source, from the provider's record to the stored
 * source: read by the provider, kept on the candidate only when the citation
 * lock is on for the run, checked before it is stored.
 */
import { describe, expect, it } from 'vitest';
import { crossrefBibliographic } from '../services/discovery/providers/crossrefSearch';
import { openAlexBibliographic } from '../services/discovery/providers/openAlexSearch';
import { arxivBibliographic } from '../services/discovery/providers/arxivSearch';
import { pmcBibliographic } from '../services/discovery/providers/pubmedCentralSearch';
import { bibliographicMetadata, candidateForRun, isCalendarDay, isoFromParts, type SearchResultCandidate } from '../services/discovery/providerTypes';
import { bibliographicRecord, storedBibliographic } from '../services/ingestion/ingestionService';
import { citationLockEnabled, runWithFlags } from '../config';

describe('what each provider record says', () => {
  it('reads authors, journal and a full date from Crossref', () => {
    expect(
      crossrefBibliographic({
        author: [{ given: 'Jessica R.', family: 'Lovering' }, { name: 'Breakthrough Institute' }, { given: 'Ted' }],
        publisher: 'Elsevier BV',
        'container-title': ['Energy Policy'],
        issued: { 'date-parts': [[2016, 4, 1]] },
      })
    ).toEqual({ authors: ['Lovering, Jessica R.', 'Breakthrough Institute'], publisher: 'Energy Policy', publishedAt: '2016-04-01' });
  });

  it('reads what Crossref says the work is, and says nothing for a type it does not know', () => {
    expect(crossrefBibliographic({ publisher: 'Elsevier BV', type: 'journal-article' })?.kind).toBe('journal article');
    expect(crossrefBibliographic({ publisher: 'OSF', type: 'posted-content' })?.kind).toBe('preprint');
    expect(crossrefBibliographic({ publisher: 'Dryad', type: 'dataset' })?.kind).toBe('dataset');
    expect(crossrefBibliographic({ publisher: 'Springer', type: 'book-chapter' })?.kind).toBe('book chapter');
    expect(crossrefBibliographic({ publisher: 'X', type: 'component' })?.kind).toBeUndefined();
    expect(crossrefBibliographic({ publisher: 'X' })?.kind).toBeUndefined();
  });

  it('gives no date for a day that does not exist', () => {
    expect(crossrefBibliographic({ publisher: 'X', issued: { 'date-parts': [[2023, 2, 31]] } })).toEqual({ publisher: 'X' });
    expect(isoFromParts([2023, 2, 28])).toBe('2023-02-28');
    expect(isoFromParts([2024, 2, 29])).toBe('2024-02-29');
    expect(isoFromParts([2023, 2, 29])).toBeUndefined();
    expect(isCalendarDay('2023-04-31')).toBe(false);
    expect(isCalendarDay('2023-04-30')).toBe(true);
    expect(isCalendarDay('2023-4-30')).toBe(false);
  });

  it('gives no date when Crossref gives only a year or a month', () => {
    expect(crossrefBibliographic({ publisher: 'Elsevier BV', issued: { 'date-parts': [[2016]] } })).toEqual({ publisher: 'Elsevier BV' });
    expect(crossrefBibliographic({ publisher: 'Elsevier BV', issued: { 'date-parts': [[2016, 4]] } })).toEqual({ publisher: 'Elsevier BV' });
    expect(crossrefBibliographic({})).toBeUndefined();
    expect(isoFromParts([2016, 13, 1])).toBeUndefined();
    expect(isoFromParts([2016, 2, 0])).toBeUndefined();
  });

  it('reads authors, venue and date from OpenAlex', () => {
    expect(
      openAlexBibliographic({
        authorships: [{ author: { display_name: 'Arnulf Grubler' } }, { author: {} }],
        primary_location: { source: { display_name: 'Energy Policy' } },
        publication_date: '2010-09-01',
      })
    ).toEqual({ authors: ['Arnulf Grubler'], publisher: 'Energy Policy', publishedAt: '2010-09-01' });
    expect(openAlexBibliographic({ primary_location: null, publication_date: '2010' })).toBeUndefined();
    expect(openAlexBibliographic({ publication_date: '2010-02-30' })).toBeUndefined();
    // An "article" is a journal article only when its venue is a journal.
    expect(openAlexBibliographic({ type: 'article', primary_location: { source: { display_name: 'Energy Policy', type: 'journal' } } })?.kind).toBe('journal article');
    expect(openAlexBibliographic({ type: 'article', primary_location: { source: { display_name: 'SSRN', type: 'repository' } } })?.kind).toBeUndefined();
    expect(openAlexBibliographic({ type: 'preprint', primary_location: { source: { display_name: 'SSRN', type: 'repository' } } })?.kind).toBe('preprint');
  });

  it('reads authors and the posting day from arXiv, one author or many', () => {
    expect(arxivBibliographic({ author: [{ name: 'A.  One' }, { name: 'B Two' }], published: '2024-01-05T18:00:00Z' })).toEqual({
      publisher: 'arXiv',
      kind: 'preprint',
      authors: ['A. One', 'B Two'],
      publishedAt: '2024-01-05',
    });
    expect(arxivBibliographic({ author: { name: 'Solo Author' } })).toEqual({ publisher: 'arXiv', kind: 'preprint', authors: ['Solo Author'] });
  });

  it('reads PubMed Central authors and journal, and a date only when it states a day', () => {
    expect(pmcBibliographic({ authors: [{ name: 'Frangoul H' }, { name: '' }], fulljournalname: 'New England Journal of Medicine', pubdate: '2021 Jan 21' })).toEqual({
      authors: ['Frangoul H'],
      publisher: 'New England Journal of Medicine',
      publishedAt: '2021-01-21',
      kind: 'journal article',
    });
    expect(pmcBibliographic({ source: 'N Engl J Med', pubdate: '2021 Jan' })).toEqual({ publisher: 'N Engl J Med', kind: 'journal article' });
    expect(pmcBibliographic({ source: 'N Engl J Med', pubdate: '2021 Feb 30' })).toEqual({ publisher: 'N Engl J Med', kind: 'journal article' });
    expect(pmcBibliographic({ pubdate: '2021' })).toBeUndefined();
  });
});

describe('what a run keeps', () => {
  const candidate: SearchResultCandidate = {
    url: 'https://doi.org/10.1/x',
    title: 'A study',
    snippet: '',
    score: 1,
    rank: 1,
    provider: 'crossref',
    sourceQuery: 'q',
    bibliographic: { authors: ['Lovering, Jessica R.'], publisher: 'Energy Policy', publishedAt: '2016-04-01' },
  };

  it('keeps reference details only with the citation lock on', () => {
    const off = candidateForRun(candidate, false);
    expect('bibliographic' in off).toBe(false);
    // Exactly the fields a candidate had before reference details existed.
    expect(Object.keys(off).sort()).toEqual(['provider', 'rank', 'score', 'snippet', 'sourceQuery', 'title', 'url']);
    expect(bibliographicMetadata(off)).toEqual({});
    expect(candidateForRun(candidate, true)).toBe(candidate);
  });

  it('queues the provider with the details it found', () => {
    expect(bibliographicMetadata(candidate)).toEqual({
      bibliographic: { authors: ['Lovering, Jessica R.'], publisher: 'Energy Policy', publishedAt: '2016-04-01', provider: 'crossref' },
    });
  });

  it('reads the lock from the switches of the run, and needs both', () => {
    expect(citationLockEnabled()).toBe(false);
    expect(runWithFlags({ CITATION_LOCK_ENABLED: true }, () => citationLockEnabled())).toBe(false);
    expect(runWithFlags({ CITATION_LOCK_ENABLED: true, BASELINE_LAYER_ENABLED: true }, () => citationLockEnabled())).toBe(true);
  });
});

describe('what is stored', () => {
  it('stores nothing when the job carried no reference details', () => {
    expect(storedBibliographic({ discovery_run_id: 'r1' })).toBeNull();
    expect(storedBibliographic(undefined)).toBeNull();
    expect(storedBibliographic({ bibliographic: 'Lovering' })).toBeNull();
    expect(storedBibliographic({ bibliographic: { provider: 'crossref' } })).toBeNull();
  });

  it('keeps well-formed values and drops the rest', () => {
    expect(
      storedBibliographic({
        bibliographic: { authors: ['  Lovering, Jessica R. ', 7, ''], publisher: ' Energy Policy ', publishedAt: '2016-04-01', provider: 'crossref' },
      })
    ).toEqual({ authors: ['Lovering, Jessica R.'], publisher: 'Energy Policy', publishedAt: '2016-04-01', kind: null, provider: 'crossref' });
    expect(storedBibliographic({ bibliographic: { authors: 'Lovering', publisher: 3, publishedAt: '2016' } })).toBeNull();
    expect(storedBibliographic({ bibliographic: { publisher: 'Energy Policy', publishedAt: 'April 2016' } })).toEqual({
      authors: null,
      publisher: 'Energy Policy',
      publishedAt: null,
      kind: null,
      provider: null,
    });
  });

  it('never hands the database a day that does not exist', () => {
    // 31 February parses to 3 March in JavaScript and is refused by Postgres, which would fail the whole job.
    expect(storedBibliographic({ bibliographic: { publisher: 'Energy Policy', publishedAt: '2023-02-31' } })?.publishedAt).toBeNull();
    expect(storedBibliographic({ bibliographic: { publisher: 'Energy Policy', publishedAt: '2023-02-28' } })?.publishedAt).toBe('2023-02-28');
  });

  it('keeps the kind and provider only in the form they are issued in, and stores the checked record', () => {
    const checked = storedBibliographic({ bibliographic: { publisher: 'Energy Policy', kind: 'Journal Article', provider: 'OpenAlex', extra: { nested: true } } });
    expect(checked).toEqual({ authors: null, publisher: 'Energy Policy', publishedAt: null, kind: 'journal article', provider: 'openalex' });
    expect(bibliographicRecord(checked!)).toEqual({ provider: 'openalex', kind: 'journal article', publisher: 'Energy Policy' });
    expect(storedBibliographic({ bibliographic: { publisher: 'X', kind: '<script>', provider: 'bad provider!' } })).toEqual({
      authors: null,
      publisher: 'X',
      publishedAt: null,
      kind: null,
      provider: null,
    });
  });
});
