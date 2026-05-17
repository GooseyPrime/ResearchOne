import type { GraphNode } from '../utils/api';

/** Evidence tier palette (claim nodes). */
export const TIER_COLORS: Record<string, string> = {
  established_fact: '#34d399',
  strong_evidence: '#60a5fa',
  testimony: '#a78bfa',
  inference: '#fbbf24',
  speculation: '#f87171',
};

export const EDGE_COLORS: Record<string, string> = {
  contains: '#334155',
  contradicts: '#f87171',
};

export type GraphColorMode = 'type' | 'domain' | 'tier';
export type GraphSizePreset = 'compact' | 'default' | 'large';
export type GraphLabelMode = 'hover' | 'always' | 'selected';

export const SIZE_PRESET_SCALE: Record<GraphSizePreset, number> = {
  compact: 0.85,
  default: 1,
  large: 1.35,
};

const DOMAIN_PALETTE = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#fb7185',
  '#2dd4bf',
  '#f472b6',
  '#818cf8',
  '#4ade80',
  '#f97316',
  '#22d3ee',
  '#c084fc',
];

export function extractPublisherDomain(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

export function resolveNodeGroupKey(node: GraphNode): string {
  if (node.group_key) return node.group_key;
  if (node.type === 'source') {
    return extractPublisherDomain(node.url) ?? 'unknown-source';
  }
  return node.evidence_tier ?? 'claim';
}

/** Stable hue per domain string for publisher / org differentiation. */
export function colorForDomain(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i += 1) {
    hash = (hash * 31 + domain.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % DOMAIN_PALETTE.length;
  return DOMAIN_PALETTE[idx]!;
}

export function nodeRadius(node: GraphNode, sizeScale: number, degree = 0): number {
  const base = node.type === 'source'
    ? 12 + Math.min(8, (node.weight ?? 1) * 1.5)
    : 7 + Math.min(4, degree * 0.35);
  return base * sizeScale;
}

export function nodeFill(
  node: GraphNode,
  colorMode: GraphColorMode,
  claimParentDomain?: string,
): string {
  if (colorMode === 'tier' && node.type === 'claim' && node.evidence_tier) {
    return TIER_COLORS[node.evidence_tier] ?? '#a78bfa';
  }
  if (colorMode === 'tier' && node.type === 'source') {
    return '#475569';
  }
  if (colorMode === 'domain') {
    const domain =
      node.type === 'source'
        ? resolveNodeGroupKey(node)
        : claimParentDomain ?? 'unlinked-claim';
    if (domain === 'unlinked-claim') return '#64748b';
    return colorForDomain(domain);
  }
  if (node.type === 'claim' && node.evidence_tier) {
    return TIER_COLORS[node.evidence_tier] ?? '#a78bfa';
  }
  return '#60a5fa';
}

export function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computeGraphBounds(
  nodes: Array<{ x?: number; y?: number }>,
  nodeRadiusPx: number,
): GraphBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const n of nodes) {
    if (n.x == null || n.y == null || Number.isNaN(n.x) || Number.isNaN(n.y)) continue;
    count += 1;
    minX = Math.min(minX, n.x - nodeRadiusPx);
    minY = Math.min(minY, n.y - nodeRadiusPx);
    maxX = Math.max(maxX, n.x + nodeRadiusPx);
    maxY = Math.max(maxY, n.y + nodeRadiusPx);
  }
  if (count === 0) return null;
  return { minX, minY, maxX, maxY };
}

/** d3-zoom transform that fits node bounds into the viewport. */
export function computeFitViewTransform(
  bounds: GraphBounds,
  width: number,
  height: number,
  padding = 56,
  maxScale = 2.8,
): { x: number; y: number; k: number } {
  const dx = Math.max(bounds.maxX - bounds.minX, 40);
  const dy = Math.max(bounds.maxY - bounds.minY, 40);
  const k = Math.min(
    (width - padding * 2) / dx,
    (height - padding * 2) / dy,
    maxScale,
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    k,
    x: width / 2 - k * cx,
    y: height / 2 - k * cy,
  };
}

export function buildDomainLegend(
  nodes: GraphNode[],
  maxEntries = 10,
): Array<{ domain: string; color: string; count: number }> {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.type !== 'source') continue;
    const domain = resolveNodeGroupKey(n);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxEntries)
    .map(([domain, count]) => ({
      domain,
      color: domain === 'unknown-source' ? '#64748b' : colorForDomain(domain),
      count,
    }));
}
