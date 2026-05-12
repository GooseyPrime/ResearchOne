/**
 * Pipeline layout — canonical 10-stage node and edge geometry.
 *
 * Per Cursor rule 27 I-3: the ten stages and their names are public
 * marketing surface. Do not rename, reorder, or collapse without
 * coordinating with marketing.
 *
 * Coordinate system: a 1000 × 360 viewBox. Nodes positioned in a
 * three-row "snake" layout for desktop:
 *
 *   Plan        →  Retrieve & Read
 *      ↓                  ↓
 *   Reason & Challenge ←
 *      ↓
 *   Synthesize & Cite (4 nodes)  →  →  →
 *
 * Actually a simpler 2-row layout reads better in a hero panel.
 * Row 1: Planner → Discovery → Retriever → Retriever Analysis → Reasoner
 * Row 2 (reversed for snake flow):
 *        ... ← Skeptic ← Synthesizer ← Verifier ← Report ← Epistemic Persistence
 * Connector: Reasoner (end of row 1) drops down to Skeptic (end of row 2).
 *
 * The layout is intentionally laid out so beams trace an S-curve
 * across the hero — reads as "flow" without forcing the user's eye
 * to scan back to the left.
 *
 * Mobile layout is generated from this same data structure by
 * `AnimatedPipelineHero.tsx`: it ignores the (x, y) coords and renders
 * a vertical chain.
 */

export interface PipelineStage {
  /** Canonical id — used in tests and as React key. Lowercase, snake_case. */
  id: string;
  /** Display label — what the user sees. */
  label: string;
  /** Pipeline phase grouping for color-coding (matches WO-U cost analytics phases). */
  phase: 'plan' | 'retrieve' | 'reason' | 'synthesize';
  /** True for the Skeptic stage — rendered with extra emphasis per Rule 27 I-4. */
  emphasis?: boolean;
  /** Viewport position in the 1000 × 360 SVG coordinate space. */
  x: number;
  y: number;
}

export interface PipelineEdge {
  /** Edge id — used as React key and for stagger sequencing. */
  id: string;
  fromId: string;
  toId: string;
  /** SVG path `d` attribute — pre-computed from (x, y) of the endpoints. */
  d: string;
  /** Sequencing index, 0..N. Beams animate in this order with a stagger. */
  seq: number;
}

/* ────────────────────────────────────────────────────────────────
 * Stages — the 10 canonical agents.
 * Coordinates picked so the layout reads as a left-to-right S-curve.
 * y = 90 is the top row centerline; y = 270 is the bottom row centerline.
 * x positions spread evenly with 165 px between centers.
 * ──────────────────────────────────────────────────────────────── */

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  // Top row, left to right.
  { id: 'planner',             label: 'Planner',              phase: 'plan',       x: 80,  y: 90 },
  { id: 'discovery',           label: 'Discovery',            phase: 'plan',       x: 245, y: 90 },
  { id: 'retriever',           label: 'Retriever',            phase: 'retrieve',   x: 410, y: 90 },
  { id: 'retriever_analysis',  label: 'Retriever Analysis',   phase: 'retrieve',   x: 600, y: 90 },
  { id: 'reasoner',            label: 'Reasoner',             phase: 'reason',     x: 790, y: 90 },
  // Bottom row, right to left (snake reversal).
  { id: 'skeptic',             label: 'Skeptic',              phase: 'reason',     x: 920, y: 270, emphasis: true },
  { id: 'synthesizer',         label: 'Synthesizer',          phase: 'synthesize', x: 740, y: 270 },
  { id: 'verifier',            label: 'Verifier',             phase: 'synthesize', x: 560, y: 270 },
  { id: 'report',              label: 'Report',               phase: 'synthesize', x: 380, y: 270 },
  { id: 'persistence',         label: 'Epistemic Persistence', phase: 'synthesize', x: 180, y: 270 },
] as const;

/* ────────────────────────────────────────────────────────────────
 * Edges — the directed beams between stages.
 * Most edges are straight horizontal lines (same y). The turn
 * connection (reasoner → skeptic) is a smooth quadratic curve so the
 * beam doesn't make a sharp angle.
 * ──────────────────────────────────────────────────────────────── */

function straight(from: PipelineStage, to: PipelineStage): string {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function curve(from: PipelineStage, to: PipelineStage): string {
  // Quadratic bezier with control point pulled to the right to make
  // a gentle U-turn from the top-right node down to the bottom-right.
  const midX = (from.x + to.x) / 2 + 100;
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} Q ${midX} ${midY}, ${to.x} ${to.y}`;
}

function byId(id: string): PipelineStage {
  const s = PIPELINE_STAGES.find((x) => x.id === id);
  if (!s) throw new Error(`pipelineLayout: unknown stage id "${id}"`);
  return s;
}

export const PIPELINE_EDGES: readonly PipelineEdge[] = [
  // Top row chain.
  { id: 'e1', fromId: 'planner',            toId: 'discovery',          seq: 0,
    d: straight(byId('planner'),            byId('discovery')) },
  { id: 'e2', fromId: 'discovery',          toId: 'retriever',          seq: 1,
    d: straight(byId('discovery'),          byId('retriever')) },
  { id: 'e3', fromId: 'retriever',          toId: 'retriever_analysis', seq: 2,
    d: straight(byId('retriever'),          byId('retriever_analysis')) },
  { id: 'e4', fromId: 'retriever_analysis', toId: 'reasoner',           seq: 3,
    d: straight(byId('retriever_analysis'), byId('reasoner')) },
  // Turn: reasoner (top right) → skeptic (bottom right), via curve.
  { id: 'e5', fromId: 'reasoner',           toId: 'skeptic',            seq: 4,
    d: curve(byId('reasoner'),              byId('skeptic')) },
  // Bottom row chain, right to left.
  { id: 'e6', fromId: 'skeptic',            toId: 'synthesizer',        seq: 5,
    d: straight(byId('skeptic'),            byId('synthesizer')) },
  { id: 'e7', fromId: 'synthesizer',        toId: 'verifier',           seq: 6,
    d: straight(byId('synthesizer'),        byId('verifier')) },
  { id: 'e8', fromId: 'verifier',           toId: 'report',             seq: 7,
    d: straight(byId('verifier'),           byId('report')) },
  { id: 'e9', fromId: 'report',             toId: 'persistence',        seq: 8,
    d: straight(byId('report'),             byId('persistence')) },
] as const;

/**
 * Active sweep window in ms: staggered beam starts span
 * `(edges - 1) * PIPELINE_STAGGER_MS`; each beam's draw duration is
 * `PIPELINE_CYCLE_MS - (edges - 1) * PIPELINE_STAGGER_MS` so the last
 * beam finishes at this boundary. `PIPELINE_LOOP_PAUSE_MS` is appended
 * once per full loop (see `pipelineBeams.tsx`).
 */
export const PIPELINE_CYCLE_MS = 4500;

/** Stagger between consecutive beams in ms. */
export const PIPELINE_STAGGER_MS = 350;

/** Pause at end of cycle before next iteration in ms. */
export const PIPELINE_LOOP_PAUSE_MS = 800;

/** SVG viewBox dimensions — node positions live in this space. */
export const PIPELINE_VIEWBOX = { width: 1000, height: 360 } as const;
