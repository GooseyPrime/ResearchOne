import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Loader2, Settings2, Sparkles } from 'lucide-react';
import AttachmentDropZone from '../components/research/AttachmentDropZone';
import ResearchClarificationChat from '../components/research/ResearchClarificationChat';
import ResearchOutputControls, {
  type ReportLengthPreset,
  resolveTargetWordCount,
  normalizeReportFormats,
} from '../components/research/ResearchOutputControls';
import RunAddonToggles from '../components/research/RunAddonToggles';
import { useCanAccessDeepResearch } from '../hooks/useCanAccessDeepResearch';
import { useResearchRunAddons } from '../hooks/useResearchRunAddons';
import { useStore } from '../store/useStore';
import { extractApiError, startResearch } from '../utils/api';
import { applySupplementalIngestNotifications } from '../utils/supplementalIngestNotifications';
import { liveResearchUrl } from '../utils/researchRunRoutes';
import { buildClarifyingQuestions } from '../utils/clarifyingQuestions';
import { RESEARCH_RUN_ADDON_CATALOG_KEYS } from '../utils/researchRunAddons';

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

  // ── Output preferences (collapsed by default — EZ mode stays simple) ─────
  const [outputPrefsOpen, setOutputPrefsOpen] = useState(false);
  const [reportFormats, setReportFormats] = useState<string[]>(['automatic']);
  const [reportLengthPreset, setReportLengthPreset] = useState<ReportLengthPreset>('standard');
  const [reportLengthCustom, setReportLengthCustom] = useState(2200);

  const deepLocked = !tierGateUnknown && !canAccessDeep;
  const selectedEngineVersion = depth === 'deep' ? 'v2' : undefined;

  const { selectedAddons, selectedAddonsForSubmit, toggleAddon, syncAddonsToUrl } =
    useResearchRunAddons(RESEARCH_RUN_ADDON_CATALOG_KEYS);

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

  // Resolve output preferences into API params
  const resolvedFormats = normalizeReportFormats(reportFormats);
  const requestedFormats = resolvedFormats.includes('automatic') ? undefined : resolvedFormats;
  // Only send targetWordCount when the user has explicitly selected a non-default length
  const targetWordCount =
    reportLengthPreset === 'standard' ? undefined : resolveTargetWordCount(reportLengthPreset, reportLengthCustom);

  const mutation = useMutation({
    mutationFn: (opts: { includeClarifications: boolean }) => {
      const extra = opts.includeClarifications && clarityBlock ? `\n\n${clarityBlock}` : '';
      return startResearch({
        query: query.trim(),
        supplemental: `${supplemental.trim()}${extra}`.trim() || undefined,
        engineVersion: selectedEngineVersion,
        supplementalFiles: files,
        supplementalUrls: urls,
        supplementalUrlCrawl: urls.length > 0 ? { siteCrawl: siteCrawlEnabled, crawlLayers } : undefined,
        requestedFormats,
        targetWordCount,
        addons: selectedAddonsForSubmit.length > 0 ? selectedAddonsForSubmit : undefined,
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
    syncAddonsToUrl();
    const generated = buildClarifyingQuestions(query, {});
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

        {/* Output preferences — collapsed by default so EZ stays simple */}
        <div className="border border-surface-100 rounded-lg overflow-hidden">
          <button
            type="button"
            data-testid="ez-output-prefs-toggle"
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-300 hover:bg-surface-100/40 transition-colors"
            onClick={() => setOutputPrefsOpen((open) => !open)}
            disabled={mutation.isPending}
          >
            <span className="flex items-center gap-1.5">
              <Settings2 size={13} />
              Output preferences
            </span>
            {outputPrefsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {outputPrefsOpen && (
            <div className="px-3 pb-3 pt-1 border-t border-surface-100">
              <ResearchOutputControls
                objective="AUTO"
                onObjectiveChange={() => undefined}
                showObjective={false}
                reportFormats={reportFormats}
                onReportFormatsChange={setReportFormats}
                reportLengthPreset={reportLengthPreset}
                onReportLengthPresetChange={setReportLengthPreset}
                reportLengthCustom={reportLengthCustom}
                onReportLengthCustomChange={setReportLengthCustom}
                disabled={mutation.isPending}
                compact
              />
            </div>
          )}
        </div>

        <RunAddonToggles
          selected={selectedAddons}
          onToggle={toggleAddon}
          disabled={mutation.isPending}
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
