import { describe, expect, it } from 'vitest';
import {
  colorForDomain,
  computeFitViewTransform,
  computeGraphBounds,
  extractPublisherDomain,
  nodeFill,
  nodeRadius,
  resolveNodeGroupKey,
} from './knowledgeGraphViz';
import type { GraphNode } from '../utils/api';

describe('knowledgeGraphViz', () => {
  it('extractPublisherDomain strips www and lowercases host', () => {
    expect(extractPublisherDomain('https://WWW.Example.COM/path')).toBe('example.com');
    expect(extractPublisherDomain('not-a-url')).toBeUndefined();
  });

  it('resolveNodeGroupKey prefers API group_key then URL host', () => {
    const node: GraphNode = {
      id: '1',
      type: 'source',
      label: 'Acme',
      url: 'https://news.acme.org/story',
      group_key: 'acme.org',
    };
    expect(resolveNodeGroupKey(node)).toBe('acme.org');
    expect(resolveNodeGroupKey({ ...node, group_key: undefined })).toBe('news.acme.org');
  });

  it('colorForDomain is stable for the same domain', () => {
    const a = colorForDomain('reuters.com');
    const b = colorForDomain('reuters.com');
    const c = colorForDomain('bbc.co.uk');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('nodeFill type mode uses fixed source and claim colors', () => {
    expect(nodeFill({ id: 's', type: 'source', label: 'S' }, 'type')).toBe('#60a5fa');
    expect(nodeFill({ id: 'c', type: 'claim', label: 'C', evidence_tier: 'established_fact' }, 'type')).toBe(
      '#a78bfa',
    );
  });

  it('nodeFill domain mode colors sources and linked claims by publisher', () => {
    const source: GraphNode = {
      id: 's',
      type: 'source',
      label: 'Publisher',
      url: 'https://alpha.test/',
      group_key: 'alpha.test',
    };
    const fill = nodeFill(source, 'domain');
    expect(nodeFill({ id: 'c', type: 'claim', label: 'x' }, 'domain', 'alpha.test')).toBe(fill);
    expect(nodeFill({ id: 'c', type: 'claim', label: 'x' }, 'domain')).toBe('#64748b');
  });

  it('nodeRadius scales with size preset multiplier', () => {
    const node: GraphNode = { id: 's', type: 'source', label: 'S', weight: 2 };
    expect(nodeRadius(node, 1)).toBeLessThan(nodeRadius(node, 1.35));
  });

  it('computeFitViewTransform scales graph into viewport', () => {
    const bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
    const t = computeFitViewTransform(bounds, 800, 600, 40, 3);
    expect(t.k).toBeGreaterThan(0.7);
    expect(t.k).toBeLessThanOrEqual(3);
  });

  it('computeFitViewTransform clamps tiny viewport and positive scale', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const t = computeFitViewTransform(bounds, 0, 0, 56, 2.8);
    expect(t.k).toBeGreaterThanOrEqual(0.05);
    expect(Number.isFinite(t.x)).toBe(true);
    expect(Number.isFinite(t.y)).toBe(true);
  });

  it('computeGraphBounds returns null when nodes lack positions', () => {
    expect(computeGraphBounds([{ x: undefined, y: undefined }], 10)).toBeNull();
  });
});
