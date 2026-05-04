import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import { Layers, RefreshCw, ZoomIn, ZoomOut, Maximize2, Filter, Info } from 'lucide-react';
import { getAtlasPoints, type AtlasPoint } from '../utils/api';
import clsx from 'clsx';

const TIER_COLORS: Record<string, string> = {
  established_fact: '#34d399',
  strong_evidence: '#60a5fa',
  testimony: '#a78bfa',
  inference: '#fbbf24',
  speculation: '#f87171',
};

function tierColor(tier: string | null): string {
  return TIER_COLORS[tier ?? ''] ?? '#64748b';
}

const POINT_RADIUS = 4;
const HOVER_RADIUS = 7;

export default function EmbeddingAtlasPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<AtlasPoint | null>(null);
  const [filterTag, setFilterTag] = useState('');
  const [limit, setLimit] = useState(500);
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const { data: points = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['atlas-points', limit, filterTag],
    queryFn: () => getAtlasPoints({ limit, tags: filterTag || undefined }),
    staleTime: 120_000,
  });

  const buildChart = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;

    const width = svg.clientWidth || 900;
    const height = svg.clientHeight || 600;

    const d3svg = d3.select(svg);
    d3svg.selectAll('*').remove();

    // Normalise x/y to [0, 1] then map to viewport
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const pad = 40;

    const xScale = d3.scaleLinear().domain([xMin, xMax]).range([pad, width - pad]);
    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([height - pad, pad]);

    const g = d3svg.append('g').attr('class', 'points-layer');

    // Render points
    const circles = g
      .selectAll<SVGCircleElement, AtlasPoint>('circle')
      .data(points)
      .join('circle')
      .attr('cx', (d) => xScale(d.x))
      .attr('cy', (d) => yScale(d.y))
      .attr('r', POINT_RADIUS)
      .attr('fill', (d) => tierColor(d.evidence_tier))
      .attr('fill-opacity', 0.72)
      .attr('stroke', 'none')
      .style('cursor', 'pointer');

    // Use DOM text nodes in tooltip to prevent XSS from corpus content
    const tooltipEl = tooltipRef.current!;
    const tooltip = d3.select(tooltipEl);

    circles
      .on('mouseover', (event: MouseEvent, d: AtlasPoint) => {
        d3.select(event.currentTarget as SVGCircleElement)
          .attr('r', HOVER_RADIUS)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)
          .attr('fill-opacity', 1);
        tooltipEl.innerHTML = '';
        const titleEl = document.createElement('div');
        titleEl.className = 'font-semibold text-white text-xs mb-1 line-clamp-2';
        titleEl.textContent = d.source_title || 'Unknown source';
        tooltipEl.appendChild(titleEl);
        const tierEl = document.createElement('div');
        tierEl.className = 'text-slate-400 text-[10px] mb-1';
        tierEl.textContent = d.evidence_tier ?? 'unclassified';
        tooltipEl.appendChild(tierEl);
        const textEl = document.createElement('div');
        textEl.className = 'text-slate-300 text-[10px] leading-snug';
        textEl.textContent = d.text.slice(0, 120) + '…';
        tooltipEl.appendChild(textEl);
        tooltip
          .style('display', 'block')
          .style('left', `${event.offsetX + 14}px`)
          .style('top', `${event.offsetY - 10}px`);
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${event.offsetX + 14}px`)
          .style('top', `${event.offsetY - 10}px`);
      })
      .on('mouseout', (event: MouseEvent) => {
        d3.select(event.currentTarget as SVGCircleElement)
          .attr('r', POINT_RADIUS)
          .attr('stroke', 'none')
          .attr('fill-opacity', 0.72);
        tooltip.style('display', 'none');
      })
      .on('click', (_event, d) => setSelected(d));

    // Zoom behaviour
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 20])
      .on('zoom', (e) => {
        g.attr('transform', e.transform.toString());
        const rounded = Math.round(e.transform.k * 10) / 10;
        setZoomLevel((prev) => (prev === rounded ? prev : rounded));
      });
    zoomRef.current = zoom;
    d3svg.call(zoom);
  }, [points]);

  useEffect(() => {
    buildChart();
  }, [buildChart]);

  // Rebuild when container is resized
  useEffect(() => {
    const obs = new ResizeObserver(() => buildChart());
    if (svgRef.current) obs.observe(svgRef.current);
    return () => obs.disconnect();
  }, [buildChart]);

  const handleZoom = (factor: number) => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, factor);
  };

  const handleReset = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-surface-100/20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-accent" />
          <h1 className="text-base font-bold text-white">Embedding Atlas</h1>
          <span className="text-xs text-slate-500">— in-browser vector visualization</span>
          {points.length > 0 && (
            <span className="badge bg-accent/10 text-accent border border-accent/20 text-[10px]">
              {points.length.toLocaleString()} points
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Tag filter */}
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-500" />
            <input
              className="input h-7 text-xs w-40"
              placeholder="filter by tag…"
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
            />
          </div>
          {/* Limit selector */}
          <select
            className="input h-7 text-xs w-24"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            <option value={100}>100 pts</option>
            <option value={300}>300 pts</option>
            <option value={500}>500 pts</option>
            <option value={1000}>1000 pts</option>
            <option value={2000}>2000 pts</option>
          </select>
          <button
            type="button"
            className="btn-ghost h-7 text-xs flex items-center gap-1"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            Reload
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div className="relative flex-1 bg-[#060810]">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-slate-500 text-sm animate-pulse">Loading embeddings…</div>
            </div>
          )}
          {!isLoading && points.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Layers size={32} className="opacity-30" />
              <p className="text-sm">No embedded chunks yet. Ingest documents and run embedding first.</p>
            </div>
          )}

          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ display: points.length > 0 ? 'block' : 'none' }}
          />

          {/* Tooltip */}
          <div
            ref={tooltipRef}
            className="pointer-events-none absolute hidden z-20 max-w-xs rounded-lg border border-surface-100/30 bg-surface-300/95 p-2.5 shadow-xl"
            style={{ display: 'none' }}
          />

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-1">
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={() => handleZoom(1.4)} title="Zoom in">
              <ZoomIn size={14} />
            </button>
            <div className="text-[10px] text-slate-500 text-center tabular-nums">{zoomLevel}×</div>
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={() => handleZoom(1 / 1.4)} title="Zoom out">
              <ZoomOut size={14} />
            </button>
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={handleReset} title="Reset view">
              <Maximize2 size={14} />
            </button>
          </div>

          {/* Legend */}
          <div className="absolute top-3 left-3 rounded-lg border border-surface-100/20 bg-surface-300/80 p-2.5 space-y-1">
            {Object.entries(TIER_COLORS).map(([tier, color]) => (
              <div key={tier} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-slate-400">{tier.replace(/_/g, ' ')}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-slate-500" />
              <span className="text-[10px] text-slate-400">unclassified</span>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-shrink-0 w-72 border-l border-surface-100/20 flex flex-col">
          {selected ? (
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setSelected(null)}
              >
                ← Clear
              </button>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Source</div>
                {selected.source_url ? (
                  <a
                    href={selected.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline break-words"
                  >
                    {selected.source_title || selected.source_url}
                  </a>
                ) : (
                  <p className="text-xs text-slate-300">{selected.source_title || 'Unknown'}</p>
                )}
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Evidence tier</div>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: `${tierColor(selected.evidence_tier)}20`, color: tierColor(selected.evidence_tier) }}
                >
                  {selected.evidence_tier ?? 'unclassified'}
                </span>
              </div>
              {selected.tags.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map((t) => (
                      <span key={t} className="badge text-[10px]">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Chunk text</div>
                <p className="text-xs text-slate-300 leading-relaxed bg-surface-200 rounded p-2">
                  {selected.text}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-600 p-6 text-center">
              <Info size={20} className="opacity-40" />
              <p className="text-xs leading-relaxed">
                Click any point to inspect the chunk text, source, and evidence tier.
              </p>
              <div className="mt-4 space-y-2 text-left w-full">
                <div className={clsx('text-[10px] text-slate-500 p-2 rounded border border-surface-100/20')}>
                  <strong className="text-research-teal">Dense clusters</strong> — mainstream or repeated knowledge
                </div>
                <div className="text-[10px] text-slate-500 p-2 rounded border border-surface-100/20">
                  <strong className="text-amber-400">Outliers</strong> — potential anomalies, novel, or suppressed findings
                </div>
                <div className="text-[10px] text-slate-500 p-2 rounded border border-surface-100/20">
                  <strong className="text-accent">Bridges</strong> — sparse paths between clusters indicating hidden relationships
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
