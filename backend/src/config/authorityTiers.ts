/**
 * The rules that give a source its authority tier. This file is the only place
 * they live. No model is asked: a tier follows from what the provider recorded
 * the work to be, which provider returned it, and the address it was read at.
 *
 *   1  Primary and official: government, regulators, courts, standards bodies,
 *      statistical agencies, registries, original datasets.
 *   2  Peer-reviewed scholarly work.
 *   3  Preprints, established news organizations, reference works, recognized
 *      institutional reports.
 *   4  Everything else.
 *
 * Rules are read top to bottom and the first that matches decides. Order is
 * part of the rule: a journal article hosted on a government site is a journal
 * article, so what the work is comes before where it is hosted.
 *
 * A tier orders sources of equal relevance and tells the writer which to prefer
 * when two disagree. It never removes a source (invariant 7). It is separate
 * from `evidence_tier` (a grade on a stored finding) and from the discourse
 * label in `sourceClassTypes.ts`.
 *
 * Every rule carries one example. `authorityTierRules.test.ts` runs each
 * example and fails for a rule without one, so a rule cannot be added untested.
 */

export type AuthorityTier = 1 | 2 | 3 | 4;

/** What is known about a source when its tier is decided. */
export interface AuthoritySignals {
  /** The provider's record of what the work is ("journal article", "preprint"). */
  kind?: string | null;
  /** The discovery provider that returned it ("crossref", "arxiv"). */
  provider?: string | null;
  url?: string | null;
}

export interface AuthorityRule {
  id: string;
  tier: AuthorityTier;
  /** What the rule recognises, in words. */
  what: string;
  /** Matches when the recorded kind is one of these. */
  kinds?: readonly string[];
  /** Matches when the provider is one of these. A rule with `withoutKind` needs the kind to be unrecorded too. */
  providers?: readonly string[];
  /** With `providers`: match only when the provider recorded no kind. */
  withoutKind?: boolean;
  /** Matches when the host is one of these or a subdomain of one. */
  hosts?: readonly string[];
  /** Matches when the host ends with one of these whole-label suffixes ("gov", "gov.uk"). */
  hostSuffixes?: readonly string[];
  /** With `hosts` or `hostSuffixes`: the path must match as well. */
  path?: RegExp;
  example: AuthoritySignals;
}

