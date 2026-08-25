import { RESEARCH_OBJECTIVE_OPTIONS } from '@/constants/researchObjectives';
import { CITATION_STYLE_OPTIONS, type CitationStyleSlug } from '@/utils/api';
import clsx from 'clsx';

export type ResearchOutputObjectiveValue = 'AUTO' | (typeof RESEARCH_OBJECTIVE_OPTIONS)[number]['value'];
export type ReportLengthPreset = 'short' | 'standard' | 'long' | 'extra_long' | 'custom';

const REPORT_FORMAT_OPTIONS = [
  { value: 'automatic', label: 'Automatic / Best fit' },
  { value: 'ranked_options', label: 'Ranked options' },
  { value: 'narrative_briefing', label: 'Narrative briefing' },
  { value: 'step_by_step_guide', label: 'Step-by-step guide' },
  { value: 'comparison_table', label: 'Comparison table' },
  { value: 'structured_report', label: 'Structured report / Technical spec' },
] as const;

const LENGTH_OPTIONS: Array<{ value: ReportLengthPreset; label: string }> = [
  { value: 'short', label: 'Short (~1,200 words)' },
  { value: 'standard', label: 'Standard (~2,200 words)' },
  { value: 'long', label: 'Long (~4,000 words)' },
  { value: 'extra_long', label: 'Extra long (~7,000 words)' },
  { value: 'custom', label: 'Custom word count…' },
];

export interface ResearchOutputControlsProps {
  objective: string;
  onObjectiveChange: (v: string) => void;
  showObjective?: boolean;
  /**
   * Objectives this user may actually pick. Tiers do not all get the same set,
   * and offering one that the API will reject with a 403 is worse than not
   * offering it. Defaults to every objective when the caller has no tier
   * information to filter by.
   */
  objectiveOptions?: ReadonlyArray<{ value: string; label: string }>;
  reportFormats: string[];
  onReportFormatsChange: (v: string[]) => void;
  reportLengthPreset: ReportLengthPreset;
  onReportLengthPresetChange: (v: ResearchOutputControlsProps['reportLengthPreset']) => void;
  reportLengthCustom: number;
  onReportLengthCustomChange: (v: number) => void;
  citationStyle?: CitationStyleSlug;
  onCitationStyleChange?: (v: CitationStyleSlug) => void;
  disabled?: boolean;
  compact?: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export function resolveTargetWordCount(preset: string, custom: number): number {
  if (preset === 'short') return 1200;
  if (preset === 'standard') return 2200;
  if (preset === 'long') return 4000;
  if (preset === 'extra_long') return 7000;
  if (preset === 'custom') return Math.max(800, Math.min(12000, custom));
  return 2200;
}

// eslint-disable-next-line react-refresh/only-export-components
export function normalizeReportFormats(values: string[]): string[] {
  const filtered = values.filter((value): value is (typeof REPORT_FORMAT_OPTIONS)[number]['value'] =>
    REPORT_FORMAT_OPTIONS.some((option) => option.value === value)
  );
  if (filtered.includes('automatic')) return ['automatic'];
  return filtered.length > 0 ? Array.from(new Set(filtered)) : ['automatic'];
}

export default function ResearchOutputControls({
  objective,
  onObjectiveChange,
  showObjective = true,
  objectiveOptions = RESEARCH_OBJECTIVE_OPTIONS,
  reportFormats,
  onReportFormatsChange,
  reportLengthPreset,
  onReportLengthPresetChange,
  reportLengthCustom,
  onReportLengthCustomChange,
  citationStyle,
  onCitationStyleChange,
  disabled = false,
  compact = false,
}: ResearchOutputControlsProps) {
  const normalizedFormats = normalizeReportFormats(reportFormats);
  const targetWordCount = resolveTargetWordCount(reportLengthPreset, reportLengthCustom);

  const sectionClass = compact ? 'space-y-1.5' : 'space-y-2';
  const rowClass = compact ? 'grid gap-3 xl:grid-cols-4' : 'space-y-4';

  return (
    <div className={rowClass} data-testid="research-output-controls">
      {showObjective ? (
        <div className={sectionClass}>
          <label className="block">
            <span className="text-xs text-slate-300">Research Objective</span>
            <select
              className="input mt-1 w-full"
              value={objective}
              onChange={(e) => onObjectiveChange(e.target.value)}
              disabled={disabled}
            >
              <option value="AUTO">Automatic — ResearchOne selects from the request</option>
              {objectiveOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className={sectionClass}>
        <div className="text-xs text-slate-300">Report Format</div>
        <div className="mt-1 flex flex-wrap gap-2">
          {REPORT_FORMAT_OPTIONS.map((option) => {
            const selected = normalizedFormats.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={selected ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                onClick={() => {
                  if (option.value === 'automatic') {
                    onReportFormatsChange(['automatic']);
                    return;
                  }
                  const next = selected
                    ? normalizedFormats.filter((value) => value !== option.value)
                    : [...normalizedFormats.filter((value) => value !== 'automatic'), option.value];
                  onReportFormatsChange(next.length > 0 ? next : ['automatic']);
                }}
                disabled={disabled}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={sectionClass}>
        <div className="text-xs text-slate-300">Report Length</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select
            className="input w-full md:max-w-xs"
            value={reportLengthPreset}
            onChange={(e) => onReportLengthPresetChange(e.target.value as ReportLengthPreset)}
            disabled={disabled}
          >
            {LENGTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {reportLengthPreset === 'custom' ? (
            <input
              type="number"
              min={800}
              max={12000}
              step={100}
              className="input w-36"
              value={reportLengthCustom}
              onChange={(e) => onReportLengthCustomChange(Number(e.target.value) || 800)}
              disabled={disabled}
            />
          ) : null}
          <span className="text-xs text-slate-500">
            Target: <span className="font-mono text-slate-300">{targetWordCount.toLocaleString()}</span> words
          </span>
        </div>
      </div>

      {onCitationStyleChange && citationStyle ? (
        <div className={sectionClass}>
          <label className="block">
            <span className="text-xs text-slate-300">Citation Style</span>
            <select
              className={clsx('input mt-1 w-full', compact && 'xl:max-w-xs')}
              value={citationStyle}
              onChange={(e) => onCitationStyleChange(e.target.value as CitationStyleSlug)}
              disabled={disabled}
            >
              {CITATION_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
