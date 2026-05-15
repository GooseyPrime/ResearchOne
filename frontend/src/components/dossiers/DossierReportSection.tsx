import clsx from 'clsx';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import type { DossierPlan, Report } from '../../utils/api';
import { getIntentOutputTemplate } from '../../lib/intentOutputTemplates';
import SkepticAnnotationsAside from './SkepticAnnotationsAside';

/** User-facing flow labels; Wave 4 — avoid generic "evidence" for retrieved corpora. */
const SECTION_FLOW_LABELS: Record<string, string> = {
  primary_evidence: 'Primary-source checks',
  evidence: 'Source-backed analysis',
  sources: 'Sources',
  limits: 'Limits',
};

function sectionFlowLabel(id: string): string {
  if (SECTION_FLOW_LABELS[id]) return SECTION_FLOW_LABELS[id]!;
  return id
    .split('_')
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(' ');
}

function resolveOutputTemplateId(plan: DossierPlan, report: Report | undefined): string | null {
  const m = report?.metadata;
  if (m && typeof (m as { output_template_id?: string }).output_template_id === 'string') {
    return (m as { output_template_id: string }).output_template_id;
  }
  const orch = plan.planPayload?.orchestrationProfile as Record<string, unknown> | undefined;
  if (orch && typeof orch.outputTemplateId === 'string') return orch.outputTemplateId;
  return null;
}

function parseSkepticAnnotations(meta: Record<string, unknown> | undefined): unknown[] {
  if (!meta) return [];
  const raw = meta.skeptic_annotations;
  if (!Array.isArray(raw)) return [];
  return raw;
}

function resolveSkepticMode(report: Report | undefined): string | null {
  const m = report?.metadata as { skeptic_mode?: string } | undefined;
  return m && typeof m.skeptic_mode === 'string' ? m.skeptic_mode : null;
}

type Props = {
  plan: DossierPlan;
  report: Report | undefined;
  reportLoading: boolean;
  reportError: Error | null;
  fullReportHref: string;
};

export default function DossierReportSection({
  plan,
  report,
  reportLoading,
  reportError,
  fullReportHref,
}: Props) {
  const templateId = resolveOutputTemplateId(plan, report);
  const template = getIntentOutputTemplate(templateId);
  const meta = report?.metadata as Record<string, unknown> | undefined;
  const annotations = parseSkepticAnnotations(meta);
  const skepticMode = resolveSkepticMode(report);
  const showAside =
    annotations.length > 0 && (template.sidebarSkepticAnnotations || skepticMode === 'annotate');
  const plainMd =
    meta && typeof meta.plain_language_markdown === 'string' ? meta.plain_language_markdown.trim() : '';
  const showPlain = template.showPlainLanguageFooter && plainMd.length > 0;

  if (reportLoading) {
    return <p className="text-slate-500 text-sm">Loading report…</p>;
  }
  if (reportError) {
    return <p className="text-red-300 text-sm">Could not load report body.</p>;
  }
  if (!report) {
    return <p className="text-slate-500">No report is linked to this dossier yet.</p>;
  }

  const sections = [...(report.sections ?? [])].sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm text-slate-400">
        <span>
          Title: <span className="text-slate-200">{report.title ?? '—'}</span>
        </span>
        <span>
          Status: <span className="text-slate-200">{report.status ?? '—'}</span>
        </span>
      </div>

      <div className="rounded-lg border border-slate-800/80 bg-slate-950/30 p-3 space-y-2">
        <h3 className="text-white text-sm font-medium">Output layout: {template.title}</h3>
        <p className="text-xs text-slate-500">{template.narrativeHint}</p>
        <ol className="list-decimal list-inside text-xs text-slate-400 space-y-0.5">
          {template.sections.map((sid) => (
            <li key={sid}>{sectionFlowLabel(sid)}</li>
          ))}
        </ol>
      </div>

      <div className={clsx('grid gap-6', showAside && 'lg:grid-cols-[minmax(0,1fr)_minmax(240px,30%)]')}>
        <div className="space-y-4 min-w-0">
          {sections.length === 0 ? (
            <p className="text-slate-500 text-sm">No sections on this report.</p>
          ) : (
            sections.map((sec) => (
              <article key={sec.id} className="rounded-lg border border-slate-800/60 bg-slate-900/20 p-3">
                <h4 className="text-slate-100 font-medium text-sm mb-2">{sec.title}</h4>
                <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                  <ReactMarkdown>{sec.content || ''}</ReactMarkdown>
                </div>
              </article>
            ))
          )}
          {showPlain ? (
            <section className="rounded-lg border border-dashed border-slate-700/80 p-3">
              <h4 className="text-slate-200 text-sm font-medium mb-2">Plain-language summary</h4>
              <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                <ReactMarkdown>{plainMd}</ReactMarkdown>
              </div>
            </section>
          ) : null}
        </div>
        {showAside ? <SkepticAnnotationsAside annotations={annotations} className="lg:sticky lg:top-4 self-start" /> : null}
      </div>

      <Link to={fullReportHref} className="inline-flex items-center gap-2 text-accent hover:underline text-sm">
        Open full report workspace
      </Link>
    </div>
  );
}
