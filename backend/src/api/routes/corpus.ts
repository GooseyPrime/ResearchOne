import { Router } from 'express';
import { query } from '../../db/pool';

const router = Router();

// GET /api/corpus/tier-distribution - Evidence tier counts from claims.
// Cast count to int (already done) and coerce defensively — keeps the
// recharts pie chart on CorpusPage from getting tripped up by string
// values when the postgres int-parser config isn't loaded.
router.get('/tier-distribution', async (_req, res, next) => {
  try {
    const rows = await query<{ evidence_tier: string; count: number | string }>(
      `SELECT evidence_tier, COUNT(*)::int AS count
       FROM claims
       GROUP BY evidence_tier
       ORDER BY count DESC`
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
router.get('/stats', async (_req, res, next) => {
  try {
    const rows = await query<Record<string, unknown>>('SELECT * FROM corpus_stats');
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
    const { tier, search } = req.query as { tier?: string; search?: string };
    let sql = `
      SELECT c.*, s.url AS source_url, s.title AS source_title
      FROM claims c
      LEFT JOIN sources s ON s.id = c.source_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

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
    const { resolved } = req.query as { resolved?: string };
    let sql = `
      SELECT ct.*,
             a.claim_text AS claim_a_text,
             b.claim_text AS claim_b_text
      FROM contradictions ct
      LEFT JOIN claims a ON a.id = ct.claim_a_id
      LEFT JOIN claims b ON b.id = ct.claim_b_id
    `;
    const params: unknown[] = [];

    if (resolved !== undefined) {
      params.push(resolved === 'true');
      sql += ` WHERE ct.resolved=$${params.length}`;
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
    const { sourceId, search } = req.query as { sourceId?: string; search?: string };
    let sql = `
      SELECT c.id, c.chunk_index, c.content, c.token_count, c.created_at,
             s.url AS source_url, s.title AS source_title
      FROM chunks c
      LEFT JOIN sources s ON s.id = c.source_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

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
