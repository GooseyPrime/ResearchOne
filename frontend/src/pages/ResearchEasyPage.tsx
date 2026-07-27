import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import AttachmentDropZone from '../components/research/AttachmentDropZone';
import ResearchClarificationChat from '../components/research/ResearchClarificationChat';
import { useCanAccessDeepResearch } from '../hooks/useCanAccessDeepResearch';
import { useStore } from '../store/useStore';
import { extractApiError, startResearch } from '../utils/api';
import { applySupplementalIngestNotifications } from '../utils/supplementalIngestNotifications';
import { liveResearchUrl } from '../utils/researchRunRoutes';

type EasyDepth = 'standard' | 'deep';
const CLARIFY_MIN_WORDS = 12;
const SCOPE_BOUNDARY_PATTERN = /\b(by|within|deadline|budget|scope|market|region|industry)\b/i;
const OUTPUT_FORMAT_PATTERN = /\b(compare|rank|recommend|steps|plan|roadmap|table)\b/i;

/**
 * Lightweight ambiguity heuristic for optional pre-plan clarifications.
 * We trigger at most two questions when the prompt appears underspecified:
 * short requests, missing explicit scope boundaries, or missing output-shape hints.
 */
function buildClarifyingQuestions(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/).filter(Boolean);
  const questions: string[] = [];

  if (words.length < CLARIFY_MIN_WORDS) {
    questions.push('What specific output do you need (for example: comparison, ranked list, implementation steps)?');
  }
  if (!SCOPE_BOUNDARY_PATTERN.test(trimmed)) {
    questions.push('Any scope boundaries we should enforce (timeline, geography, budget, or target audience)?');
  }
  if (!OUTPUT_FORMAT_PATTERN.test(trimmed)) {
    questions.push('How should results be organized (ranked options, narrative briefing, or step-by-step guide)?');
  }
  return questions.slice(0, 2);
}

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
      return startResearch({
        query: query.trim(),
        supplemental: `${supplemental.trim()}${extra}`.trim() || undefined,
        engineVersion: selectedEngineVersion,
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
    const generated = buildClarifyingQuestions(query);
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
