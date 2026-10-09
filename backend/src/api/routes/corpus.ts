import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { query } from '../../db/pool';
import {
  libraryViewerFromRequest,
  ownClaimSql,
  ownSourceSql,
  type LibraryViewer,
} from '../../db/libraryScope';
import { buildOwnershipSql } from '../../db/tenantScope';

const router = Router();

router.use(requireAuth);

// The library tables have no owner column, so every query here says whose
// rows it wants: a user's own, or everything for an admin (db/libraryScope.ts).
function viewerOr401(req: Request, res: Response): LibraryViewer | null {
  const viewer = libraryViewerFromRequest(req);
  if (!viewer) res.status(401).json({ error: 'Unauthorized' });
  return viewer;
}

// GET /api/corpus/tier-distribution - Evidence tier counts from claims.
// Cast count to int (already done) and coerce defensively — keeps the
// recharts pie chart on CorpusPage from getting tripped up by string
// values when the postgres int-parser config isn't loaded.
router.get('/tier-distribution', async (req, res, next) => {
  try {
    const viewer = viewerOr401(req, res);
    if (!viewer) return;
    const params: unknown[] = [];
    let scope = '';
    if (!viewer.isAdmin) {
      params.push(viewer.userId);
      scope = `WHERE ${ownClaimSql('c', params.length)}`;
    }
    const rows = await query<{ evidence_tier: string; count: number | string }>(
      `SELECT c.evidence_tier, COUNT(*)::int AS count
       FROM claims c
       ${scope}
       GROUP BY c.evidence_tier
       ORDER BY count DESC`,
      params
    );
    res.json(rows.map((r) => ({ evidence_tier: r.evidence_tier, count: Number(r.count ?? 0) })));
  } catch (err) {
    next(err);
  }
});

