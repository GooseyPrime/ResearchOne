import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import { GitFork, RefreshCw, Info, ZoomIn, ZoomOut, Focus } from 'lucide-react';
import { getKnowledgeGraph, extractApiError, type GraphNode } from '../utils/api';
import clsx from 'clsx';
import {
  TIER_COLORS,
  EDGE_COLORS,
  SIZE_PRESET_SCALE,
  buildDomainLegend,
  computeFitViewTransform,
  computeGraphBounds,
  nodeFill,
  nodeRadius,
  resolveNodeGroupKey,
  truncateLabel,
  type GraphColorMode,
  type GraphLabelMode,
  type GraphSizePreset,
} from '../lib/knowledgeGraphViz';

interface D3NodeDatum {
  index?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}
interface D3LinkDatum<N> {
  source: N | string | number;
  target: N | string | number;
  index?: number;
}
interface D3Simulation {
  stop(): this;
  restart(): this;
  on(typenames: string, listener: () => void): this;
  alphaTarget(alpha: number): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  force(name: string, force: any): this;
}
interface D3ZoomBehavior {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (selection: any): void;
  scaleExtent(extent: [number, number]): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(typenames: string, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scaleBy(selection: any, k: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform(selection: any, transform: unknown): void;
}

type SimNode = D3NodeDatum & GraphNode & { degree?: number };
type SimEdge = D3LinkDatum<SimNode> & { id: string; type: string; weight?: number };

const TYPE_LABELS: Record<GraphNode['type'], string> = {
  source: 'Source / publisher',
  claim: 'Claim',
};

export default function KnowledgeGraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<D3Simulation | null>(null);
  const zoomRef = useRef<D3ZoomBehavior | null>(null);
  const fitAfterLayoutRef = useRef(true);
  const layoutNodesRef = useRef<SimNode[]>([]);

  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [limit, setLimit] = useState(80);
  const [showContradictions, setShowContradictions] = useState(true);
  const [colorMode, setColorMode] = useState<GraphColorMode>('domain');
  const [sizePreset, setSizePreset] = useState<GraphSizePreset>('large');
  const [labelMode, setLabelMode] = useState<GraphLabelMode>('hover');
  const [zoomLevel, setZoomLevel] = useState(1);

  const sizeScale = SIZE_PRESET_SCALE[sizePreset];

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['knowledge-graph', limit],
    queryFn: () => getKnowledgeGraph({ limit }),
    staleTime: 60_000,
    retry: 1,
  });

  const domainLegend = useMemo(
    () => (data?.nodes ? buildDomainLegend(data.nodes) : []),
    [data?.nodes],
  );

  const applyFitView = useCallback((nodes: SimNode[], width: number, height: number) => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    const bounds = computeGraphBounds(nodes, 20 * sizeScale);
    if (!bounds) return;
    const t = computeFitViewTransform(bounds, width, height);
    d3.select(svg)
      .transition()
      .duration(450)
      .call(zoom.transform, d3.zoomIdentity.translate(t.x, t.y).scale(t.k));
    setZoomLevel(Math.round(t.k * 10) / 10);
  }, [sizeScale]);

  const buildGraph = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !data || data.nodes.length === 0) return;

    simulationRef.current?.stop();

    const width = svg.clientWidth || 900;
    const height = svg.clientHeight || 600;

    const d3svg = d3.select(svg);
    d3svg.selectAll('*').remove();

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n, degree: 0 }));
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

    const claimSourceDomain = new Map<string, string>();
    for (const e of edges) {
      if (e.type !== 'contains') continue;
      const src = e.source as SimNode;
      const tgt = e.target as SimNode;
      if (src.type === 'source' && tgt.type === 'claim') {
        claimSourceDomain.set(tgt.id, resolveNodeGroupKey(src));
      }
    }

    for (const e of edges) {
      const a = e.source as SimNode;
      const b = e.target as SimNode;
      a.degree = (a.degree ?? 0) + 1;
      b.degree = (b.degree ?? 0) + 1;
    }

    const defs = d3svg.append('defs');
    for (const [type, color] of Object.entries(EDGE_COLORS)) {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 16)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', color)
        .attr('fill-opacity', 0.7);
    }

    const container = d3svg.append('g').attr('class', 'graph-layer');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 12])
      .on('zoom', (e: { transform: { k: number; toString(): string } }) => {
        container.attr('transform', e.transform.toString());
        const rounded = Math.round(e.transform.k * 10) / 10;
        setZoomLevel((prev) => (prev === rounded ? prev : rounded));
      });
    d3svg.call(zoom);
    zoomRef.current = zoom;

    if (!fitAfterLayoutRef.current) {
      d3svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(1));
    }

    layoutNodesRef.current = nodes;
    const simulation = d3.forceSimulation<SimNode>(nodes);
    simulationRef.current = simulation;
    simulation
      .force(
        'link',
        d3
          .forceLink<SimNode, SimEdge>(edges)
          .id((d: SimNode) => d.id)
          .distance((d: SimEdge) => (d.type === 'contradicts' ? 90 : 130))
          .strength((d: SimEdge) => (d.weight ?? 1) * 0.28),
      )
      .force('charge', d3.forceManyBody().strength(-220 * sizeScale))
      .force('collision', d3.forceCollide<SimNode>().radius((d) => nodeRadius(d, sizeScale, d.degree ?? 0) + 6))
      .force('center', d3.forceCenter(0, 0));

    const edgeSel = container
      .append('g')
      .attr('class', 'graph-edges')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', (d: SimEdge) => EDGE_COLORS[d.type] ?? '#334155')
      .attr('stroke-opacity', (d: SimEdge) => (d.type === 'contradicts' ? 0.85 : 0.4))
      .attr('stroke-width', (d: SimEdge) => (d.type === 'contradicts' ? 2.5 : 1.25))
      .attr('marker-end', (d: SimEdge) => `url(#arrow-${d.type})`);

    const nodeGroup = container
      .append('g')
      .attr('class', 'graph-nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .attr('class', 'graph-node')
      .style('cursor', 'pointer');

    nodeGroup
      .append('rect')
      .attr('class', 'node-shape-source')
      .attr('display', (d) => (d.type === 'source' ? null : 'none'))
      .attr('rx', 5)
      .attr('ry', 5)
      .attr('width', (d) => nodeRadius(d, sizeScale, d.degree ?? 0) * 2.1)
      .attr('height', (d) => nodeRadius(d, sizeScale, d.degree ?? 0) * 1.5)
      .attr('x', (d) => -nodeRadius(d, sizeScale, d.degree ?? 0) * 1.05)
      .attr('y', (d) => -nodeRadius(d, sizeScale, d.degree ?? 0) * 0.75)
      .attr('fill', (d) => nodeFill(d, colorMode, claimSourceDomain.get(d.id)))
      .attr('fill-opacity', 0.9)
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 2);

    nodeGroup
      .append('circle')
      .attr('class', 'node-shape-claim')
      .attr('display', (d) => (d.type === 'claim' ? null : 'none'))
      .attr('r', (d) => nodeRadius(d, sizeScale, d.degree ?? 0))
      .attr('fill', (d) => nodeFill(d, colorMode, claimSourceDomain.get(d.id)))
      .attr('fill-opacity', 0.9)
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 2);

    const fontSize = Math.round(11 * sizeScale);
    const labelSel = nodeGroup
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', (d) => nodeRadius(d, sizeScale, d.degree ?? 0) + fontSize * 0.85)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${fontSize}px`)
      .attr('font-weight', 500)
      .attr('fill', '#cbd5e1')
      .attr('pointer-events', 'none')
      .text((d) => truncateLabel(d.label, sizePreset === 'compact' ? 28 : 42));

    const updateLabelVisibility = (activeId: string | null, selectedId: string | null) => {
      labelSel.attr('opacity', (d) => {
        if (labelMode === 'always') return 1;
        if (labelMode === 'selected') return d.id === selectedId ? 1 : 0;
        if (d.id === activeId || d.id === selectedId) return 1;
        return 0;
      });
    };

    const applyFocusOpacity = (activeId: string | null) => {
      const neighborIds = new Set<string>();
      if (activeId) {
        neighborIds.add(activeId);
        for (const e of edges) {
          const src = e.source as SimNode;
          const tgt = e.target as SimNode;
          if (src.id === activeId) neighborIds.add(tgt.id);
          if (tgt.id === activeId) neighborIds.add(src.id);
        }
      }
      const focusActive = activeId != null;
      nodeGroup.attr('opacity', (d) => {
        if (!focusActive) return 1;
        return neighborIds.has(d.id) ? 1 : 0.22;
      });
      edgeSel.attr('stroke-opacity', (d: SimEdge) => {
        if (!focusActive) return d.type === 'contradicts' ? 0.85 : 0.4;
        const src = d.source as SimNode;
        const tgt = d.target as SimNode;
        const linked = neighborIds.has(src.id) && neighborIds.has(tgt.id);
        if (!linked) return 0.08;
        return d.type === 'contradicts' ? 0.95 : 0.55;
      });
    };

    updateLabelVisibility(null, selected?.id ?? null);
    applyFocusOpacity(null);

    type DragEv = { active: boolean; x: number; y: number };
    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (event: DragEv, d: SimNode) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: DragEv, d: SimNode) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event: DragEv, d: SimNode) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeGroup.call(drag);

    const tooltipEl = tooltipRef.current!;
    const tooltip = d3.select(tooltipEl);
    nodeGroup
      .on('mouseover', (event: MouseEvent, d: SimNode) => {
        tooltipEl.innerHTML = '';
        const titleRow = document.createElement('div');
        titleRow.className = 'font-semibold text-white text-xs mb-0.5';
        titleRow.textContent = TYPE_LABELS[d.type];
        tooltipEl.appendChild(titleRow);
        const labelEl = document.createElement('div');
        labelEl.className = 'text-slate-200 text-[11px] leading-snug';
        labelEl.textContent = d.label;
        tooltipEl.appendChild(labelEl);
        if (d.sub) {
          const sub = document.createElement('div');
          sub.className = 'text-slate-500 text-[10px] mt-0.5';
          sub.textContent = d.sub;
          tooltipEl.appendChild(sub);
        }
        const group = resolveNodeGroupKey(d);
        if (d.type === 'source' || claimSourceDomain.has(d.id)) {
          const pub = document.createElement('div');
          pub.className = 'text-[10px] mt-1 text-slate-400';
          pub.textContent = `Publisher: ${group}`;
          tooltipEl.appendChild(pub);
        }
        tooltip
          .style('display', 'block')
          .style('left', `${event.offsetX + 14}px`)
          .style('top', `${event.offsetY - 10}px`);
        updateLabelVisibility(d.id, selected?.id ?? null);
        applyFocusOpacity(d.id);
      })
      .on('mousemove', (event: MouseEvent) => {
        tooltip.style('left', `${event.offsetX + 14}px`).style('top', `${event.offsetY - 10}px`);
      })
      .on('mouseout', () => {
        tooltip.style('display', 'none');
        updateLabelVisibility(null, selected?.id ?? null);
        applyFocusOpacity(null);
      })
      .on('click', (_event: MouseEvent, d: SimNode) => {
        setSelected(d);
        fitAfterLayoutRef.current = false;
        updateLabelVisibility(null, d.id);
        applyFocusOpacity(null);
      });

    let layoutTicks = 0;
    simulation.on('tick', () => {
      edgeSel
        .attr('x1', (d: SimEdge) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d: SimEdge) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d: SimEdge) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d: SimEdge) => (d.target as SimNode).y ?? 0);
      nodeGroup.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      layoutTicks += 1;
      if (fitAfterLayoutRef.current && layoutTicks === 48) {
        applyFitView(nodes, width, height);
        fitAfterLayoutRef.current = false;
      }
    });
  }, [data, showContradictions, colorMode, sizePreset, sizeScale, labelMode, selected?.id, applyFitView]);

  useEffect(() => {
    fitAfterLayoutRef.current = true;
    buildGraph();
  }, [buildGraph]);

  useEffect(() => () => { simulationRef.current?.stop(); }, []);

  useEffect(() => {
    const obs = new ResizeObserver(() => {
      fitAfterLayoutRef.current = true;
      buildGraph();
    });
    if (svgRef.current) obs.observe(svgRef.current);
    return () => obs.disconnect();
  }, [buildGraph]);

  const handleZoom = (factor: number) => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    d3.select(svg).transition().duration(300).call(zoom.scaleBy, factor);
  };

  const handleFitView = () => {
    const svg = svgRef.current;
    const nodes = layoutNodesRef.current;
    if (!svg || nodes.length === 0) return;
    applyFitView(nodes, svg.clientWidth || 900, svg.clientHeight || 600);
  };

  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;
  const sourceCount = data?.nodes.filter((n) => n.type === 'source').length ?? 0;
  const contradictionCount = data?.edges.filter((e) => e.type === 'contradicts').length ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-shrink-0 px-5 py-3 border-b border-surface-100/20 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <GitFork size={18} className="text-accent flex-shrink-0" />
          <h1 className="text-base font-bold text-white">Knowledge Graph</h1>
          {nodeCount > 0 && (
            <span className="text-xs text-slate-500 truncate">
              {sourceCount} publishers · {nodeCount - sourceCount} claims · {edgeCount} edges
              {contradictionCount > 0 && (
                <span className="text-red-400 ml-1">· {contradictionCount} conflicts</span>
              )}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <span className="hidden sm:inline">Color</span>
            <select
              className="input h-7 text-xs w-32"
              value={colorMode}
              onChange={(e) => {
                fitAfterLayoutRef.current = false;
                setColorMode(e.target.value as GraphColorMode);
              }}
            >
              <option value="domain">By publisher</option>
              <option value="type">By node type</option>
              <option value="tier">By claim tier</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <span className="hidden sm:inline">Size</span>
            <select
              className="input h-7 text-xs w-24"
              value={sizePreset}
              onChange={(e) => {
                fitAfterLayoutRef.current = true;
                setSizePreset(e.target.value as GraphSizePreset);
              }}
            >
              <option value="compact">Compact</option>
              <option value="default">Default</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <span className="hidden sm:inline">Labels</span>
            <select
              className="input h-7 text-xs w-28"
              value={labelMode}
              onChange={(e) => setLabelMode(e.target.value as GraphLabelMode)}
            >
              <option value="hover">On hover</option>
              <option value="selected">Selected only</option>
              <option value="always">Always on</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              className="accent-red-400"
              checked={showContradictions}
              onChange={(e) => {
                fitAfterLayoutRef.current = true;
                setShowContradictions(e.target.checked);
              }}
            />
            Contradictions
          </label>
          <select
            className="input h-7 text-xs w-28"
            value={limit}
            onChange={(e) => {
              fitAfterLayoutRef.current = true;
              setLimit(Number(e.target.value));
            }}
          >
            <option value={40}>40 nodes</option>
            <option value={80}>80 nodes</option>
            <option value={150}>150 nodes</option>
            <option value={300}>300 nodes</option>
          </select>
          <button
            type="button"
            className="btn-ghost h-7 text-xs flex items-center gap-1"
            onClick={() => {
              fitAfterLayoutRef.current = true;
              refetch();
            }}
            disabled={isFetching}
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            Reload
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="relative flex-1 bg-[#060810] min-w-0">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm animate-pulse">
              Building graph…
            </div>
          )}
          {!isLoading && isError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500 px-8 text-center">
              <GitFork size={32} className="text-red-400 opacity-60" />
              <p className="text-sm text-red-400">Failed to load graph data</p>
              <p className="text-xs text-slate-600 font-mono max-w-md break-words">
                {extractApiError(error)}
              </p>
              <button type="button" className="btn-ghost text-xs mt-1" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          )}
          {!isLoading && !isError && nodeCount === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
              <GitFork size={32} className="opacity-30" />
              <p className="text-sm">No corpus data yet. Run research to populate claims and sources.</p>
            </div>
          )}

          <svg ref={svgRef} className="w-full h-full" style={{ display: nodeCount > 0 ? 'block' : 'none' }} />

          <div
            ref={tooltipRef}
            className="pointer-events-none absolute hidden z-20 max-w-xs rounded-lg border border-surface-100/30 bg-surface-300/95 p-2.5 shadow-xl"
            style={{ display: 'none' }}
          />

          <div className="absolute bottom-4 right-4 flex flex-col gap-1 items-center">
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={() => handleZoom(1.35)} title="Zoom in">
              <ZoomIn size={14} />
            </button>
            <div className="text-[10px] text-slate-500 tabular-nums">{zoomLevel}×</div>
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={() => handleZoom(1 / 1.35)} title="Zoom out">
              <ZoomOut size={14} />
            </button>
            <button type="button" className="btn-ghost p-1.5 h-7 w-7" onClick={handleFitView} title="Fit graph to view">
              <Focus size={14} />
            </button>
          </div>

          <div className="absolute top-3 left-3 max-w-[220px] rounded-lg border border-surface-100/20 bg-surface-300/90 p-2.5 space-y-2 max-h-[min(320px,50vh)] overflow-y-auto">
            <div className="text-[9px] uppercase tracking-widest text-slate-600">Shapes</div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="inline-block w-4 h-3 rounded-sm bg-sky-400/80 border border-slate-900" />
              Source / publisher
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="inline-block w-3 h-3 rounded-full bg-violet-400/80 border border-slate-900" />
              Claim
            </div>
            {colorMode === 'domain' && domainLegend.length > 0 && (
              <>
                <div className="border-t border-surface-100/20 pt-1.5 text-[9px] uppercase tracking-widest text-slate-600">
                  Publishers (top {domainLegend.length})
                </div>
                {domainLegend.map(({ domain, color, count }) => (
                  <div key={domain} className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[10px] text-slate-400 truncate" title={domain}>
                      {domain}
                    </span>
                    <span className="text-[9px] text-slate-600 ml-auto tabular-nums">{count}</span>
                  </div>
                ))}
              </>
            )}
            {colorMode === 'tier' && (
              <>
                <div className="border-t border-surface-100/20 pt-1.5 text-[9px] uppercase tracking-widest text-slate-600">
                  Claim tiers
                </div>
                {Object.entries(TIER_COLORS).map(([tier, color]) => (
                  <div key={tier} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-[10px] text-slate-400">{tier.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </>
            )}
            <div className="border-t border-surface-100/20 pt-1.5">
              <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">Edges</div>
              {Object.entries(EDGE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-4 h-px" style={{ backgroundColor: color }} />
                  <span className={clsx('text-[10px]', type === 'contradicts' ? 'text-red-400' : 'text-slate-400')}>
                    {type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 w-80 border-l border-surface-100/20 flex flex-col min-h-0">
          {selected ? (
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <button type="button" className="btn-ghost text-xs" onClick={() => setSelected(null)}>
                ← Clear
              </button>
              <div className="flex items-center gap-2">
                <div
                  className={clsx(
                    'flex-shrink-0 border border-slate-900',
                    selected.type === 'source' ? 'w-4 h-3 rounded-sm' : 'w-3 h-3 rounded-full',
                  )}
                  style={{
                    backgroundColor: nodeFill(
                      selected,
                      colorMode,
                      selected.type === 'claim' ? resolveNodeGroupKey(selected) : undefined,
                    ),
                  }}
                />
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                  {TYPE_LABELS[selected.type]}
                </span>
              </div>
              <p className="text-sm text-white leading-snug">{selected.label}</p>
              {selected.sub && <p className="text-xs text-slate-500">{selected.sub}</p>}
              {(selected.group_key || selected.url) && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Publisher</div>
                  <p className="text-xs text-slate-300 font-mono break-all">
                    {selected.group_key ?? resolveNodeGroupKey(selected)}
                  </p>
                </div>
              )}
              {selected.evidence_tier && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Corroboration tier</div>
                  <span className="text-xs" style={{ color: TIER_COLORS[selected.evidence_tier] ?? '#64748b' }}>
                    {selected.evidence_tier.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
              {selected.url && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Source URL</div>
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline break-words"
                  >
                    {selected.url}
                  </a>
                </div>
              )}
              {selected.tags && selected.tags.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map((t) => (
                      <span key={t} className="badge text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-600 p-6 text-center">
              <Info size={20} className="opacity-40" />
              <p className="text-xs leading-relaxed">
                Sources appear as rectangles (colored by publisher). Claims are circles. Use Fit to fill the canvas
                without manual zoom. Hover to highlight a stakeholder neighborhood.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
