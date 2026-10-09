import { customerOption, customerOptionHelp } from '../../content/customerOptions';

const CRAWL = customerOption('request_field', 'crawl_site');
const LAYERS = customerOption('request_field', 'crawl_layers');

/** Where crawled pages are stored — run-scoped supplemental URLs vs private Ingest corpus. */
export type SiteCrawlTarget = 'research_run' | 'private_corpus';

export interface SiteCrawlControlsProps {
  enabled: boolean;
  crawlLayers: number;
  onEnabledChange: (enabled: boolean) => void;
  onLayersChange: (layers: number) => void;
  disabled?: boolean;
  /** Shown under the checkbox label. */
  hint?: string;
  /** Default `research_run` (supplemental URLs on a research request). */
  crawlTarget?: SiteCrawlTarget;
}

const DEFAULT_HINT = `${customerOptionHelp(CRAWL)} It stays on the website you entered and skips PDFs and media.`;

/** Where the pages go, said after the option's name. */
const CRAWL_TARGET_WORDS: Record<SiteCrawlTarget, string> = {
  research_run: 'for this run',
  private_corpus: 'into your private library',
};

export default function SiteCrawlControls({
  enabled,
  crawlLayers,
  onEnabledChange,
  onLayersChange,
  disabled = false,
  hint = DEFAULT_HINT,
  crawlTarget = 'research_run',
}: SiteCrawlControlsProps) {
  return (
    <div className="space-y-2 rounded-lg border border-indigo-900/40 bg-surface-200/50 p-3">
      <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          disabled={disabled}
          className="mt-0.5 rounded border-indigo-800"
        />
        <span>
          {CRAWL.name} ({CRAWL_TARGET_WORDS[crawlTarget]})
          <span className="block text-xs text-slate-500 mt-0.5 font-normal">{hint}</span>
        </span>
      </label>
      {enabled && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <label className="text-xs text-slate-400" htmlFor="supplemental-crawl-layers">
            {LAYERS.name}
          </label>
          <input
            id="supplemental-crawl-layers"
            type="number"
            min={2}
            max={5}
            value={crawlLayers}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onLayersChange(Math.min(5, Math.max(2, n)));
            }}
            disabled={disabled}
            className="input w-20 text-sm py-1"
          />
          <span className="text-xs text-slate-500">{customerOptionHelp(LAYERS)}</span>
        </div>
      )}
    </div>
  );
}