// GET /api/corpus/stats - Live corpus metrics
//
// The corpus_stats VIEW (migration 001) sums COUNT(*) over each table.
// Postgres COUNT returns `bigint`, which `node-postgres` parses to
// `string` by default — that's a footgun for downstream consumers
// (the frontend's StatCard concatenates instead of adding, recharts
// can't compare them, etc.). Cast every numeric column to a plain
// number on the way out so the JSON payload is consistent regardless
// of pg type-parser configuration.
router.get('/stats', async (req, res, next) => {
  try {
    const viewer = viewerOr401(req, res);
    if (!viewer) return;
    // The corpus_stats view counts every user's rows (and the database size),
    // so only an admin reads it. Everyone else gets counts of their own rows.
    const rows = viewer.isAdmin
      ? await query<Record<string, unknown>>('SELECT * FROM corpus_stats')
      : await query<Record<string, unknown>>(
          `SELECT
             (SELECT COUNT(*) FROM sources s WHERE ${ownSourceSql('s', 1)}) AS source_count,
             (SELECT COUNT(*) FROM documents d JOIN sources s ON s.id = d.source_id WHERE ${ownSourceSql('s', 1)}) AS document_count,
             (SELECT COUNT(*) FROM chunks ch JOIN sources s ON s.id = ch.source_id WHERE ${ownSourceSql('s', 1)}) AS chunk_count,
             (SELECT COUNT(*) FROM embeddings e JOIN chunks ch ON ch.id = e.chunk_id JOIN sources s ON s.id = ch.source_id WHERE ${ownSourceSql('s', 1)}) AS embedding_count,
             (SELECT COUNT(*) FROM claims c WHERE ${ownClaimSql('c', 1)}) AS claim_count,
             (SELECT COUNT(*) FROM contradictions ct JOIN claims c ON c.id = ct.claim_a_id WHERE ${ownClaimSql('c', 1)}) AS contradiction_count,
             (SELECT COUNT(*) FROM contradictions ct JOIN claims c ON c.id = ct.claim_a_id WHERE ct.resolved = FALSE AND ${ownClaimSql('c', 1)}) AS open_contradiction_count,
             (SELECT COUNT(*) FROM reports r WHERE r.status = 'finalized' AND ${buildOwnershipSql('r', 1, 2)}) AS finalized_report_count,
             (SELECT COUNT(*) FROM research_runs rr WHERE rr.status = 'running' AND ${buildOwnershipSql('rr', 1, 2)}) AS active_run_count,
             NULL::text AS db_size`,
          [viewer.userId, req.auth?.orgId ?? null]
        );
    const row = rows[0] ?? {};
    const numericKeys = [
      'source_count',
      'document_count',
      'chunk_count',
      'embedding_count',
      'claim_count',
      'contradiction_count',
      'open_contradiction_count',
      'finalized_report_count',
      'active_run_count',
    ];
    const out: Record<string, unknown> = { ...row };
    for (const k of numericKeys) {
      if (out[k] !== null && out[k] !== undefined) {
        const n = Number(out[k]);
        out[k] = Number.isFinite(n) ? n : 0;
      } else {
        out[k] = 0;
      }
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// GET /api/corpus/claims - Browse claims
router.get('/claims', async (req, res, next) => {
  try {
    const viewer = viewerOr401(req, res);
    if (!viewer) return;
    const { tier, search } = req.query as { tier?: string; search?: string };
    let sql = `
      SELECT c.*, s.url AS source_url, s.title AS source_title
      FROM claims c
      LEFT JOIN sources s ON s.id = c.source_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (!viewer.isAdmin) {
      params.push(viewer.userId);
      sql += ` AND ${ownClaimSql('c', params.length)}`;
    }

    if (tier) {
      params.push(tier);
      sql += ` AND c.evidence_tier=$${params.length}`;
    }

    if (search) {
      params.push(search);
      sql += ` AND to_tsvector('english', c.claim_text) @@ plainto_tsquery('english', $${params.length})`;
    }

    sql += ' ORDER BY c.created_at DESC LIMIT 100';
    res.json(await query(sql, params));
  } catch (err) {
    next(err);
  }
});

// GET /api/corpus/contradictions - Browse contradictions
router.get('/contradictions', async (req, res, next) => {
  try {
    const viewer = viewerOr401(req, res);
    if (!viewer) return;
    const { resolved } = req.query as { resolved?: string };
    let sql = `
      SELECT ct.*,
             a.claim_text AS claim_a_text,
             b.claim_text AS claim_b_text
      FROM contradictions ct
      LEFT JOIN claims a ON a.id = ct.claim_a_id
      LEFT JOIN claims b ON b.id = ct.claim_b_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (!viewer.isAdmin) {
      // Both sides must be the caller's own: a pair never reveals another user's claim.
      params.push(viewer.userId);
      sql += ` AND ${ownClaimSql('a', params.length)} AND ${ownClaimSql('b', params.length)}`;
    }

    if (resolved !== undefined) {
      params.push(resolved === 'true');
      sql += ` AND ct.resolved=$${params.length}`;
    }

    sql += ' ORDER BY ct.created_at DESC LIMIT 100';
    res.json(await query(sql, params));
  } catch (err) {
    next(err);
  }
});

// GET /api/corpus/chunks - Browse chunks
router.get('/chunks', async (req, res, next) => {
  try {
    const viewer = viewerOr401(req, res);
    if (!viewer) return;
    const { sourceId, search } = req.query as { sourceId?: string; search?: string };
    let sql = `
      SELECT c.id, c.chunk_index, c.content, c.token_count, c.created_at,
             s.url AS source_url, s.title AS source_title
      FROM chunks c
      LEFT JOIN sources s ON s.id = c.source_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (!viewer.isAdmin) {
      params.push(viewer.userId);
      sql += ` AND ${ownSourceSql('s', params.length)}`;
    }

    if (sourceId) {
      params.push(sourceId);
      sql += ` AND c.source_id=$${params.length}`;
    }

    if (search) {
      params.push(search);
      sql += ` AND to_tsvector('english', c.content) @@ plainto_tsquery('english', $${params.length})`;
    }

    sql += ' ORDER BY c.created_at DESC LIMIT 200';
    res.json(await query(sql, params));
  } catch (err) {
    next(err);
  }
});

export default router;
