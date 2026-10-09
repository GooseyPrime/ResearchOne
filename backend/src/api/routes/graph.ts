import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { query } from '../../db/pool';
import { libraryViewerFromRequest, ownClaimSql, ownSourceSql } from '../../db/libraryScope';
import { buildOwnershipSql } from '../../db/tenantScope';

const router = Router();

router.use(requireAuth);

export interface GraphNode {
  id: string;
  type: 'source' | 'claim';
  label: string;
  sub?: string;
  evidence_tier?: string | null;
  tags?: string[];
  url?: string;
  /** Publisher / org bucket (hostname) for source differentiation in the graph UI. */
  group_key?: string;
  source_type?: string;
  weight?: number;
}

function graphGroupKeyFromUrl(url: string | null | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
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
    const viewer = libraryViewerFromRequest(req);
    if (!viewer) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { runId, limit = '80' } = req.query as { runId?: string; limit?: string };

    // A run's graph is shown only to the run's owner (or an admin).
    if (runId && !viewer.isAdmin) {
      const owned = await query(
        `SELECT 1 FROM research_runs WHERE id::text = $1::text AND ${buildOwnershipSql('', 2, 3)}`,
        [runId, viewer.userId, req.auth?.orgId ?? null]
      );
      if (owned.length === 0) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
    }
    const parsedLimit = parseInt(limit, 10);
    const nodeLimit = Math.min(Number.isFinite(parsedLimit) ? Math.max(1, parsedLimit) : 80, 300);

    // ── Sources ──────────────────────────────────────────────────────────────
    const sourceParams: unknown[] = [Math.floor(nodeLimit * 0.4)];
    const sourceConds: string[] = [];
    if (runId) {
      sourceParams.push(runId);
      sourceConds.push(`s.discovered_by_run_id = $${sourceParams.length}`);
    } else if (!viewer.isAdmin) {
      // No run chosen: the caller's own sources only.
      sourceParams.push(viewer.userId);
      sourceConds.push(ownSourceSql('s', sourceParams.length));
    }
    const sourceFilter = sourceConds.length > 0 ? `WHERE ${sourceConds.join(' AND ')}` : '';
    const sources = await query<{
      id: string;
      title: string | null;
      url: string | null;
      source_type: string;
      tags: string[];
      chunk_count: number;
    }>(
      `SELECT s.id, s.title, s.url, s.source_type::text AS source_type,
              COALESCE(s.tags, '{}') AS tags,
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
    } else if (!viewer.isAdmin) {
      claimParams.push(viewer.userId);
      claimFilter = `AND ${ownClaimSql('cl', claimParams.length)}`;
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
      // Edges are only drawn between claim nodes already selected above, so a
      // pair is read only when both of its claims are among them.
      `SELECT id, claim_a_id, claim_b_id, description AS conflict_description
       FROM contradictions
       WHERE claim_a_id = ANY($1::uuid[]) AND claim_b_id = ANY($1::uuid[])
       ORDER BY created_at DESC
       LIMIT 60`,
      [claims.map((c) => c.id)]
    );

    // ── Source → chunk edges (claim.source_id) ────────────────────────────────
    const sourceIds = new Set(sources.map((s) => s.id));
    const claimIds = new Set(claims.map((c) => c.id));

    // ── Assemble nodes & edges ────────────────────────────────────────────────
    const nodes: GraphNode[] = [
      ...sources.map((s) => {
        const groupKey = graphGroupKeyFromUrl(s.url);
        return {
          id: s.id,
          type: 'source' as const,
          label: (s.title || s.url || 'Untitled').slice(0, 60),
          sub: groupKey
            ? `${groupKey} · ${s.chunk_count} chunks`
            : `${s.chunk_count} chunks`,
          tags: s.tags,
          url: s.url ?? undefined,
          group_key: groupKey,
          source_type: s.source_type,
          weight: Math.log1p(s.chunk_count),
        };
      }),
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
