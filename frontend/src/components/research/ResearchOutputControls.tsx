import { RESEARCH_OBJECTIVE_OPTIONS } from '@/constants/researchObjectives';
import { CITATION_STYLE_OPTIONS, type CitationStyleChoice } from '@/utils/api';
import {
  customerOption,
  customerOptionHelp,
  customerOptionsIn,
  findCustomerOption,
  type CustomerOption,
  type OptionGroup,
} from '@/content/customerOptions';
import clsx from 'clsx';

export type ResearchOutputObjectiveValue = 'AUTO' | (typeof RESEARCH_OBJECTIVE_OPTIONS)[number]['value'];
export type ReportLengthPreset = 'automatic' | 'short' | 'standard' | 'long' | 'extra_long' | 'custom';

const REPORT_FORMAT_VALUES = [
  'automatic',
  'ranked_options',
  'narrative_briefing',
  'step_by_step_guide',
  'comparison_table',
  'structured_report',
] as const;
type ReportFormatValue = (typeof REPORT_FORMAT_VALUES)[number];

const REPORT_LENGTH_VALUES: readonly ReportLengthPreset[] = ['automatic', 'short', 'standard', 'long', 'extra_long', 'custom'];

/** Every option of a control, named from the registry of customer-facing names. */
const named = <T extends string>(group: OptionGroup, values: readonly T[]): Array<{ value: T; words: CustomerOption }> =>
  values.map((value) => ({ value, words: customerOption(group, value) }));

const REPORT_FORMAT_OPTIONS = named('report_format', REPORT_FORMAT_VALUES);
const LENGTH_OPTIONS = named('report_length', REPORT_LENGTH_VALUES);
const FIELD = Object.fromEntries(customerOptionsIn('request_field').map((option) => [option.id, option]));

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
  citationStyle?: CitationStyleChoice;
  onCitationStyleChange?: (v: CitationStyleChoice) => void;
  disabled?: boolean;
  compact?: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export function resolveTargetWordCount(preset: string, custom: number): number | undefined {
  if (preset === 'automatic') return undefined;
  if (preset === 'short') return 1200;
  if (preset === 'standard') return 2200;
  if (preset === 'long') return 4000;
  if (preset === 'extra_long') return 7000;
  if (preset === 'custom') return Math.max(800, Math.min(12000, custom));
  return undefined;
}

// eslint-disable-next-line react-refresh/only-export-components
export function normalizeReportFormats(values: string[]): string[] {
  const filtered = values.filter((value): value is ReportFormatValue =>
    (REPORT_FORMAT_VALUES as readonly string[]).includes(value)
  );
  if (filtered.includes('automatic')) return ['automatic'];
  return filtered.length > 0 ? Array.from(new Set(filtered)) : ['automatic'];
}

/** What the chosen option does, with its example, under the control it belongs to. */
function OptionHelp({ option, testId }: { option: CustomerOption | undefined; testId: string }) {
  if (!option) return null;
  return (
    <p className="mt-1 text-[11px] leading-snug text-slate-500" data-testid={testId}>
      {customerOptionHelp(option)}
    </p>
  );
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
  const automaticObjective = customerOption('research_objective', 'AUTO');
  const defaultCitationStyle = customerOption('citation_style', 'automatic');

  const sectionClass = compact ? 'space-y-1.5' : 'space-y-2';
  const rowClass = compact ? 'grid gap-3 xl:grid-cols-4' : 'space-y-4';

  return (
    <div className={rowClass} data-testid="research-output-controls">
      {showObjective ? (
        <div className={sectionClass}>
          <label className="block">
            <span className="text-xs text-slate-300" title={FIELD.research_objective.description}>
              {FIELD.research_objective.name}
            </span>
            <select
              className="input mt-1 w-full"
              value={objective}
              onChange={(e) => onObjectiveChange(e.target.value)}
              disabled={disabled}
            >
              <option value="AUTO">{automaticObjective.name}</option>
              {objectiveOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <OptionHelp option={findCustomerOption('research_objective', objective)} testId="objective-help" />
        </div>
      ) : null}

      <div className={sectionClass}>
        <div className="text-xs text-slate-300" title={FIELD.report_format.description}>
          {FIELD.report_format.name}
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {REPORT_FORMAT_OPTIONS.map((option) => {
            const selected = normalizedFormats.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={selected ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                title={customerOptionHelp(option.words)}
                aria-pressed={selected}
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
                {option.words.name}
              </button>
            );
          })}
        </div>
        {normalizedFormats.map((value) => (
          <OptionHelp key={value} option={findCustomerOption('report_format', value)} testId={`format-help-${value}`} />
        ))}
      </div>

      <div className={sectionClass}>
        <div className="text-xs text-slate-300" title={FIELD.report_length.description}>
          {FIELD.report_length.name}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select
            className="input w-full md:max-w-xs"
            value={reportLengthPreset}
            onChange={(e) => onReportLengthPresetChange(e.target.value as ReportLengthPreset)}
            disabled={disabled}
          >
            {LENGTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.words.name}
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
            {targetWordCount == null ? (
              'Automatic'
            ) : (
              <>
                Target: <span className="font-mono text-slate-300">{targetWordCount.toLocaleString()}</span> words
              </>
            )}
          </span>
        </div>
        <OptionHelp option={findCustomerOption('report_length', reportLengthPreset)} testId="length-help" />
      </div>

      {onCitationStyleChange && citationStyle ? (
        <div className={sectionClass}>
          <label className="block">
            <span className="text-xs text-slate-300" title={FIELD.citation_style.description}>
              {FIELD.citation_style.name}
            </span>
            <select
              className={clsx('input mt-1 w-full', compact && 'xl:max-w-xs')}
              value={citationStyle}
              onChange={(e) => onCitationStyleChange(e.target.value as CitationStyleChoice)}
              disabled={disabled}
            >
              <option value="automatic">{defaultCitationStyle.name}</option>
              {CITATION_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <OptionHelp option={findCustomerOption('citation_style', citationStyle)} testId="citation-help" />
        </div>
      ) : null}
    </div>
  );
}
