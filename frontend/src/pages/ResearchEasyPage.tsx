import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import AttachmentDropZone from '../components/research/AttachmentDropZone';
import ResearchClarificationChat from '../components/research/ResearchClarificationChat';
import { useCanAccessDeepResearch } from '../hooks/useCanAccessDeepResearch';
import { useStore } from '../store/useStore';
import { extractApiError, startResearch, type CitationStyleSlug } from '../utils/api';
import ResearchOutputControls, { normalizeReportFormats, resolveTargetWordCount, type ReportLengthPreset } from '../components/research/ResearchOutputControls';
import { applySupplementalIngestNotifications } from '../utils/supplementalIngestNotifications';
import { liveResearchUrl } from '../utils/researchRunRoutes';
import { buildClarifyingQuestions } from '../utils/clarifyingQuestions';

type EasyDepth = 'standard' | 'deep';

export default function ResearchEasyPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addNotification = useStore((s) => s.addNotification);
  const { canAccessDeep, tierGateUnknown } = useCanAccessDeepResearch();

  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<EasyDepth>('standard');
  const [supplemental, setSupplemental] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [siteCrawlEnabled, setSiteCrawlEnabled] = useState(false);
  const [crawlLayers, setCrawlLayers] = useState(2);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyQuestions, setClarifyQuestions] = useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);
  const [objective, setObjective] = useState<string>('AUTO');
  const [reportFormats, setReportFormats] = useState<string[]>(['automatic']);
  const [reportLengthPreset, setReportLengthPreset] = useState<ReportLengthPreset>('standard');
  const [reportLengthCustom, setReportLengthCustom] = useState(2200);
  const [citationStyle, setCitationStyle] = useState<CitationStyleSlug>('apa');

  const deepLocked = !tierGateUnknown && !canAccessDeep;
  const selectedEngineVersion = depth === 'deep' ? 'v2' : undefined;

  useEffect(() => {
    if (deepLocked && depth === 'deep') setDepth('standard');
  }, [deepLocked, depth]);

  const clarityBlock = useMemo(() => {
    const lines = clarifyQuestions
      .map((question, idx) => {
        const answer = (clarifyAnswers[idx] ?? '').trim();
        return answer ? `- ${question}\n  ${answer}` : '';
      })
      .filter(Boolean);
    return lines.length > 0 ? `Clarifications:\n${lines.join('\n')}` : '';
  }, [clarifyAnswers, clarifyQuestions]);

  const mutation = useMutation({
    mutationFn: (opts: { includeClarifications: boolean }) => {
      const extra = opts.includeClarifications && clarityBlock ? `\n\n${clarityBlock}` : '';
      const normalizedFormats = normalizeReportFormats(reportFormats);
      return startResearch({
        query: query.trim(),
        supplemental: `${supplemental.trim()}${extra}`.trim() || undefined,
        engineVersion: selectedEngineVersion,
        researchObjective: objective !== 'AUTO' ? (objective as never) : undefined,
        requestedResearchObjective: objective,
        requestedFormats: normalizedFormats.includes('automatic') ? undefined : normalizedFormats,
        targetWordCount: resolveTargetWordCount(reportLengthPreset, reportLengthCustom),
        citationStyle,
        supplementalFiles: files,
        supplementalUrls: urls,
        supplementalUrlCrawl: urls.length > 0 ? { siteCrawl: siteCrawlEnabled, crawlLayers } : undefined,
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      applySupplementalIngestNotifications(data.supplementalIngest, addNotification, {
        researchLabel: 'Research',
        defaultStartedMessage: 'Research started — tracking detailed progress...',
      });
      navigate(liveResearchUrl(data.runId, { engineVersion: selectedEngineVersion, focusPlan: true }));
    },
    onError: (err) => {
      addNotification('error', extractApiError(err));
    },
  });

  const openClarificationOrSubmit = () => {
    if (!query.trim() || mutation.isPending) return;
    const generated = buildClarifyingQuestions(query, { reportFormats: normalizeReportFormats(reportFormats) });
    if (generated.length === 0) {
      void mutation.mutate({ includeClarifications: false });
      return;
    }
    setClarifyQuestions(generated);
    setClarifyAnswers(Array.from({ length: generated.length }, () => ''));
    setClarifyOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-surface-100 bg-surface-200/40 p-4 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            EZ Research
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Describe what you need to know, find, or produce. We will generate a plan before the run continues.
          </p>
        </div>

        <label className="space-y-1 block">
          <span className="text-xs text-slate-300">Your research question or task</span>
          <textarea
            rows={5}
            className="w-full rounded-lg border border-surface-100 bg-[#0b0d14] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe what you need to know, compare, or produce."
            disabled={mutation.isPending}
          />
        </label>

        <label className="space-y-1 block">
          <span className="text-xs text-slate-300">Extra context (optional)</span>
          <textarea
            rows={3}
            className="w-full rounded-lg border border-surface-100 bg-[#0b0d14] px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600"
            value={supplemental}
            onChange={(e) => setSupplemental(e.target.value)}
            placeholder="Constraints, must-use sources, or success criteria."
            disabled={mutation.isPending}
          />
        </label>

        <ResearchOutputControls
          objective={objective}
          onObjectiveChange={setObjective}
          reportFormats={reportFormats}
          onReportFormatsChange={setReportFormats}
          reportLengthPreset={reportLengthPreset}
          onReportLengthPresetChange={setReportLengthPreset}
          reportLengthCustom={reportLengthCustom}
          onReportLengthCustomChange={setReportLengthCustom}
          citationStyle={citationStyle}
          onCitationStyleChange={setCitationStyle}
          disabled={mutation.isPending}
          compact
        />

        <div className="space-y-2">
          <p className="text-xs text-slate-300">Depth</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={depth === 'standard' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
              onClick={() => setDepth('standard')}
              disabled={mutation.isPending}
            >
              Standard
            </button>
            <button
              type="button"
              className={depth === 'deep' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
              onClick={() => setDepth('deep')}
              disabled={mutation.isPending || deepLocked}
            >
              Deep
            </button>
          </div>
          {deepLocked ? (
            <p className="text-[11px] text-amber-300">Deep Research is available on paid tiers.</p>
          ) : null}
        </div>

        <AttachmentDropZone
          files={files}
          urls={urls}
          onChange={({ files: nextFiles, urls: nextUrls }) => {
            setFiles(nextFiles);
            setUrls(nextUrls);
          }}
          disabled={mutation.isPending}
          label="Optional documents / URLs"
          description="Attach files or URLs if they are required context for this run."
          mode="research"
          siteCrawlEnabled={siteCrawlEnabled}
          crawlLayers={crawlLayers}
          onSiteCrawlChange={({ enabled, crawlLayers: nextLayers }) => {
            setSiteCrawlEnabled(enabled);
            setCrawlLayers(nextLayers);
          }}
        />

        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2 text-sm"
          onClick={openClarificationOrSubmit}
          disabled={mutation.isPending || !query.trim()}
        >
          {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
          Plan my research
        </button>
      </div>

      {clarifyOpen ? (
        <ResearchClarificationChat
          questions={clarifyQuestions}
          answers={clarifyAnswers}
          onAnswerChange={(idx, value) =>
            setClarifyAnswers((prev) => prev.map((item, itemIdx) => (itemIdx === idx ? value : item)))
          }
          onContinueWithoutAnswers={() => {
            setClarifyOpen(false);
            void mutation.mutate({ includeClarifications: false });
          }}
          onSubmitAnswers={() => {
            setClarifyOpen(false);
            void mutation.mutate({ includeClarifications: true });
          }}
          busy={mutation.isPending}
        />
      ) : null}
    </div>
  );
}
