import * as fs from 'fs';
import * as path from 'path';
import { query } from '../../db/pool';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { uploadAtlasJsonlToNomic } from './nomicUpload';
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
  source_type: string | null;
  imported_via: string | null;
  discovered_by_run_id: string | null;
  discovery_query: string | null;
  source_rank: number | null;
  cluster_hint: 'dense_cluster_candidate' | 'outlier_candidate' | 'bridge_candidate' | null;
  vector: number[];
}

/** Canonical exports directory — must match nginx /exports alias on Emma runtime VM */
export const EXPORTS_DIR = config.exports.dir;

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
      s.source_type,
      s.imported_via,
      s.discovered_by_run_id,
      s.discovery_query,
      s.source_rank,
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
    source_type: string | null;
    imported_via: string | null;
    discovered_by_run_id: string | null;
    discovery_query: string | null;
    source_rank: number | null;
    vector_str: string;
    evidence_tier: string | null;
  }>(sql, params.length > 0 ? params : undefined);

  // Parse vectors from pgvector string format
  const points: AtlasPoint[] = rows.map(row => {
    let vector: number[] = [];
    try {
      // pgvector returns vectors in '[0.1,0.2,...]' format — parse directly
      vector = JSON.parse(row.vector_str) as number[];
    } catch (parseErr) {
      logger.warn(`Failed to parse vector for chunk ${row.id}:`, parseErr);
    }
    return {
      id: row.id,
      text: row.content.slice(0, 500), // truncate for Atlas
      source_url: row.source_url ?? '',
      source_title: row.source_title ?? '',
      tags: row.tags ?? [],
      chunk_index: row.chunk_index,
      evidence_tier: row.evidence_tier,
      source_type: row.source_type,
      imported_via: row.imported_via,
      discovered_by_run_id: row.discovered_by_run_id,
      discovery_query: row.discovery_query,
      source_rank: row.source_rank,
      cluster_hint: null, // populated below if distance metadata is available
      vector,
    };
  }).filter(p => p.vector.length > 0);

  // Label outlier/bridge/dense candidates using vector norm variance heuristic
  labelClusterHints(points);

  // Write JSONL file for Atlas using the canonical exports directory
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  const exportPath = path.join(EXPORTS_DIR, `atlas_${exportId}.jsonl`);
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

  // Update export record with the canonical path
  await query(
    `UPDATE atlas_exports SET chunk_count=$1, export_path=$2 WHERE id=$3`,
    [points.length, exportPath, exportId]
  );

  // Optional DR copy for quick local disaster recovery.
  if (config.exports.atlasBackupDir.trim()) {
    try {
      const backupDir = config.exports.atlasBackupDir.trim();
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupPath = path.join(backupDir, path.basename(exportPath));
      fs.copyFileSync(exportPath, backupPath);
      logger.info(`Atlas export backup copy created: ${backupPath}`);
    } catch (backupErr) {
      logger.warn('Atlas backup copy failed', backupErr);
    }
  }

  // Optional Nomic upload.
  if (config.nomic.autoUploadOnExport && config.nomic.apiKey.trim()) {
    try {
      const nomic = await uploadAtlasJsonlToNomic({
        exportPath,
        datasetSlug: config.nomic.atlasDatasetSlug,
      });
      await query(
        `UPDATE atlas_exports
            SET description = trim(concat_ws(E'\n', description, $1))
          WHERE id=$2`,
        [`Nomic upload: ${nomic.datasetUrl}`, exportId]
      );
    } catch (nomicErr) {
      logger.warn('Nomic upload failed', nomicErr);
    }
  }

  logger.info(`Atlas export complete: ${points.length} points -> ${exportPath}`);

  return { exportId, count: points.length, path: exportPath };
}

/**
 * Heuristic cluster hint labeling.
 * Uses cosine similarity mean deviation to flag outliers and bridges.
 * Does not imply truth — these are investigation signals only.
 */
function labelClusterHints(points: AtlasPoint[]): void {
  if (points.length < 10) return;

  // Compute mean vector
  const dim = points[0].vector.length;
  const mean = new Array<number>(dim).fill(0);
  for (const p of points) {
    for (let i = 0; i < dim; i++) mean[i] += p.vector[i] / points.length;
  }

  // Compute each point's distance from mean
  const dists = points.map(p => {
    let dot = 0, normP = 0, normM = 0;
    for (let i = 0; i < dim; i++) {
      dot += p.vector[i] * mean[i];
      normP += p.vector[i] ** 2;
      normM += mean[i] ** 2;
    }
    const cosSim = dot / (Math.sqrt(normP) * Math.sqrt(normM) + 1e-10);
    return 1 - cosSim; // cosine distance
  });

  const sorted = [...dists].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = p75 - p25;
  // 1.5 x IQR is the standard Tukey's fences threshold for mild outliers
  const iqrOutlierMultiplier = 1.5;
  const outlierThreshold = p75 + iqrOutlierMultiplier * iqr;
  const bridgeThreshold = p75;

  for (let i = 0; i < points.length; i++) {
    if (dists[i] > outlierThreshold) {
      points[i].cluster_hint = 'outlier_candidate';
    } else if (dists[i] > bridgeThreshold) {
      points[i].cluster_hint = 'bridge_candidate';
    } else {
      points[i].cluster_hint = 'dense_cluster_candidate';
    }
  }
}