export const AUTHORITY_RULES: readonly AuthorityRule[] = [
  // ── What the work is, as the provider recorded it ────────────────────────────
  {
    id: 'kind-preprint',
    tier: 3,
    what: 'a preprint, whoever hosts it',
    kinds: ['preprint', 'posted content', 'working paper'],
    example: { kind: 'preprint', provider: 'crossref', url: 'https://doi.org/10.1101/2024.01.01.000001' },
  },
  {
    id: 'kind-peer-reviewed',
    tier: 2,
    what: 'a journal or conference article',
    kinds: ['journal article', 'proceedings article', 'conference paper', 'review article'],
    example: { kind: 'journal article', provider: 'crossref', url: 'https://doi.org/10.1016/j.enpol.2016.01.011' },
  },
  {
    id: 'kind-registry-record',
    tier: 1,
    what: 'a record in an official registry',
    kinds: ['clinical trial record', 'patent record', 'patent'],
    example: { kind: 'clinical trial record', provider: 'clinicaltrials', url: 'https://clinicaltrials.gov/study/NCT00000102' },
  },
  {
    id: 'kind-dataset-or-standard',
    tier: 1,
    what: 'an original dataset or a published standard',
    kinds: ['dataset', 'standard'],
    example: { kind: 'dataset', provider: 'crossref', url: 'https://doi.org/10.5061/dryad.example' },
  },
  {
    id: 'kind-book-or-report',
    tier: 3,
    what: 'a book, a chapter, a report, a thesis or a reference entry',
    kinds: ['book', 'book chapter', 'monograph', 'edited book', 'reference book', 'reference entry', 'report', 'dissertation', 'thesis'],
    example: { kind: 'report', provider: 'crossref', url: 'https://doi.org/10.1787/example-en' },
  },

  // ── Which provider returned it ───────────────────────────────────────────────
  {
    id: 'provider-arxiv',
    tier: 3,
    what: 'anything returned by the arXiv search',
    providers: ['arxiv'],
    example: { provider: 'arxiv', url: 'https://arxiv.org/abs/2401.00001' },
  },
  {
    id: 'provider-registry',
    tier: 1,
    what: 'anything returned by the trial or patent registry searches',
    providers: ['clinicaltrials', 'uspto'],
    example: { provider: 'uspto', url: 'https://patents.google.com/patent/US1234567B2/en' },
  },
  {
    id: 'provider-pmc',
    tier: 2,
    what: 'an article from the PubMed Central search',
    providers: ['pmc', 'pubmed', 'pubmedcentral'],
    example: { provider: 'pmc', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/' },
  },
  {
    id: 'provider-catalogue-unknown-kind',
    tier: 3,
    what: 'a catalogued published work whose kind the catalogue did not record: published, not known to be peer reviewed',
    providers: ['crossref', 'openalex', 'scite'],
    withoutKind: true,
    example: { provider: 'openalex', url: 'https://doi.org/10.1234/unknown' },
  },

  // ── Where it was read: scholarly hosts before government hosts ───────────────
  {
    id: 'host-preprint-server',
    tier: 3,
    what: 'a preprint server',
    hosts: ['arxiv.org', 'biorxiv.org', 'medrxiv.org', 'chemrxiv.org', 'ssrn.com', 'osf.io', 'researchsquare.com', 'preprints.org', 'nber.org'],
    example: { url: 'https://www.biorxiv.org/content/10.1101/2024.01.01.000001v1' },
  },
  {
    id: 'host-pubmed',
    tier: 2,
    what: 'an article page on PubMed or PubMed Central',
    hosts: ['pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'europepmc.org'],
    example: { url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/' },
  },
  {
    id: 'host-pmc-path',
    tier: 2,
    what: 'a PubMed Central article at its older address',
    hosts: ['ncbi.nlm.nih.gov'],
    path: /^\/pmc\//i,
    example: { url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/' },
  },
  {
    id: 'host-journal',
    tier: 2,
    what: 'a site that publishes peer-reviewed journals',
    hosts: [
      'nature.com', 'science.org', 'cell.com', 'thelancet.com', 'nejm.org', 'jamanetwork.com', 'bmj.com', 'pnas.org',
      'plos.org', 'sciencedirect.com', 'link.springer.com', 'onlinelibrary.wiley.com', 'academic.oup.com',
      'tandfonline.com', 'journals.sagepub.com', 'ieeexplore.ieee.org', 'dl.acm.org', 'frontiersin.org', 'mdpi.com',
      'cambridge.org', 'annualreviews.org', 'jstor.org', 'aps.org', 'acs.org', 'rsc.org', 'iop.org', 'elifesciences.org',
    ],
    example: { url: 'https://www.nature.com/articles/s41586-024-00001-1' },
  },
  {
    id: 'host-doi',
    tier: 3,
    what: 'a DOI link with nothing recorded about the work: published, not known to be peer reviewed',
    hosts: ['doi.org', 'dx.doi.org'],
    example: { url: 'https://doi.org/10.1234/unknown' },
  },

  // ── Primary and official ─────────────────────────────────────────────────────
  {
    id: 'host-government',
    tier: 1,
    what: 'a government, military or court site',
    hostSuffixes: [
      'gov', 'mil', 'gov.uk', 'gov.au', 'gov.in', 'gov.sg', 'gov.za', 'gov.br', 'gov.ie', 'gov.il', 'gov.cn', 'gov.hk',
      'gc.ca', 'canada.ca', 'govt.nz', 'gouv.fr', 'bund.de', 'go.jp', 'go.kr', 'gob.mx', 'gob.es', 'gob.ar', 'gob.cl',
      'admin.ch', 'judiciary.uk', 'parliament.uk', 'nhs.uk', 'europa.eu',
    ],
    example: { url: 'https://www.nrc.gov/reactors/new-reactors.html' },
  },
  {
    id: 'host-intergovernmental',
    tier: 1,
    what: 'an intergovernmental body or its statistical service',
    hostSuffixes: ['int'],
    hosts: ['un.org', 'oecd.org', 'worldbank.org', 'imf.org', 'bis.org', 'wto.org', 'iea.org', 'iaea.org', 'ilo.org', 'fao.org', 'oecd-ilibrary.org'],
    example: { url: 'https://www.who.int/publications/i/item/9789240000000' },
  },
  {
    id: 'host-standards-body',
    tier: 1,
    what: 'a standards body',
    hosts: ['iso.org', 'iec.ch', 'ietf.org', 'rfc-editor.org', 'w3.org', 'astm.org', 'standards.ieee.org'],
    example: { url: 'https://www.rfc-editor.org/rfc/rfc9110' },
  },
  {
    id: 'host-registry',
    tier: 1,
    what: 'an official registry of trials, patents or filings',
    hosts: ['clinicaltrials.gov', 'patents.google.com', 'epo.org', 'isrctn.com'],
    example: { url: 'https://patents.google.com/patent/US1234567B2/en' },
  },

  // ── Established news, reference works, institutions ──────────────────────────
  {
    id: 'host-news',
    tier: 3,
    what: 'an established news organization',
    hosts: [
      'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'wsj.com', 'ft.com', 'economist.com',
      'washingtonpost.com', 'theguardian.com', 'bloomberg.com', 'npr.org', 'pbs.org', 'aljazeera.com', 'lemonde.fr',
      'spiegel.de', 'nikkei.com', 'cbc.ca', 'abc.net.au', 'statnews.com', 'politico.com', 'theatlantic.com',
    ],
    example: { url: 'https://www.reuters.com/business/energy/example-2026-01-01/' },
  },
  {
    id: 'host-reference-work',
    tier: 3,
    what: 'an edited reference work',
    hosts: ['britannica.com', 'plato.stanford.edu', 'oxfordreference.com', 'merriam-webster.com'],
    example: { url: 'https://www.britannica.com/technology/nuclear-reactor' },
  },
  {
    id: 'host-university',
    tier: 3,
    what: 'a university or research institute',
    hostSuffixes: ['edu', 'ac.uk', 'edu.au', 'ac.jp', 'ac.in', 'edu.cn', 'ac.nz', 'ac.za', 'edu.sg'],
    hosts: ['mpg.de', 'cnrs.fr', 'ethz.ch', 'epfl.ch', 'cern.ch'],
    example: { url: 'https://energy.mit.edu/research/future-nuclear-energy-carbon-constrained-world/' },
  },
  {
    id: 'host-research-institution',
    tier: 3,
    what: 'a recognized research institution that publishes reports',
    hosts: ['rand.org', 'brookings.edu', 'pewresearch.org', 'csis.org', 'chathamhouse.org', 'nationalacademies.org', 'royalsociety.org', 'kff.org', 'urban.org'],
    example: { url: 'https://www.pewresearch.org/science/2024/01/01/example/' },
  },
];

/** The tier of a source no rule recognises. */
export const DEFAULT_AUTHORITY_TIER: AuthorityTier = 4;
