import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { ArrowLeft, GitBranch, Send } from 'lucide-react';
import AttachmentDropZone from '@/components/research/AttachmentDropZone';
import {
  CITATION_STYLE_OPTIONS,
  extractApiError,
  fetchSpinoffPrefill,
  getResearchV2EnsemblePresets,
  startResearchSpinoff,
  type CitationStyleSlug,
  type ResearchObjective,
} from '@/utils/api';
import {
  defaultObjectiveForTier,
  objectivesForTier,
  RESEARCH_OBJECTIVE_OPTIONS,
  type EntitlementTierKey,
} from '@/constants/researchObjectives';
import { effectiveEntitlementTier, useBillingSubscriptionQuery } from '@/hooks/useBillingSubscription';
import { useStore } from '@/store/useStore';
import { liveResearchUrl } from '@/utils/researchRunRoutes';
import clsx from 'clsx';

function extractSpinoffError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { error?: string; detail?: string } | undefined;
    if (body?.detail) return body.detail;
    if (body?.error) return body.error;
  }
  return extractApiError(error);
}

export default function ReportSpinoffPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addNotification } = useStore();

  const { data: subscriptionData, isLoading: subLoading, isError: subError, authReady } =
    useBillingSubscriptionQuery();
  const tierResolved = authReady && !subLoading && (!subError || Boolean(subscriptionData));
  const userTier: EntitlementTierKey | null = tierResolved
    ? ((effectiveEntitlementTier(subscriptionData) ?? 'free_demo') as EntitlementTierKey)
    : null;
  const filteredObjectiveOptions = objectivesForTier(userTier);

  const [engineVersion, setEngineVersion] = useState<'v2' | 'standard'>('v2');
  const [query, setQuery] = useState('');
  const [supplemental, setSupplemental] = useState('');
  const [supplementalFiles, setSupplementalFiles] = useState<File[]>([]);
  const [supplementalUrls, setSupplementalUrls] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState('');
  const [researchObjective, setResearchObjective] = useState<ResearchObjective>('GENERAL_EPISTEMIC_RESEARCH');
  const [citationStyle, setCitationStyle] = useState<CitationStyleSlug>('apa');
  const [reportLengthPreset, setReportLengthPreset] = useState<'short' | 'standard' | 'long' | 'extra_long' | 'custom'>('standard');
  const [reportLengthCustom, setReportLengthCustom] = useState('2200');
  const [showModels, setShowModels] = useState(false);
  const [modelRows, setModelRows] = useState<
    Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }>
  >({});

  const { data: prefill, isLoading: prefillLoading } = useQuery({
    queryKey: ['spinoff-prefill', reportId],
    queryFn: () => fetchSpinoffPrefill(reportId!),
    enabled: Boolean(reportId),
    retry: false,
  });

  const { data: ensembleData } = useQuery({
    queryKey: ['research-v2-ensemble-presets'],
    queryFn: getResearchV2EnsemblePresets,
    staleTime: 60_000,
    enabled: engineVersion === 'v2',
  });

  useEffect(() => {
    if (!prefill) return;
    setQuery(prefill.query ?? '');
    setSupplemental(prefill.supplemental?.trim() ?? '');
    if (prefill.engineVersion === 'v2') setEngineVersion('v2');
    else if (prefill.engineVersion === 'v1') setEngineVersion('standard');
    if (prefill.researchObjective) {
      setResearchObjective(prefill.researchObjective as ResearchObjective);
    }
    if (prefill.citationStyle) {
      setCitationStyle(prefill.citationStyle as CitationStyleSlug);
    }
    if (prefill.filterTags?.length) {
      setFilterTags(prefill.filterTags.join(', '));
    }
    if (typeof prefill.targetWordCount === 'number') {
      setReportLengthPreset('custom');
      setReportLengthCustom(String(prefill.targetWordCount));
    }
  }, [prefill]);

  useEffect(() => {
    if (!tierResolved || !userTier) return;
    if (!filteredObjectiveOptions.some((o) => o.value === researchObjective)) {
      setResearchObjective(defaultObjectiveForTier(userTier));
    }
  }, [tierResolved, userTier, researchObjective, filteredObjectiveOptions]);

  useEffect(() => {
    if (engineVersion !== 'v2' || !ensembleData?.presets) return;
    const preset = ensembleData.presets[researchObjective];
    if (!prefill?.modelOverrides && preset) {
      const rows: Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }> = {};
      for (const role of Object.keys(preset)) {
        const p = preset[role];
        rows[role] = { primary: p.primary, fallback: p.fallback, fallbackEnabled: false };
      }
      setModelRows(rows);
    }
  }, [ensembleData, researchObjective, engineVersion, prefill?.modelOverrides]);

  useEffect(() => {
    const overrides = prefill?.modelOverrides;
    if (!overrides || typeof overrides !== 'object') return;
    const rows: Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }> = {};
    for (const [role, row] of Object.entries(overrides)) {
      if (!row || typeof row !== 'object') continue;
      const r = row as { primary?: string; fallback?: string; fallbackEnabled?: boolean };
      rows[role] = {
        primary: typeof r.primary === 'string' ? r.primary : undefined,
        fallback: typeof r.fallback === 'string' ? r.fallback : undefined,
        fallbackEnabled: r.fallbackEnabled === true,
      };
    }
    if (Object.keys(rows).length > 0) setModelRows(rows);
  }, [prefill?.modelOverrides]);

  const resolvedTargetWordCount = useMemo(() => {
    switch (reportLengthPreset) {
      case 'short':
        return 1200;
      case 'standard':
        return 2200;
      case 'long':
        return 4000;
      case 'extra_long':
        return 7000;
      case 'custom': {
        const parsed = Number(reportLengthCustom);
        const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 2200;
        return Math.max(800, Math.min(12000, Math.round(safe)));
      }
    }
  }, [reportLengthPreset, reportLengthCustom]);

  const runtimeOverridesPayload = useMemo(() => {
    if (engineVersion !== 'v2' || !ensembleData?.presets) return undefined;
    const baseline = ensembleData.presets[researchObjective];
    if (!baseline) return undefined;
    const payload: Record<string, unknown> = {};
    for (const role of Object.keys(baseline)) {
      const row = modelRows[role];
      payload[role] = {
        primary: (row?.primary?.trim() || baseline[role].primary).trim(),
        fallback: (row?.fallback?.trim() || baseline[role].fallback).trim(),
        fallbackEnabled: row?.fallbackEnabled === true,
      };
    }
    return Object.keys(payload).length > 0 ? payload : undefined;
  }, [modelRows, ensembleData, researchObjective, engineVersion]);

  const mutation = useMutation({
    mutationFn: () =>
      startResearchSpinoff(reportId!, {
        query: query.trim(),
        supplemental: supplemental.trim() || undefined,
        filterTags: filterTags ? filterTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        modelOverrides: runtimeOverridesPayload,
        engineVersion: engineVersion === 'v2' ? 'v2' : undefined,
        researchObjective,
        targetWordCount: resolvedTargetWordCount,
        supplementalFiles: supplementalFiles.length > 0 ? supplementalFiles : undefined,
        supplementalUrls: supplementalUrls.length > 0 ? supplementalUrls : undefined,
        citationStyle,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      addNotification('info', 'Spinoff research queued — opening live run.');
      navigate(liveResearchUrl(data.runId, { engineVersion: engineVersion === 'v2' ? 'v2' : 'v1' }));
    },
    onError: (err: unknown) => {
      addNotification('error', extractSpinoffError(err));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportId || !query.trim()) return;
    mutation.mutate();
  };

  if (!reportId) {
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <Link
        to={`/app/reports/${reportId}`}
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft size={14} />
        Back to report
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <GitBranch className="text-accent" size={22} />
          New research spinoff
        </h1>
        <p className="text-sm text-slate-400 mt-2">
          Starts a fresh research run that inherits context from{' '}
          <span className="text-slate-200">{prefill?.reportTitle ?? 'this report'}</span>. URLs and files
          are ingested asynchronously like a normal research request — not synchronous like in-place revision.
        </p>
      </div>

      {prefillLoading ? (
        <div className="card p-8 animate-pulse h-48" />
      ) : (
        <div className="card-glow p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="section-title block mb-2">Engine</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm border',
                    engineVersion === 'v2'
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-indigo-900/40 text-slate-400 hover:border-accent/30',
                  )}
                  onClick={() => setEngineVersion('v2')}
                  disabled={mutation.isPending}
                >
                  Deep (V2)
                </button>
                <button
                  type="button"
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm border',
                    engineVersion === 'standard'
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-indigo-900/40 text-slate-400 hover:border-accent/30',
                  )}
                  onClick={() => setEngineVersion('standard')}
                  disabled={mutation.isPending}
                >
                  Standard (V1)
                </button>
              </div>
            </div>

            <div>
              <label className="section-title block mb-2">Research query</label>
              <textarea
                className="textarea min-h-28"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={mutation.isPending}
                placeholder="What should this spinoff investigate?"
              />
            </div>

            <div>
              <label className="section-title block mb-2">Supplemental context</label>
              <textarea
                className="textarea min-h-20"
                value={supplemental}
                onChange={(e) => setSupplemental(e.target.value)}
                disabled={mutation.isPending}
                placeholder="Optional framing, constraints, or background"
              />
            </div>

            <AttachmentDropZone
              mode="research"
              files={supplementalFiles}
              urls={supplementalUrls}
              onChange={({ files, urls }) => {
                setSupplementalFiles(files);
                setSupplementalUrls(urls);
              }}
              disabled={mutation.isPending}
              label="Supplemental files and URLs"
            />

            <div>
              <label className="section-title block mb-2">Research objective</label>
              <select
                className="input w-full md:max-w-md"
                value={researchObjective}
                onChange={(e) => setResearchObjective(e.target.value as ResearchObjective)}
                disabled={mutation.isPending}
              >
                {(filteredObjectiveOptions.length ? filteredObjectiveOptions : RESEARCH_OBJECTIVE_OPTIONS).map(
                  (o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label className="section-title block mb-2">Report length</label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input md:max-w-xs"
                  value={reportLengthPreset}
                  onChange={(e) =>
                    setReportLengthPreset(e.target.value as typeof reportLengthPreset)
                  }
                  disabled={mutation.isPending}
                >
                  <option value="short">Short (~1,200 words)</option>
                  <option value="standard">Standard (~2,200 words)</option>
                  <option value="long">Long (~4,000 words)</option>
                  <option value="extra_long">Extra long (~7,000 words)</option>
                  <option value="custom">Custom</option>
                </select>
                {reportLengthPreset === 'custom' ? (
                  <input
                    type="number"
                    className="input w-28"
                    min={800}
                    max={12000}
                    value={reportLengthCustom}
                    onChange={(e) => setReportLengthCustom(e.target.value)}
                    disabled={mutation.isPending}
                  />
                ) : null}
              </div>
            </div>

            <div>
              <label className="section-title block mb-2">Citation style</label>
              <select
                className="input md:max-w-xs"
                value={citationStyle}
                onChange={(e) => setCitationStyle(e.target.value as CitationStyleSlug)}
                disabled={mutation.isPending}
              >
                {CITATION_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="section-title block mb-2">Corpus filter tags (optional)</label>
              <input
                className="input"
                placeholder="tag-one, tag-two"
                value={filterTags}
                onChange={(e) => setFilterTags(e.target.value)}
                disabled={mutation.isPending}
              />
            </div>

            {engineVersion === 'v2' && ensembleData?.presets?.[researchObjective] ? (
              <div className="space-y-2">
                <button
                  type="button"
                  className="text-sm text-accent hover:underline"
                  onClick={() => setShowModels((v) => !v)}
                >
                  {showModels ? 'Hide model overrides' : 'Model overrides (optional)'}
                </button>
                {showModels ? (
                  <div className="space-y-2 rounded-lg border border-indigo-900/30 p-3">
                    {Object.keys(ensembleData.presets[researchObjective]).map((role) => (
                      <div key={role} className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                        <span className="text-slate-400 uppercase tracking-wide self-center">{role}</span>
                        <input
                          className="input text-xs"
                          placeholder="Primary model"
                          value={modelRows[role]?.primary ?? ''}
                          onChange={(e) =>
                            setModelRows((prev) => ({
                              ...prev,
                              [role]: { ...prev[role], primary: e.target.value },
                            }))
                          }
                          disabled={mutation.isPending}
                        />
                        <input
                          className="input text-xs"
                          placeholder="Fallback model"
                          value={modelRows[role]?.fallback ?? ''}
                          onChange={(e) =>
                            setModelRows((prev) => ({
                              ...prev,
                              [role]: { ...prev[role], fallback: e.target.value },
                            }))
                          }
                          disabled={mutation.isPending}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              type="submit"
              className="btn-primary inline-flex items-center gap-2"
              disabled={!query.trim() || mutation.isPending}
            >
              <Send size={16} />
              {mutation.isPending ? 'Starting spinoff…' : 'Start spinoff research'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
