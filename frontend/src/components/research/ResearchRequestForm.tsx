import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronUp,
  CheckSquare,
  FlaskConical,
  Loader2,
  RotateCcw,
  Send,
  Settings2,
  Square,
} from 'lucide-react';
import clsx from 'clsx';
import AttachmentDropZone from './AttachmentDropZone';
import ChallengePerspectiveSelector from './ChallengePerspectiveSelector';
import ResearchClarificationChat from './ResearchClarificationChat';
import ResearchOutputControls, {
  type ReportLengthPreset,
  normalizeReportFormats,
  resolveTargetWordCount,
} from './ResearchOutputControls';
import RunAddonToggles from './RunAddonToggles';
import FreeLifetimeQuotaBanner from '../billing/FreeLifetimeQuotaBanner';
import {
  extractApiError,
  getResearchV2EnsemblePresets,
  listSavedOrchestrationProfiles,
  startResearch,
  type CitationStyleSlug,
  type ResearchObjective,
} from '../../utils/api';
import { objectivesForTier, type EntitlementTierKey } from '@/constants/researchObjectives';
import {
  effectiveEntitlementTier,
  useBillingSubscriptionQuery,
} from '../../hooks/useBillingSubscription';
import { useResearchRunAddons } from '../../hooks/useResearchRunAddons';
import { RESEARCH_RUN_ADDON_CATALOG_KEYS } from '../../utils/researchRunAddons';
import { useRequestPrefillFromRun } from '../../hooks/useRequestPrefillFromRun';
import { researchRequestFormFromRun } from '../../utils/researchOpenRun';
import {
  mergeSupplementalWithPerspective,
  splitSupplementalAndPerspective,
} from '../../utils/challengePerspective';
import { applySupplementalIngestNotifications } from '../../utils/supplementalIngestNotifications';
import { buildClarifyingQuestions } from '../../utils/clarifyingQuestions';
import { liveResearchUrl } from '../../utils/researchRunRoutes';
import { useStore } from '../../store/useStore';

type ModelRow = { primary?: string; fallback?: string; fallbackEnabled?: boolean };
type ObjectiveChoice = 'AUTO' | ResearchObjective;

/** The objective whose model line-up we show while the choice is still automatic. */
const OBJECTIVE_WHILE_AUTOMATIC: ResearchObjective = 'GENERAL_EPISTEMIC_RESEARCH';

function Disclosure({
  open,
  onToggle,
  label,
  testId,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-surface-100 rounded-lg overflow-hidden">
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-slate-300 hover:bg-surface-100/40 transition-colors"
        onClick={onToggle}
      >
        <span className="flex items-center gap-1.5">
          <Settings2 size={13} />
          {label}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open ? <div className="px-3 pb-3 pt-1 border-t border-surface-100 space-y-4">{children}</div> : null}
    </div>
  );
}

/**
 * The request form. There is one.
 *
 * It used to be three — EZ Research, Research Lab in Standard mode, and
 * Research Lab in Deep mode — behind two toggles, and which one you were
 * looking at decided things a research request has no business deciding:
 * whether the objective-specific model line-up applied at all, how hard the
 * challenge pass argued, and which of your allowances the report came out of.
 * Free-tier users could not reach the Deep form, so their reports came from a
 * materially weaker pipeline than the screenshots they had been shown.
 *
 * WO-AH removes the choice rather than the capabilities. Everything the Lab
 * form could do, this form can do; everything EZ made easy, it still makes
 * easy. What used to be Deep is now simply what a run is, and how hard to work
 * is decided from the request by the agents that run it.
 *
 * Submitting hands off to the run's own workspace at `/app/run/<id>`, which
 * leaves this form empty and ready for the next request — the operator's
 * requirement that a submitted request stops occupying the entry page.
 */
