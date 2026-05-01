import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import { GitFork, RefreshCw, Maximize2, Info, ZoomIn, ZoomOut } from 'lucide-react';
import { getKnowledgeGraph, type GraphNode, type GraphEdge } from '../utils/api';
import clsx from 'clsx';

const NODE_COLORS: Record<string, string> = {
  source: '#60a5fa',
  claim: '#a78bfa',
  run: '#34d399',
};

const TIER_COLORS: Record<string, string> = {
  established_fact: '#34d399',
  strong_evidence: '#60a5fa',
  testimony: '#a78bfa',
  inference: '#fbbf24',
  speculation: '#f87171',
};

const EDGE_COLORS: Record<string, string> = {
  contains: '#334155',
  contradicts: '#f87171',
  discovered: '#34d399',
};

type SimNode = d3.SimulationNodeDatum & GraphNode;
type SimEdge = d3.SimulationLinkDatum<SimNode> & { id: string; type: string; weight?: number };

export default function KnowledgeGraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [limit, setLimit] = useState(80);
  const [showContradictions, setShowContradictions] = useState(true);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['knowledge-graph', limit],
    queryFn: () => getKnowledgeGraph({ limit }),
    staleTime: 60_000,
  });

  const buildGraph = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !data || data.nodes.length === 0) return;

    const width = svg.clientWidth || 900;
    const height = svg.clientHeight || 600;

    const d3svg = d3.select(svg);
    d3svg.selectAll('*').remove();

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const edges: SimEdge[] = data.edges
      .filter((e) => {
        if (!showContradictions && e.type === 'contradicts') return false;
        return nodeMap.has(e.source) && nodeMap.has(e.target);
      })
      .map((e) => ({
        ...e,
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
      }));

    // Defs — arrow markers
    const defs = d3svg.append('defs');
    for (const [type, color] of Object.entries(EDGE_COLORS)) {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 14)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', color)
        .attr('fill-opacity', 0.7);
    }

    const container = d3svg.append('g').attr('class', 'graph-layer');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 8])
      .on('zoom', (e) => container.attr('transform', e.transform.toString()));
    d3svg.call(zoom);
    d3svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.7));
    (svg as unknown as { _zoom: typeof zoom })._zoom = zoom;

    // Force simulation
    const simulation = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimEdge>(edges)
        .id((d) => d.id)
        .distance((d) => d.type === 'contradicts' ? 80 : 120)
        .strength((d) => (d.weight ?? 1) * 0.3)
      )
      .force('charge', d3.forceManyBody().strength(-180))
      .force('collision', d3.forceCollide(18))
      .force('center', d3.forceCenter(0, 0));

    // Edges
    const edgeSel = container.append('g')
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(edges)
      .join('line')
      .attr('stroke', (d) => EDGE_COLORS[d.type] ?? '#334155')
      .attr('stroke-opacity', (d) => d.type === 'contradicts' ? 0.8 : 0.35)
      .attr('stroke-width', (d) => d.type === 'contradicts' ? 2 : 1)
      .attr('marker-end', (d) => `url(#arrow-${d.type})`);

    // Nodes
    const nodeGroup = container.append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer');

    nodeGroup.append('circle')
      .attr('r', (d) => d.type === 'source' ? 10 : 6)
      .attr('fill', (d) => {
        if (d.type === 'claim' && d.evidence_tier) return TIER_COLORS[d.evidence_tier] ?? NODE_COLORS.claim;
        return NODE_COLORS[d.type] ?? '#64748b';
      })
      .attr('fill-opacity', 0.85)
      .attr('stroke', '#1e293b')
      .attr('stroke-width', 1.5);

    nodeGroup.append('text')
      .attr('dx', 13)
      .attr('dy', '0.35em')
      .attr('font-size', '9px')
      .attr('fill', '#94a3b8')
      .text((d) => d.label.slice(0, 35) + (d.label.length > 35 ? '…' : ''));

    // Drag
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });
    nodeGroup.call(drag);

    // Tooltip + click
    const tooltip = d3.select(tooltipRef.current!);
    nodeGroup
      .on('mouseover', (event, d) => {
        tooltip.style('display', 'block')
          .style('left', `${event.offsetX + 14}px`)
          .style('top', `${event.offsetY - 10}px`)
          .html(
            `<div class="font-semibold text-white text-xs mb-0.5">${d.type}</div>` +
            `<div class="text-slate-300 text-[10px] leading-snug">${d.label}</div>` +
            (d.sub ? `<div class="text-slate-500 text-[10px] mt-0.5">${d.sub}</div>` : '')
          );
      })
      .on('mousemove', (event) => {
        tooltip.style('left', `${event.offsetX + 14}px`).style('top', `${event.offsetY - 10}px`);
      })
      .on('mouseout', () => tooltip.style('display', 'none'))
      .on('click', (_event, d) => setSelected(d));

    simulation.on('tick', () => {
      edgeSel
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);
      nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });
  }, [data, showContradictions]);

  useEffect(() => { buildGraph(); }, [buildGraph]);

  useEffect(() => {
    const obs = new ResizeObserver(() => buildGraph());
    if (svgRef.current) obs.observe(svgRef.current);
    return () => obs.disconnect();
  }, [buildGraph]);

  const handleZoom = (factor: number) => {
    const svg = svgRef.current;
    const zoom = (svg as unknown as { _zoom?: d3.ZoomBehavior<SVGSVGElement, unknown> })?._zoom;
    if (!svg || !zoom) return;
    d3.select(svg).transition().duration(300).call(zoom.scaleBy, factor);
  };

  const handleReset = () => {
    const svg = svgRef.current;
    const zoom = (svg as unknown as { _zoom?: d3.ZoomBehavior<SVGSVGElement, unknown> })?._zoom;
    if (!svg || !zoom) return;
    const w = svg.clientWidth || 900;
    const h = svg.clientHeight || 600;
    d3.select(svg).transition().duration(400)
      .call(zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(0.7));
  };

  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;
  const contradictionCount = data?.edges.filter((e) => e.type === 'contradicts').length ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-surface-100/20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitFork size={18} className="text-accent" />
          <h1 className="text-base font-bold text-white">Knowledge Graph</h1>
          {nodeCount > 0 && (
            <span className="text-xs text-slate-500">
              {nodeCount} nodes · {edgeCount} edges
              {contradictionCount > 0 && <span className="text-red-400 ml-1">· {contradictionCount} conflicts</span>}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              className="accent-red-400"
              checked={showContradictions}
              onChange={(e) => setShowContradictions(e.target.checked)}
            />
            Show contradictions
          </label>
          <select
            className="input h-7 text-xs w-28"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            <option value={40}>40 nodes</option>
            <option value={80}>80 nodes</option>
            <option value={150}>150 nodes</option>
            <option value={300}>300 nodes</option>
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
        {/* Graph canvas */}
        <div className="relative flex-1 bg-[#060810]">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm animate-pulse">
              Building graph…
            </div>
          )}
          {!isLoading && nodeCount === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
              <GitFork size={32} className="opacity-30" />
              <p className="text-sm">No corpus data yet. Run research to populate claims and sources.</p>
            </div>
          )}

          <svg ref={svgRef} className="w-full h-full" style={{ display: nodeCount > 0 ? 'block' : 'none' }} />

          <div ref={tooltipRef}
            className="pointer-events-none absolute hidden z-20 max-w-xs rounded-lg border border-surface-100/30 bg-surface-300/95 p-2.5 shadow-xl"
            style={{ display: 'none' }}
          />

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-1">
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={() => handleZoom(1.4)}><ZoomIn size={14} /></button>
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={() => handleZoom(1 / 1.4)}><ZoomOut size={14} /></button>
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={handleReset}><Maximize2 size={14} /></button>
          </div>

          {/* Legend */}
          <div className="absolute top-3 left-3 rounded-lg border border-surface-100/20 bg-surface-300/80 p-2.5 space-y-1.5">
            <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">Node types</div>
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-slate-400">{type}</span>
              </div>
            ))}
            <div className="border-t border-surface-100/20 pt-1.5 mt-1">
              <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">Edges</div>
              {Object.entries(EDGE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-4 h-px" style={{ backgroundColor: color }} />
                  <span className={clsx('text-[10px]', type === 'contradicts' ? 'text-red-400' : 'text-slate-400')}>{type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-shrink-0 w-72 border-l border-surface-100/20 flex flex-col">
          {selected ? (
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <button type="button" className="btn-ghost text-xs" onClick={() => setSelected(null)}>← Clear</button>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: NODE_COLORS[selected.type] ?? '#64748b' }}
                />
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{selected.type}</span>
              </div>
              <p className="text-sm text-white leading-snug">{selected.label}</p>
              {selected.sub && <p className="text-xs text-slate-500">{selected.sub}</p>}
              {selected.evidence_tier && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Evidence tier</div>
                  <span className="text-xs" style={{ color: TIER_COLORS[selected.evidence_tier] ?? '#64748b' }}>
                    {selected.evidence_tier.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
              {selected.url && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Source URL</div>
                  <a href={selected.url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline break-words">
                    {selected.url}
                  </a>
                </div>
              )}
              {selected.tags && selected.tags.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map((t) => <span key={t} className="badge text-[10px]">{t}</span>)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-600 p-6 text-center">
              <Info size={20} className="opacity-40" />
              <p className="text-xs leading-relaxed">Click any node to inspect it. Drag nodes to rearrange the layout. Red edges mark claim contradictions.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
