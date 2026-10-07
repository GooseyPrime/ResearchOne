/**
 * The public sample report (upgrade plan, slice 5 item 8).
 *
 * It is shown with the same reading page a customer's report is shown with,
 * so the sample is the product and not a picture of it. It is an illustration
 * written for this page, not the output of a run: its sources are real public
 * documents a reader can open, and it quotes none of them, so the citation
 * cards show the source without a passage.
 */
import type { Report } from '../utils/api';
import type { ReaderEvidence } from '../components/reports/reader/readerModel';

const section = (order: number, title: string, content: string) => ({ id: `sample-${order}`, section_type: 'body', title, content, section_order: order });

const TITLE = 'How the European Union and the United States govern artificial intelligence';

export const sampleReaderReport: Report = {
  id: 'sample-report',
  title: TITLE,
  query: 'How do the European Union and the United States differ in governing artificial intelligence?',
  status: 'finalized',
  contradiction_count: 0,
  source_count: 4,
  chunk_count: 0,
  created_at: '2026-10-01T00:00:00Z',
  reader_view: true,
  sections: [
    section(0, TITLE, ''),
    section(
      1,
      'Summary',
      'The European Union governs artificial intelligence through one binding law, the AI Act, which sorts systems by risk and attaches duties to each level [1]. The United States has no equivalent federal statute. It relies on a voluntary framework from the National Institute of Standards and Technology [2] and on executive action, which changes with the administration: a 2023 executive order on AI safety [3] was revoked in January 2025 [4]. The practical difference is that European duties are enforceable and American ones largely are not.'
    ),
    section(
      2,
      'Key findings',
      '- The EU AI Act is a regulation, so it applies directly in every member state without national legislation [1].\n- The Act scales its duties to risk: some uses are prohibited, high-risk systems carry the heaviest obligations, and most systems carry few or none [1].\n- The NIST AI Risk Management Framework is voluntary and is organised around four functions: govern, map, measure and manage [2].\n- Federal AI policy in the United States has been set largely by executive order, and one order can undo another [3][4].'
    ),
    section(
      3,
      'How the European Union regulates',
      'The AI Act was published in the Official Journal of the European Union in July 2024 [1]. Because it is a regulation and not a directive, its rules bind companies directly. Its obligations do not all begin at once: they are phased in over several years, with the bans on prohibited practices applying first [1].\n\nThe law does not treat all systems alike. It prohibits a short list of practices outright, sets detailed requirements for systems it classes as high-risk, adds transparency duties for systems that interact with people or generate content, and leaves the remainder largely unregulated [1].'
    ),
    section(
      4,
      'How the United States regulates',
      'The United States has taken a different route. The NIST AI Risk Management Framework, released in January 2023, gives organisations a structured way to identify and reduce the risks of AI systems, and nobody is required to use it [2].\n\nBeyond that framework, federal direction has come from the President. Executive Order 14110, signed in October 2023, directed agencies to act on AI safety and security [3]. It was revoked in January 2025, and Executive Order 14179, signed that month, set a different direction and ordered a review of what had been done under it [4]. Rules made this way are quicker to adopt than legislation and just as quick to remove.'
    ),
    section(
      5,
      'Limits of this report',
      'This sample compares the central federal and EU instruments only. It does not cover state laws in the United States, sector regulators, or how either approach is being enforced in practice, which was too recent to assess from the sources read.'
    ),
    section(
      6,
      'References',
      '1. European Union. Regulation (EU) 2024/1689 laying down harmonised rules on artificial intelligence (Artificial Intelligence Act). Official Journal of the European Union. 12 Jul 2024. Legislation. https://eur-lex.europa.eu/eli/reg/2024/1689/oj\n2. National Institute of Standards and Technology. Artificial Intelligence Risk Management Framework (AI RMF 1.0). 26 Jan 2023. Government report. https://doi.org/10.6028/NIST.AI.100-1\n3. Executive Office of the President. Executive Order 14110: Safe, Secure, and Trustworthy Development and Use of Artificial Intelligence. Federal Register. 30 Oct 2023. Government document. https://www.federalregister.gov/documents/2023/11/01/2023-24283/safe-secure-and-trustworthy-development-and-use-of-artificial-intelligence\n4. Executive Office of the President. Executive Order 14179: Removing Barriers to American Leadership in Artificial Intelligence. Federal Register. 23 Jan 2025. Government document. https://www.federalregister.gov/documents/2025/01/31/2025-02172/removing-barriers-to-american-leadership-in-artificial-intelligence'
    ),
    section(7, 'About this report', 'A sample written to show the reading page. 4 public documents are cited.'),
  ],
};

const SOURCES: ReaderEvidence['sources'] = [
  { id: 'sample-src-1', title: 'Regulation (EU) 2024/1689 (Artificial Intelligence Act)', publisher: 'Official Journal of the European Union', authors: ['European Union'], date: '2024-07-12', url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj', kind: 'legislation', notice: null },
  { id: 'sample-src-2', title: 'Artificial Intelligence Risk Management Framework (AI RMF 1.0)', publisher: 'National Institute of Standards and Technology', authors: [], date: '2023-01-26', url: 'https://doi.org/10.6028/NIST.AI.100-1', kind: 'government report', notice: null },
  { id: 'sample-src-3', title: 'Executive Order 14110: Safe, Secure, and Trustworthy Development and Use of Artificial Intelligence', publisher: 'Federal Register', authors: [], date: '2023-10-30', url: 'https://www.federalregister.gov/documents/2023/11/01/2023-24283/safe-secure-and-trustworthy-development-and-use-of-artificial-intelligence', kind: 'government document', notice: null },
  { id: 'sample-src-4', title: 'Executive Order 14179: Removing Barriers to American Leadership in Artificial Intelligence', publisher: 'Federal Register', authors: [], date: '2025-01-23', url: 'https://www.federalregister.gov/documents/2025/01/31/2025-02172/removing-barriers-to-american-leadership-in-artificial-intelligence', kind: 'government document', notice: null },
];

/** One citation per number per section it appears in, so every number on the page opens its source. */
function citationsOf(report: Report): ReaderEvidence['citations'] {
  const citations: ReaderEvidence['citations'] = [];
  for (const entry of report.sections ?? []) {
    if (entry.title === 'References') continue;
    for (const match of entry.content.matchAll(/\[(\d+)\]/g)) {
      citations.push({ sectionId: entry.id, number: Number(match[1]), order: citations.length, quote: null, sourceId: `sample-src-${match[1]}` });
    }
  }
  return citations;
}

export const sampleReaderEvidence: ReaderEvidence = {
  status: { word: 'Ready', reason: null },
  sources: SOURCES,
  citations: citationsOf(sampleReaderReport),
  findings: [],
};
