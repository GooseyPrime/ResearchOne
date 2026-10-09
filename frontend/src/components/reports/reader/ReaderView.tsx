import { useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import type { Report } from '../../../utils/api';
import CitationMarker from './CitationMarker';
import {
  CHALLENGE_PASS,
  CITE_HREF,
  TAB_LABELS,
  citationCard,
  legacyNumbersOf,
  linkCitations,
  linkSection,
  parseReferences,
  readableDay,
  readerHeading,
  referenceAnchor,
  sectionRole,
  tabsFor,
  type ReaderEvidence,
  type ReaderSource,
  type ReaderTab,
} from './readerModel';

/** Before the page's data arrives: the report text alone, and no status claimed. */
const EMPTY: ReaderEvidence = { status: { word: '', reason: null }, sources: [], citations: [], findings: [] };

const STATUS_TONE: Record<string, string> = {
  Ready: 'bg-green-900/20 text-green-400 border-green-800/30',
  'Finished with fewer sources than planned': 'bg-amber-900/20 text-amber-300 border-amber-800/30',
  'Needs review': 'bg-amber-900/20 text-amber-300 border-amber-800/30',
  Failed: 'bg-red-900/20 text-red-300 border-red-800/30',
  'In progress': 'bg-accent/10 text-accent border-accent/30',
};

function Prose({ markdown, evidence, inline }: { markdown: string; evidence: ReaderEvidence; inline?: boolean }): JSX.Element {
  const Wrap = inline ? 'span' : 'div';
  return (
    <Wrap className={inline ? undefined : 'prose prose-invert max-w-none prose-p:leading-relaxed'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // A heading is one line: its paragraph wrapper would break the heading element.
          ...(inline ? { p: ({ children }: { children?: ReactNode }) => <>{children}</> } : {}),
          a: ({ href, children }) => {
            if (href?.startsWith(CITE_HREF)) {
              const card = citationCard(Number(href.slice(CITE_HREF.length)), evidence);
              if (card && card.number !== null) return <CitationMarker number={card.number} quote={card.quote} source={card.source} />;
              return <>{children}</>;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full text-sm border-collapse">{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </Wrap>
  );
}

function SourceLine({ source }: { source: ReaderSource }): JSX.Element {
  const facts = [source.authors.slice(0, 3).join(', ') + (source.authors.length > 3 ? ' and others' : ''), source.publisher, readableDay(source.date)].filter(Boolean);
  return (
    <>
      <span className="block text-slate-100">{source.title}</span>
      {facts.length > 0 && <span className="block text-xs text-slate-400 mt-0.5">{facts.join(' · ')}</span>}
      <span className="block text-xs text-slate-500 mt-0.5 capitalize">{source.kind}</span>
      {source.notice && <span className="block text-xs text-amber-300 mt-1">{source.notice}</span>}
      {source.url && (
        <a className="block text-xs text-accent hover:underline break-all mt-1" href={source.url} target="_blank" rel="noopener noreferrer">
          {source.url}
        </a>
      )}
    </>
  );
}

export interface ReaderReportBodyProps {
  report: Report;
  evidence?: ReaderEvidence;
  /** Passage labels of an older report mapped to reader numbers. */
  legacyNumbers?: ReadonlyMap<number, number>;
}

/**
 * The report as a reader is meant to see it, and nothing else: its sections
 * under reader headings, numbered citations, the reference list and the closing
 * note. This is the only way a report's text is shown to a customer, on the
 * report page and on a dossier's Report tab alike, for a report of any age.
 * There is no other layout to fall back to.
 */
export function ReaderReportBody({ report, evidence = EMPTY, legacyNumbers }: ReaderReportBodyProps): JSX.Element {
  const sections = useMemo(() => [...(report.sections ?? [])].sort((a, b) => a.section_order - b.section_order), [report.sections]);
  const role = (index: number) => sectionRole(sections[index], report.title);
  const referenceSection = sections.find((_, index) => role(index) === 'references');
  const references = referenceSection ? parseReferences(referenceSection.content) : [];
  const about = sections.find((_, index) => role(index) === 'about');
  const labels = useMemo(() => new Map([...legacyNumbersOf(evidence), ...(legacyNumbers ?? [])]), [evidence, legacyNumbers]);
  const link = (content: string, sectionId: string | null): string => linkCitations(content, sectionId, evidence.citations, labels);
  const linked = (section: { id: string; title: string; content: string }) => linkSection(section.title, section.content, section.id, evidence.citations, labels);
  return (
    <>
      {sections.map((section, index) =>
        role(index) === 'report' ? (
          <section key={section.id} className="space-y-2">
            <h2 className="text-xl font-semibold text-white">
              <Prose inline markdown={linked(section).heading} evidence={evidence} />
            </h2>
            <Prose markdown={linked(section).body} evidence={evidence} />
          </section>
        ) : null
      )}
      {sections.every((_, index) => role(index) !== 'report') && report.executive_summary && (
        // An older report with no stored sections: its summary gets the same citation handling.
        <Prose markdown={link(report.executive_summary, null)} evidence={evidence} />
      )}
      {references.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-white">References</h2>
          <ol className="space-y-2 text-sm text-slate-300 list-none pl-0">
            {references.map((entry) => (
              <li key={entry.number} id={referenceAnchor(entry.number)} className="flex gap-2 scroll-mt-24 target:bg-accent/10 rounded px-1">
                <span className="text-slate-500 flex-shrink-0">{entry.number}.</span>
                <span className="min-w-0 break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
                    {entry.text}
                  </ReactMarkdown>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {about && <p className="text-xs text-slate-500 border-t border-indigo-900/20 pt-3">{about.content.trim()}</p>}
    </>
  );
}

export interface ReaderViewProps extends ReaderReportBodyProps {
  /** What a reader may want to know about how the report came to be: what was asked, and the reference to quote to support. */
  method?: ReactNode;
}

/**
 * The reading page (slice 5). The Report tab shows the report as a reader is
 * meant to see it and nothing else. Strength appears only on the Evidence tab,
 * and challenge material only on the Challenge pass tab.
 */
export default function ReaderView({ report, evidence = EMPTY, legacyNumbers, method }: ReaderViewProps): JSX.Element {
  const sections = useMemo(() => [...(report.sections ?? [])].sort((a, b) => a.section_order - b.section_order), [report.sections]);
  const tabs = tabsFor(sections, report.title);
  const [tab, setTab] = useState<ReaderTab>('report');
  const active = tabs.includes(tab) ? tab : 'report';
  const role = (index: number) => sectionRole(sections[index], report.title);
  const referenceSection = sections.find((_, index) => role(index) === 'references');
  const references = referenceSection ? parseReferences(referenceSection.content) : [];
  const sourceById = new Map(evidence.sources.map((source) => [source.id, source]));
  // Labels the backend mapped for an older report, with any the caller adds.
  const labels = useMemo(() => new Map([...legacyNumbersOf(evidence), ...(legacyNumbers ?? [])]), [evidence, legacyNumbers]);
  const linked = (section: { id: string; title: string; content: string }) => linkSection(section.title, section.content, section.id, evidence.citations, labels);

  return (
    <article className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold text-white leading-tight">{report.title}</h1>
          {evidence.status.word && (
            <span className={clsx('badge border flex-shrink-0', STATUS_TONE[evidence.status.word] ?? STATUS_TONE['Needs review'])}>{evidence.status.word}</span>
          )}
        </div>
        {evidence.status.reason && <p className="text-sm text-slate-400">{evidence.status.reason}</p>}
      </header>

      <div role="tablist" aria-label="Report views" className="flex flex-wrap gap-1 border-b border-indigo-900/30 print:hidden">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`reader-tab-${name}`}
            aria-selected={active === name}
            aria-controls={`reader-panel-${name}`}
            className={clsx(
              'px-3 py-2 text-sm rounded-t border-b-2 -mb-px',
              active === name ? 'border-accent text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
            onClick={() => setTab(name)}
          >
            {TAB_LABELS[name]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`reader-panel-${active}`} aria-labelledby={`reader-tab-${active}`} className="space-y-6">
        {active === 'report' && <ReaderReportBody report={report} evidence={evidence} legacyNumbers={legacyNumbers} />}

        {active === 'evidence' && (
          <section className="space-y-4">
            <p className="text-sm text-slate-400">
              {evidence.findings.length > 0
                ? 'Each finding with the sources and passages behind it, and how strongly they support it.'
                : 'Each passage this report cites, with its source.'}
            </p>
            {evidence.findings.length > 0
              ? evidence.findings.map((finding, index) => (
                  <div key={index} className="card p-4 space-y-2">
                    <p className="text-sm text-slate-100">{finding.text}</p>
                    <p className="text-xs text-slate-400">{finding.strength}</p>
                    {finding.quotes.map((quote, at) => (
                      <p key={at} className="text-sm text-slate-300 border-l-2 border-accent/40 pl-2 italic">
                        “{quote}”
                      </p>
                    ))}
                    {finding.sourceIds.map((id) => {
                      const source = sourceById.get(id);
                      return source ? (
                        <div key={id} className="text-sm">
                          <SourceLine source={source} />
                        </div>
                      ) : null;
                    })}
                  </div>
                ))
              : evidence.citations
                  .filter((citation) => citation.quote)
                  .map((citation) => {
                    const source = citation.sourceId ? sourceById.get(citation.sourceId) : undefined;
                    return (
                      <div key={citation.order} className="card p-4 space-y-2">
                        <p className="text-sm text-slate-300 border-l-2 border-accent/40 pl-2 italic">“{citation.quote}”</p>
                        {source && (
                          <div className="text-sm">
                            <SourceLine source={source} />
                          </div>
                        )}
                      </div>
                    );
                  })}
            {evidence.findings.length === 0 && evidence.citations.every((citation) => !citation.quote) && (
              <p className="text-sm text-slate-500">No quoted passages were saved for this report.</p>
            )}
          </section>
        )}

        {active === 'sources' && (
          <section className="space-y-3">
            {evidence.sources.length === 0 && references.length === 0 && <p className="text-sm text-slate-500">This report cites no sources.</p>}
            {evidence.sources.length > 0 ? (
              <ol className="space-y-3 list-decimal pl-5 text-sm">
                {evidence.sources.map((source) => (
                  <li key={source.id}>
                    <SourceLine source={source} />
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="space-y-2 text-sm text-slate-300 list-none pl-0">
                {references.map((entry) => (
                  <li key={entry.number}>
                    {entry.number}. {entry.text}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {active === 'method' && (
          <section className="space-y-4">
            <p className="text-sm text-slate-400">What was asked, and the reference to quote if you contact support about this report.</p>
            {method ?? <p className="text-sm text-slate-500">No record of the request is available for this report.</p>}
          </section>
        )}

        {active === 'challenge' && (
          <section className="space-y-6">
            <p className="text-sm text-slate-400">A second look at this report: where its findings could be wrong, and what would change them.</p>
            {sections.map((section, index) =>
              role(index) === 'challenge' ? (
                <section key={section.id} className="space-y-2">
                  {/* A section already named for the tab is not headed twice. */}
                  {readerHeading(section.title).toLowerCase() !== CHALLENGE_PASS.toLowerCase() && (
                    <h2 className="text-xl font-semibold text-white">
                      <Prose inline markdown={linked(section).heading} evidence={evidence} />
                    </h2>
                  )}
                  <Prose markdown={linked(section).body} evidence={evidence} />
                </section>
              ) : null
            )}
          </section>
        )}
      </div>
    </article>
  );
}
