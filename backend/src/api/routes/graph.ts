import { Router } from 'express';
import { query } from '../../db/pool';

const router = Router();

export interface GraphNode {
  id: string;
  type: 'source' | 'claim';
  label: string;
  sub?: string;
  evidence_tier?: string | null;
  tags?: string[];
  url?: string;
  weight?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'contains' | 'contradicts';
  weight?: number;
}

// GET /api/graph - Return knowledge graph data (nodes + edges) for D3 force layout.
// Limits scope to keep the payload browser-renderable: top sources by chunk count,
// sample of claims, all contradiction pairs, and a sample of run→source edges.
router.get('/', async (req, res, next) => {
  try {
    const { runId, limit = '80' } = req.query as { runId?: string; limit?: string };
    const parsedLimit = parseInt(limit, 10);
    const nodeLimit = Math.min(Number.isFinite(parsedLimit) ? Math.max(1, parsedLimit) : 80, 300);

    // ── Sources ──────────────────────────────────────────────────────────────
    const sourceParams: unknown[] = [Math.floor(nodeLimit * 0.4)];
    let sourceFilter = '';
    if (runId) {
      sourceParams.push(runId);
      sourceFilter = `WHERE s.discovered_by_run_id = $${sourceParams.length}`;
    }
    const sources = await query<{
      id: string;
      title: string;
      url: string;
      tags: string[];
      chunk_count: number;
    }>(
      `SELECT s.id, s.title, s.url, COALESCE(s.tags, '{}') AS tags,
              COUNT(c.id)::int AS chunk_count
       FROM sources s
       LEFT JOIN chunks c ON c.source_id = s.id
       ${sourceFilter}
       GROUP BY s.id
       ORDER BY chunk_count DESC
       LIMIT $1`,
      sourceParams
    );

    // ── Claims ───────────────────────────────────────────────────────────────
    const claimParams: unknown[] = [Math.floor(nodeLimit * 0.5)];
    let claimFilter = '';
    if (runId) {
      claimParams.push(runId);
      claimFilter = `AND cl.run_id = $${claimParams.length}`;
    }
    const claims = await query<{
      id: string;
      claim_text: string;
      evidence_tier: string | null;
      source_id: string | null;
      chunk_id: string | null;
    }>(
      `SELECT cl.id, cl.claim_text, cl.evidence_tier, cl.source_id, cl.chunk_id
       FROM claims cl
       WHERE cl.claim_text IS NOT NULL ${claimFilter}
       ORDER BY cl.id
       LIMIT $1`,
      claimParams
    );

    // ── Contradiction pairs ───────────────────────────────────────────────────
    // The contradictions table column is `description` (see migration 001).
    // We expose it on the API as `conflict_description` for clarity on the
    // graph payload — but the SELECT must use the real column name.
    const contradictions = await query<{
      id: string;
      claim_a_id: string;
      claim_b_id: string;
      conflict_description: string | null;
    }>(
      `SELECT id, claim_a_id, claim_b_id, description AS conflict_description
       FROM contradictions
       ORDER BY created_at DESC
       LIMIT 60`
    );

    // ── Source → chunk edges (claim.source_id) ────────────────────────────────
    const sourceIds = new Set(sources.map((s) => s.id));
    const claimIds = new Set(claims.map((c) => c.id));

    // ── Assemble nodes & edges ────────────────────────────────────────────────
    const nodes: GraphNode[] = [
      ...sources.map((s) => ({
        id: s.id,
        type: 'source' as const,
        label: (s.title || s.url || 'Untitled').slice(0, 60),
        sub: `${s.chunk_count} chunks`,
        tags: s.tags,
        url: s.url,
        weight: Math.log1p(s.chunk_count),
      })),
      ...claims.map((c) => ({
        id: c.id,
        type: 'claim' as const,
        label: (c.claim_text || '').slice(0, 80),
        evidence_tier: c.evidence_tier,
        weight: 1,
      })),
    ];

    const edges: GraphEdge[] = [];
    let edgeSeq = 0;

    // claim → source edges
    for (const c of claims) {
      if (c.source_id && sourceIds.has(c.source_id)) {
        edges.push({
          id: `e${edgeSeq++}`,
          source: c.source_id,
          target: c.id,
          type: 'contains',
          weight: 0.5,
        });
      }
    }

    // contradiction edges (only between claim nodes we included)
    for (const contra of contradictions) {
      if (claimIds.has(contra.claim_a_id) && claimIds.has(contra.claim_b_id)) {
        edges.push({
          id: `e${edgeSeq++}`,
          source: contra.claim_a_id,
          target: contra.claim_b_id,
          type: 'contradicts',
          weight: 2,
        });
      }
    }

    res.json({ nodes, edges });
  } catch (err) {
    next(err);
  }
});

export default router;