export default function ResearchRequestForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addNotification = useStore((s) => s.addNotification);

  const subscriptionQuery = useBillingSubscriptionQuery();
  // A failed lookup is UNKNOWN, not free.
  //
  // `!isLoading` alone marked the tier resolved when `/billing/subscription`
  // errored with nothing cached, and the fallback is `free_demo` — so a paid
  // user whose lookup failed lost saved profiles, lost the objectives their
  // tier allows, and had any objective they had already chosen reset to
  // automatic by the effect below (Codex P2, PR #229).
  const tierResolved =
    subscriptionQuery.authReady &&
    !subscriptionQuery.isLoading &&
    !(subscriptionQuery.isError && !subscriptionQuery.data);
  const userTier: EntitlementTierKey | null = tierResolved
    ? ((effectiveEntitlementTier(subscriptionQuery.data) ?? 'free_demo') as EntitlementTierKey)
    : null;
  const tierLookupFailed = Boolean(
    subscriptionQuery.authReady && subscriptionQuery.isError && !subscriptionQuery.data
  );
  const tierAllowsSavedProfiles = Boolean(userTier && userTier !== 'free_demo');
  const objectiveOptions = useMemo(() => objectivesForTier(userTier), [userTier]);

  // ── The request ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [supplemental, setSupplemental] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [siteCrawlEnabled, setSiteCrawlEnabled] = useState(false);
  const [crawlLayers, setCrawlLayers] = useState(2);
  const [challengePerspective, setChallengePerspective] = useState('');

  // ── How the answer should come out ──────────────────────────────────────
  const [objective, setObjective] = useState<ObjectiveChoice>('AUTO');
  const [reportFormats, setReportFormats] = useState<string[]>(['automatic']);
  const [reportLengthPreset, setReportLengthPreset] = useState<ReportLengthPreset>('standard');
  const [reportLengthCustom, setReportLengthCustom] = useState(2200);
  const [citationStyle, setCitationStyle] = useState<CitationStyleSlug>('apa');

  // ── Everything the Lab used to hold ─────────────────────────────────────
  const [filterTags, setFilterTags] = useState('');
  const [savedOrchestrationProfileId, setSavedOrchestrationProfileId] = useState('');
  const [modelRows, setModelRows] = useState<Record<string, ModelRow>>({});

  const [outputOpen, setOutputOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);

  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyQuestions, setClarifyQuestions] = useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);

  const { selectedAddons, selectedAddonsForSubmit, toggleAddon, syncAddonsToUrl } =
    useResearchRunAddons(RESEARCH_RUN_ADDON_CATALOG_KEYS);

  const { data: ensembleData } = useQuery({
    queryKey: ['research-v2-ensemble-presets'],
    queryFn: getResearchV2EnsemblePresets,
    staleTime: 60_000,
  });

  const { data: savedProfiles = [] } = useQuery({
    queryKey: ['saved-orchestration-profiles'],
    queryFn: () => listSavedOrchestrationProfiles().then((r) => r.profiles),
    enabled: tierAllowsSavedProfiles,
  });

  // A tier that loses access to an objective must not keep submitting it.
  useEffect(() => {
    if (!tierResolved || objective === 'AUTO') return;
    if (!objectiveOptions.some((o) => o.value === objective)) setObjective('AUTO');
  }, [objective, objectiveOptions, tierResolved]);

  const presetObjective: ResearchObjective =
    objective === 'AUTO' ? OBJECTIVE_WHILE_AUTOMATIC : objective;
  const presetForObjective = ensembleData?.presets?.[presetObjective];

  // Cancelling at the plan gate comes back here as `?prefill=<runId>`, because
  // cancel means "let me edit it", not "throw away what I typed".
  //
  // Every prefillable field is reset to its default FIRST, then the run's own
  // values applied. Assigning only the fields the run happens to carry left
  // the rest of the previous request in place, so a second `?prefill=` on a
  // still-mounted form could submit one request carrying another request's
  // objective, citation style, formats, word target or model overrides
  // (Codex P2, PR #229).
  useRequestPrefillFromRun((run) => {
    const slice = researchRequestFormFromRun(run);
    const { supplemental: body, challengePerspective: perspective } =
      splitSupplementalAndPerspective(slice.supplemental);
    setQuery(slice.query);
    setSupplemental(body);
    setChallengePerspective(perspective);
    setUrls(slice.supplementalUrlLines);
    setFiles([]);
    setSiteCrawlEnabled(false);
    setCrawlLayers(2);
    setFilterTags(slice.filterTags);

    setObjective(slice.researchObjective ?? 'AUTO');
    setCitationStyle(slice.citationStyle ?? 'apa');
    setReportFormats(slice.requestedFormats?.length ? slice.requestedFormats : ['automatic']);
    if (typeof slice.targetWordCount === 'number') {
      setReportLengthPreset('custom');
      setReportLengthCustom(slice.targetWordCount);
    } else {
      setReportLengthPreset('standard');
      setReportLengthCustom(2200);
    }

    const overrides = run.model_overrides as Record<string, ModelRow> | undefined;
    const hasOverrides =
      Boolean(overrides) && typeof overrides === 'object' && Object.keys(overrides!).length > 0;
    setModelRows(hasOverrides ? overrides! : {});
    setModelsOpen(hasOverrides);
    // Anything the user had opened, they will want open again.
    setSourcesOpen(Boolean(body.trim()) || slice.supplementalUrlLines.length > 0 || Boolean(slice.filterTags));
    setOutputOpen(Boolean(slice.requestedFormats?.length) || typeof slice.targetWordCount === 'number');
  });

  const clarityBlock = useMemo(() => {
    const lines = clarifyQuestions
      .map((question, idx) => {
        const answer = (clarifyAnswers[idx] ?? '').trim();
        return answer ? `- ${question}\n  ${answer}` : '';
      })
      .filter(Boolean);
    return lines.length > 0 ? `Clarifications:\n${lines.join('\n')}` : '';
  }, [clarifyAnswers, clarifyQuestions]);

  const resolvedFormats = normalizeReportFormats(reportFormats);
  const requestedFormats = resolvedFormats.includes('automatic') ? undefined : resolvedFormats;
  // Only send a word target when the user actually chose one; otherwise the
  // planner decides length from the request like everything else.
  const targetWordCount =
    reportLengthPreset === 'standard'
      ? undefined
      : resolveTargetWordCount(reportLengthPreset, reportLengthCustom);

  const modelOverrides = useMemo(() => {
    const out: Record<string, { primary?: string; fallback?: string }> = {};
    for (const [role, row] of Object.entries(modelRows)) {
      const primary = row.primary?.trim();
      const fallback = row.fallbackEnabled ? row.fallback?.trim() : undefined;
      if (!primary && !fallback) continue;
      out[role] = {
        ...(primary ? { primary } : {}),
        ...(fallback ? { fallback } : {}),
      };
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [modelRows]);

  const mutation = useMutation({
    mutationFn: (opts: { includeClarifications: boolean }) => {
      const extra = opts.includeClarifications && clarityBlock ? `\n\n${clarityBlock}` : '';
      const supplementalBody = `${supplemental.trim()}${extra}`.trim();
      const tags = filterTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      return startResearch({
        query: query.trim(),
        supplemental: mergeSupplementalWithPerspective(supplementalBody, challengePerspective),
        filterTags: tags.length > 0 ? tags : undefined,
        modelOverrides,
        // 'AUTO' deliberately sends nothing: the server records that the user
        // made no choice, so intent classification is free to pick.
        ...(objective === 'AUTO' ? {} : { researchObjective: objective }),
        requestedResearchObjective: objective,
        supplementalFiles: files,
        supplementalUrls: urls,
        supplementalUrlCrawl:
          urls.length > 0 ? { siteCrawl: siteCrawlEnabled, crawlLayers } : undefined,
        requestedFormats,
        targetWordCount,
        citationStyle,
        savedOrchestrationProfileId: savedOrchestrationProfileId || undefined,
        addons: selectedAddonsForSubmit.length > 0 ? selectedAddonsForSubmit : undefined,
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      syncAddonsToUrl();
      applySupplementalIngestNotifications(data.supplementalIngest, addNotification, {
        researchLabel: 'Research',
        defaultStartedMessage: 'Research started — tracking detailed progress...',
      });
      navigate(liveResearchUrl(data.runId, { focusPlan: true }));
    },
    onError: (err) => {
      addNotification('error', extractApiError(err));
    },
  });

  const busy = mutation.isPending;

  const submit = useCallback(() => {
    if (!query.trim() || busy) return;
    const generated = buildClarifyingQuestions(query, { reportFormats: resolvedFormats });
    if (generated.length === 0) {
      mutation.mutate({ includeClarifications: false });
      return;
    }
    setClarifyQuestions(generated);
    setClarifyAnswers(Array.from({ length: generated.length }, () => ''));
    setClarifyOpen(true);
  }, [busy, mutation, query, resolvedFormats]);

  return (
    <div className="space-y-5">
      <FreeLifetimeQuotaBanner />

      <form
        className="card-glow p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {tierLookupFailed ? (
          <p className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
            We could not check your plan just now, so options that depend on it are hidden. Your
            request will still run — reload if you need them.
          </p>
        ) : null}
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <FlaskConical size={18} className="text-accent" />
            New research
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Describe what you need to know, find, or produce. We write a plan and show it to you
            before any of it runs.
          </p>
        </div>

        <div>
          <label className="section-title block mb-2" htmlFor="research-query">
            Your research question or task
          </label>
          <textarea
            id="research-query"
            className="textarea min-h-28 text-base w-full"
            placeholder="What do you need to know, compare, or produce?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={busy}
          />
        </div>

        <div>
          <label className="section-title block mb-2" htmlFor="research-supplemental">
            Extra context (optional)
          </label>
          <textarea
            id="research-supplemental"
            className="textarea min-h-20 w-full text-sm"
            placeholder="Constraints, must-use sources, or what a good answer looks like."
            value={supplemental}
            onChange={(e) => setSupplemental(e.target.value)}
            disabled={busy}
          />
        </div>

        <AttachmentDropZone
          files={files}
          urls={urls}
          onChange={({ files: nextFiles, urls: nextUrls }) => {
            setFiles(nextFiles);
            setUrls(nextUrls);
          }}
          disabled={busy}
          label="Documents and links (optional)"
          description="Anything here is read alongside the sources we find, not instead of them."
          mode="research"
          siteCrawlEnabled={siteCrawlEnabled}
          crawlLayers={crawlLayers}
          onSiteCrawlChange={({ enabled, crawlLayers: nextLayers }) => {
            setSiteCrawlEnabled(enabled);
            setCrawlLayers(nextLayers);
          }}
        />

        <Disclosure
          open={outputOpen}
          onToggle={() => setOutputOpen((v) => !v)}
          label="What the report should look like"
          testId="request-output-prefs-toggle"
        >
          <ResearchOutputControls
            objective={objective}
            onObjectiveChange={(v) => setObjective(v as ObjectiveChoice)}
            objectiveOptions={objectiveOptions}
            reportFormats={reportFormats}
            onReportFormatsChange={setReportFormats}
            reportLengthPreset={reportLengthPreset}
            onReportLengthPresetChange={setReportLengthPreset}
            reportLengthCustom={reportLengthCustom}
            onReportLengthCustomChange={setReportLengthCustom}
            citationStyle={citationStyle}
            onCitationStyleChange={setCitationStyle}
            disabled={busy}
            compact
          />
        </Disclosure>

        <Disclosure
          open={sourcesOpen}
          onToggle={() => setSourcesOpen((v) => !v)}
          label="Sources and challenge"
          testId="request-sources-toggle"
        >
          <ChallengePerspectiveSelector
            value={challengePerspective}
            onChange={setChallengePerspective}
            disabled={busy}
          />

          <div>
            <label className="section-title block mb-2" htmlFor="research-filter-tags">
              Limit your own library to these tags (optional)
            </label>
            <input
              id="research-filter-tags"
              type="text"
              className="input w-full"
              placeholder="biology, oncology, metabolism"
              value={filterTags}
              onChange={(e) => setFilterTags(e.target.value)}
              disabled={busy}
            />
          </div>

          {tierResolved && tierAllowsSavedProfiles ? (
            <div>
              <label className="section-title block mb-2" htmlFor="saved-orch-profile">
                Saved run settings (optional)
              </label>
              <select
                id="saved-orch-profile"
                className="input w-full md:max-w-md"
                value={savedOrchestrationProfileId}
                onChange={(e) => setSavedOrchestrationProfileId(e.target.value)}
                disabled={busy}
              >
                <option value="">None — decide from this request</option>
                {savedProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isShared ? ' (shared)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Starts the plan from settings you saved earlier. You still see the plan before
                anything runs.
              </p>
            </div>
          ) : null}
        </Disclosure>

        {presetForObjective ? (
          <Disclosure
            open={modelsOpen}
            onToggle={() => setModelsOpen((v) => !v)}
            label="Which models do the work"
            testId="request-models-toggle"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">
                {objective === 'AUTO'
                  ? 'Defaults while the objective is chosen automatically. Edits apply to this run only.'
                  : 'Defaults for the objective you chose. Edits apply to this run only.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs flex items-center gap-1 border border-accent/30 text-accent px-2 py-1 rounded-lg"
                  disabled={busy}
                  title="Allow a second model to take over for every role if the first one fails."
                  onClick={() => {
                    setModelRows((prev) => {
                      const next: Record<string, ModelRow> = { ...prev };
                      for (const role of Object.keys(presetForObjective)) {
                        const p = presetForObjective[role];
                        next[role] = {
                          ...next[role],
                          primary: next[role]?.primary ?? p.primary,
                          fallback: next[role]?.fallback?.trim() ? next[role].fallback : p.fallback,
                          fallbackEnabled: true,
                        };
                      }
                      return next;
                    });
                  }}
                >
                  <CheckSquare size={14} />
                  Allow all backups
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs flex items-center gap-1"
                  disabled={busy}
                  title="Turn the backup model off for every role."
                  onClick={() => {
                    setModelRows((prev) => {
                      const next: Record<string, ModelRow> = {};
                      for (const role of Object.keys(prev)) {
                        next[role] = { ...prev[role], fallbackEnabled: false };
                      }
                      return next;
                    });
                  }}
                >
                  <Square size={14} />
                  Clear all
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs flex items-center gap-1"
                  disabled={busy}
                  onClick={() => {
                    const rows: Record<string, ModelRow> = {};
                    for (const role of Object.keys(presetForObjective)) {
                      const p = presetForObjective[role];
                      rows[role] = { primary: p.primary, fallback: p.fallback, fallbackEnabled: false };
                    }
                    setModelRows(rows);
                  }}
                >
                  <RotateCcw size={14} />
                  Back to defaults
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.keys(presetForObjective).map((role) => (
                <div key={role} className="border border-indigo-900/20 rounded p-2 space-y-2">
                  <div className="text-xs text-slate-400 uppercase tracking-wide">
                    {role.replace(/_/g, ' ')}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
                      First choice
                    </div>
                    <input
                      className="input text-xs w-full"
                      placeholder={presetForObjective[role]?.primary ?? 'model id'}
                      value={modelRows[role]?.primary ?? ''}
                      onChange={(e) =>
                        setModelRows((prev) => ({
                          ...prev,
                          [role]: { ...prev[role], primary: e.target.value },
                        }))
                      }
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
                      Backup
                    </div>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1.5 rounded border-indigo-900/40 bg-surface-200 flex-shrink-0"
                        id={`fb-${role}`}
                        checked={modelRows[role]?.fallbackEnabled === true}
                        onChange={(e) =>
                          setModelRows((prev) => ({
                            ...prev,
                            [role]: { ...prev[role], fallbackEnabled: e.target.checked },
                          }))
                        }
                        disabled={busy}
                      />
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <label
                          htmlFor={`fb-${role}`}
                          className="text-[10px] text-slate-500 cursor-pointer block"
                        >
                          Use the backup if the first one fails
                        </label>
                        <input
                          className="input text-xs w-full"
                          placeholder={presetForObjective[role]?.fallback ?? 'backup model id'}
                          value={modelRows[role]?.fallback ?? ''}
                          onChange={(e) =>
                            setModelRows((prev) => ({
                              ...prev,
                              [role]: { ...prev[role], fallback: e.target.value },
                            }))
                          }
                          disabled={busy}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Disclosure>
        ) : null}

        <RunAddonToggles selected={selectedAddons} onToggle={toggleAddon} disabled={busy} />

        <button
          type="submit"
          className={clsx('btn-primary w-full py-3 text-base justify-center')}
          disabled={busy || !query.trim()}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {busy ? 'Starting…' : 'Plan my research'}
        </button>
      </form>

      {clarifyOpen ? (
        <ResearchClarificationChat
          questions={clarifyQuestions}
          answers={clarifyAnswers}
          onAnswerChange={(idx, value) =>
            setClarifyAnswers((prev) => prev.map((item, i) => (i === idx ? value : item)))
          }
          onContinueWithoutAnswers={() => {
            setClarifyOpen(false);
            mutation.mutate({ includeClarifications: false });
          }}
          onSubmitAnswers={() => {
            setClarifyOpen(false);
            mutation.mutate({ includeClarifications: true });
          }}
          busy={busy}
        />
      ) : null}
    </div>
  );
}
