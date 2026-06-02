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

const DEFAULT_HINT =
  'Follows same-origin links only (stays on the host you enter). Skips PDFs and media.';

const CRAWL_CHECKBOX_LABEL: Record<SiteCrawlTarget, string> = {
  research_run: 'Crawl attached site(s) into this run',
  private_corpus: 'Crawl attached site(s) into your private corpus',
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
          {CRAWL_CHECKBOX_LABEL[crawlTarget]}
          <span className="block text-xs text-slate-500 mt-0.5 font-normal">{hint}</span>
        </span>
      </label>
      {enabled && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <label className="text-xs text-slate-400" htmlFor="supplemental-crawl-layers">
            Layers to ingest
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
          <span className="text-xs text-slate-500">
            Layer 1 = seed URL; each extra layer follows links found on the previous layer (max 50 pages per
            seed).
          </span>
        </div>
      )}
    </div>
  );
}
