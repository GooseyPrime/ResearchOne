/**
 * ResearchDashboard - Main app dashboard for /app/research
 * Query input, mode selection, recent runs
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Search, ChevronRight, Zap, Shield, Layers, RefreshCw, UserX, ChevronDown } from 'lucide-react';
import { researchModes } from '@/content/researchoneUiData';
import { RecentRuns } from './RecentRuns';
import type { ResearchMode } from '@/lib/researchone/types';
import { extractApiError, startResearch, type ResearchObjective } from '@/utils/api';

export function ResearchDashboard() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedMode, setSelectedMode] = useState<ResearchMode>('standard');
  const [skepticPersona, setSkepticPersona] = useState('');
  const [isPersonaDropdownOpen, setIsPersonaDropdownOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const startRunMutation = useMutation({
    mutationFn: () => {
      const objectiveByMode: Record<ResearchMode, ResearchObjective> = {
        standard: 'GENERAL_EPISTEMIC_RESEARCH',
        deep: 'NOVEL_APPLICATION_DISCOVERY',
        adversarial: 'INVESTIGATIVE_SYNTHESIS',
        comprehensive: 'INVESTIGATIVE_SYNTHESIS',
      };
      return startResearch({
        query: query.trim(),
        engineVersion: 'v2',
        researchObjective: objectiveByMode[selectedMode],
        supplemental: skepticPersona.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      navigate(`/app/run/${data.runId}`);
    },
    onError: (err) => {
      setSubmitError(extractApiError(err));
    },
  });

  // Preset skeptic personas for red-team adversarial review
  const skepticPersonas = [
  { id: 'fda', label: 'FDA Compliance Officer', description: 'Regulatory scrutiny focus' },
  { id: 'peer', label: 'Hostile Peer Reviewer', description: 'Academic rigor challenge' },
  { id: 'defense', label: 'Defense Attorney', description: 'Adversarial cross-examination' },
  { id: 'investor', label: 'Skeptical Investor', description: 'Due diligence perspective' },
  { id: 'journalist', label: 'Investigative Journalist', description: 'Source verification focus' },
  { id: 'custom', label: 'Custom Persona', description: 'Define your own adversary' }];


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || startRunMutation.isPending) return;
    setSubmitError(null);
    await startRunMutation.mutateAsync();
  };

  const modeIcons: Record<ResearchMode, typeof Zap> = {
    standard: Zap,
    deep: Layers,
    adversarial: Shield,
    comprehensive: RefreshCw
  };

  return (
    <div data-ev-id="ev_bf5bde3e12" className="pb-12 bg-r1-canvas">
      <div data-ev-id="ev_290d9442f5" className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div data-ev-id="ev_0f59412d37" className="mb-8">
          <span data-ev-id="ev_7cd3d0a599" className="r1-tag r1-tag-cyan mb-3 inline-flex">
            RESEARCH_CONSOLE
          </span>
          <h1 data-ev-id="ev_03c54ee6aa" className="text-2xl sm:text-3xl font-bold text-r1-heading">
            New Research
          </h1>
          <p data-ev-id="ev_21661deeee" className="mt-2 text-r1-muted">
            Enter your research objective. The multi-agent pipeline will plan, retrieve, 
            reason, and verify to produce a citation-backed dossier.
          </p>
        </div>

        {/* Main input panel */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="r1-panel p-6 lg:p-8 mb-8">

          <form data-ev-id="ev_beb0d77bd1" onSubmit={handleSubmit}>
            {submitError && (
              <div className="mb-4 p-3 rounded-lg bg-r1-red/10 border border-r1-skeptic/30 text-sm text-r1-skeptic">
                {submitError}
              </div>
            )}
            {/* Query input */}
            <div data-ev-id="ev_891cad828a" className="relative">
              <label data-ev-id="ev_2ceec6b071" htmlFor="research-query" className="sr-only">
                Research objective
              </label>
              <div data-ev-id="ev_42e75c357a" className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <Search className="w-5 h-5 text-r1-muted" />
              </div>
              <textarea data-ev-id="ev_ede5ddaac1"
              id="research-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter your research objective..."
              rows={3}
              className="w-full pl-12 pr-4 py-4 bg-r1-panel-lift border border-r1-border rounded-lg text-r1-text placeholder:text-r1-dim resize-none focus:outline-none focus:border-r1-cyan focus:ring-1 focus:ring-r1-cyan transition-colors" />

            </div>

            {/* Mode selection */}
            <div data-ev-id="ev_ba97e984a5" className="mt-6">
              <div data-ev-id="ev_14febf1e43" className="flex items-center gap-2 mb-3">
                <span data-ev-id="ev_5d7031adf2" className="r1-mono-label text-[10px]">RESEARCH_MODE</span>
              </div>
              <div data-ev-id="ev_4b23d2cbb5" className="grid sm:grid-cols-2 gap-4">
                {researchModes.map((mode) => {
                  const Icon = modeIcons[mode.id];
                  const isSelected = selectedMode === mode.id;

                  return (
                    <button data-ev-id="ev_ec1f3e7479"
                    key={mode.id}
                    type="button"
                    onClick={() => setSelectedMode(mode.id)}
                    className={`p-5 rounded-lg border text-left transition-all duration-200 r1-focus-ring ${
                    isSelected ?
                    'bg-r1-cyan/10 border-r1-cyan/50 ring-1 ring-r1-cyan/30' :
                    'bg-r1-panel-lift border-r1-border hover:border-r1-border-strong'}`
                    }>

                      <div data-ev-id="ev_5b13061532" className="flex items-center gap-2.5 mb-2">
                        <Icon className={`w-4 h-4 flex-shrink-0 ${
                        isSelected ? 'text-r1-cyan' : 'text-r1-muted'}`
                        } />
                        <span data-ev-id="ev_f92a70154e" className={`text-sm font-medium leading-tight ${
                        isSelected ? 'text-r1-cyan' : 'text-r1-heading'}`
                        }>
                          {mode.label}
                        </span>
                      </div>
                      <p data-ev-id="ev_b1d846aa82" className="text-sm text-r1-muted leading-relaxed">
                        {mode.description}
                      </p>
                    </button>);

                })}
              </div>
            </div>

            {/* Skeptic Persona Selector */}
            <div data-ev-id="ev_b530edffac" className="mt-6">
              <div data-ev-id="ev_80203b1d37" className="flex items-center gap-2 mb-3">
                <UserX className="w-4 h-4 text-r1-skeptic" />
                <span data-ev-id="ev_21f1d75802" className="r1-mono-label text-[10px]">SKEPTIC_PERSONA</span>
                <span data-ev-id="ev_11896380d8" className="text-[9px] text-r1-muted">(Red-Team Adversary)</span>
              </div>
              <div data-ev-id="ev_2a71c6416c" className="relative">
                <button data-ev-id="ev_6a9e6eaa7a"
                type="button"
                onClick={() => setIsPersonaDropdownOpen(!isPersonaDropdownOpen)}
                className="w-full flex items-center justify-between px-4 py-3 bg-r1-panel-lift border border-r1-border rounded-lg text-left hover:border-r1-border-strong transition-colors r1-focus-ring">

                  <span data-ev-id="ev_3e6706cd03" className={skepticPersona ? 'text-r1-text' : 'text-r1-muted'}>
                    {skepticPersona || 'Select adversarial persona (optional)'}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-r1-muted transition-transform ${isPersonaDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {isPersonaDropdownOpen &&
                <div data-ev-id="ev_b0f49e7f3a" className="absolute z-20 w-full mt-2 bg-r1-panel border border-r1-border rounded-lg shadow-lg overflow-hidden">
                    {skepticPersonas.map((persona) =>
                  <button data-ev-id="ev_65a7dd9051"
                  key={persona.id}
                  type="button"
                  onClick={() => {
                    setSkepticPersona(persona.id === 'custom' ? '' : persona.label);
                    setIsPersonaDropdownOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-r1-panel-lift transition-colors border-b border-r1-border last:border-b-0">

                        <div data-ev-id="ev_d2a31bc7de">
                          <div data-ev-id="ev_a57a381067" className="text-sm font-medium text-r1-heading">{persona.label}</div>
                          <div data-ev-id="ev_afef8a3a97" className="text-xs text-r1-muted">{persona.description}</div>
                        </div>
                        {skepticPersona === persona.label &&
                    <div data-ev-id="ev_8e4d0516c0" className="w-2 h-2 rounded-full bg-r1-skeptic" />
                    }
                      </button>
                  )}
                  </div>
                }
              </div>
              {skepticPersona &&
              <p data-ev-id="ev_dfc9510853" className="mt-2 text-xs text-r1-muted">
                  The Skeptic agent will adopt the <span data-ev-id="ev_f71989a198" className="text-r1-skeptic font-medium">{skepticPersona}</span> perspective during adversarial review.
                </p>
              }
            </div>

            {/* Submit button */}
            <div data-ev-id="ev_73300c3b5e" className="mt-6 flex items-center justify-between">
              <div data-ev-id="ev_56f1e8c5ae" className="r1-mono-label text-[9px] text-r1-dim">
                {query.length > 0 ? `${query.length} CHARS` : 'AWAITING_INPUT'}
              </div>
              <button data-ev-id="ev_7e25beca55"
              type="submit"
              disabled={!query.trim() || startRunMutation.isPending}
              className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold bg-r1-cyan text-r1-canvas rounded hover:bg-r1-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 r1-focus-ring r1-glow-cyan">

                {startRunMutation.isPending ?
                <>
                    <div data-ev-id="ev_7618c30d99" className="w-4 h-4 border-2 border-r1-canvas/30 border-t-r1-canvas rounded-full animate-spin" />
                    Initializing...
                  </> :

                <>
                    Start Research
                    <ChevronRight className="w-4 h-4" />
                  </>
                }
              </button>
            </div>
          </form>
        </motion.div>

        {/* Recent runs */}
        <RecentRuns />
      </div>
    </div>);

}

export default ResearchDashboard;