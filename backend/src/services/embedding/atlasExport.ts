import * as fs from 'fs';
import * as path from 'path';
import { query } from '../../db/pool';
import { logger } from '../../utils/logger';

export interface AtlasExportJobData {
  exportId: string;
  label: string;
  description?: string;
  filterTags?: string[];
}

export interface AtlasPoint {
  id: string;
  text: string;
  source_url: string;
  source_title: string;
  tags: string[];
  chunk_index: number;
  evidence_tier: string | null;
  vector: number[];
}

export async function runAtlasExport(data: AtlasExportJobData): Promise<{ exportId: string; count: number; path: string }> {
  const { exportId, filterTags } = data;

  logger.info(`Starting Atlas export ${exportId}`);

  // Build query - filter by tags if provided
  let sql = `
    SELECT
      c.id,
      c.content,
      c.chunk_index,
      c.metadata,
      s.url AS source_url,
      s.title AS source_title,
      s.tags,
      e.vector::text AS vector_str,
      cl.evidence_tier
    FROM chunks c
    JOIN embeddings e ON e.chunk_id = c.id
    LEFT JOIN sources s ON s.id = c.source_id
    LEFT JOIN claims cl ON cl.chunk_id = c.id
    WHERE e.vector IS NOT NULL
  `;

  const params: unknown[] = [];
  if (filterTags && filterTags.length > 0) {
    params.push(filterTags);
    sql += ` AND s.tags && $${params.length}::text[]`;
  }

  sql += ' ORDER BY c.created_at DESC LIMIT 50000';

  const rows = await query<{
    id: string;
    content: string;
    chunk_index: number;
    metadata: Record<string, unknown>;
    source_url: string;
    source_title: string;
    tags: string[];
    vector_str: string;
    evidence_tier: string | null;
  }>(sql, params.length > 0 ? params : undefined);

  // Parse vectors from pgvector string format
  const points: AtlasPoint[] = rows.map(row => {
    let vector: number[] = [];
    try {
      // pgvector returns vectors in '[0.1,0.2,...]' format — parse directly
      vector = JSON.parse(row.vector_str) as number[];
    } catch {
      // Skip malformed vectors
    }
    return {
      id: row.id,
      text: row.content.slice(0, 500), // truncate for Atlas
      source_url: row.source_url ?? '',
      source_title: row.source_title ?? '',
      tags: row.tags ?? [],
      chunk_index: row.chunk_index,
      evidence_tier: row.evidence_tier,
      vector,
    };
  }).filter(p => p.vector.length > 0);

  // Write JSONL file for Atlas
  const exportDir = path.join(process.cwd(), 'exports');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const exportPath = path.join(exportDir, `atlas_${exportId}.jsonl`);
  const stream = fs.createWriteStream(exportPath);

  for (const point of points) {
    stream.write(JSON.stringify(point) + '\n');
  }

  await new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Update export record
  await query(
    `UPDATE atlas_exports SET chunk_count=$1, export_path=$2 WHERE id=$3`,
    [points.length, exportPath, exportId]
  );

  logger.info(`Atlas export complete: ${points.length} points -> ${exportPath}`);

  return { exportId, count: points.length, path: exportPath };
}
