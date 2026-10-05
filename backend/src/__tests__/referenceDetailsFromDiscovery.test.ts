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
import { bibliographicMetadata, candidateForRun, isoFromParts, type SearchResultCandidate } from '../services/discovery/providerTypes';
import { storedBibliographic } from '../services/ingestion/ingestionService';
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
  });

  it('reads authors and the posting day from arXiv, one author or many', () => {
    expect(arxivBibliographic({ author: [{ name: 'A.  One' }, { name: 'B Two' }], published: '2024-01-05T18:00:00Z' })).toEqual({
      publisher: 'arXiv',
      authors: ['A. One', 'B Two'],
      publishedAt: '2024-01-05',
    });
    expect(arxivBibliographic({ author: { name: 'Solo Author' } })).toEqual({ publisher: 'arXiv', authors: ['Solo Author'] });
  });

  it('reads PubMed Central authors and journal, and a date only when it states a day', () => {
    expect(pmcBibliographic({ authors: [{ name: 'Frangoul H' }, { name: '' }], fulljournalname: 'New England Journal of Medicine', pubdate: '2021 Jan 21' })).toEqual({
      authors: ['Frangoul H'],
      publisher: 'New England Journal of Medicine',
      publishedAt: '2021-01-21',
    });
    expect(pmcBibliographic({ source: 'N Engl J Med', pubdate: '2021 Jan' })).toEqual({ publisher: 'N Engl J Med' });
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
    ).toEqual({ authors: ['Lovering, Jessica R.'], publisher: 'Energy Policy', publishedAt: '2016-04-01' });
    expect(storedBibliographic({ bibliographic: { authors: 'Lovering', publisher: 3, publishedAt: '2016' } })).toBeNull();
    expect(storedBibliographic({ bibliographic: { publisher: 'Energy Policy', publishedAt: 'April 2016' } })).toEqual({
      authors: null,
      publisher: 'Energy Policy',
      publishedAt: null,
    });
  });
});
