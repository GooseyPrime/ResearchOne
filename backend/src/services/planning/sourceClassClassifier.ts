/**
 * Wave 5.3 — classify retrieved sources on an orthogonal source-class axis.
 */
import { callRoleModel, SYSTEM_PROMPTS } from '../openrouter/openrouterService';
import type { ResearchObjective } from '../reasoning/reasoningModelPolicy';
import type { RetrievedChunk } from '../retrieval/retrievalService';
import { logger } from '../../utils/logger';
import { SOURCE_CLASS_CONFIDENCE_FLOOR, type SourceClassId } from './sourceClassTypes';
import { isSourceClassId } from './sourceClassTypes';
import type { SourceClassMap } from './wave53EpistemicPolicy';

const MAX_UNIQUE_SOURCES_PER_CALL = 40;

export function normalizeSourceUrl(url: string): string {
  return url.trim();
}

function emptyMaps(): SourceClassMap {
  return { byChunkId: new Map(), bySourceUrl: new Map() };
}

interface ClassifierItemRow {
  id: string;
  source_class: string | null;
  confidence?: number;
}

/** Exported for unit tests (Rule 16). */
export function parseClassifierPayload(raw: string): ClassifierItemRow[] {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]) as { items?: unknown };
    if (!parsed.items || !Array.isArray(parsed.items)) return [];
    const out: ClassifierItemRow[] = [];
    for (const row of parsed.items) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : '';
      const conf = typeof r.confidence === 'number' ? r.confidence : 0;
      const sc = r.source_class === null || r.source_class === undefined ? null : String(r.source_class);
      if (!id) continue;
      out.push({ id, source_class: sc, confidence: conf });
    }
    return out;
  } catch {
    return [];
  }
}

/** Exported for unit tests — applies confidence floor + schema ids (Rule 16). */
export function resolvedClass(row: ClassifierItemRow): SourceClassId | null {
  const conf = row.confidence ?? 0;
  if (conf < SOURCE_CLASS_CONFIDENCE_FLOOR) return null;
  if (!row.source_class || !isSourceClassId(row.source_class)) return null;
  return row.source_class;
}

/**
 * Classify retrieved chunks. Batches by unique `source_url` when the corpus is large.
 */
export async function classifyRetrievedSources(args: {
  chunks: RetrievedChunk[];
  researchQuery: string;
  retrieverAnalysis: string;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  byokApiKeyOverride?: string;
}): Promise<SourceClassMap> {
  const { chunks, researchQuery, retrieverAnalysis } = args;
  if (chunks.length === 0) return emptyMaps();

  const byChunkId = new Map<string, SourceClassId | null>();
  const bySourceUrl = new Map<string, SourceClassId | null>();

  type Group = { canonicalUrl: string; chunkIds: string[]; snippet: string };
  const groups = new Map<string, Group>();

  for (const c of chunks) {
    const urlKey = normalizeSourceUrl(c.source_url || '') || `chunk:${c.id}`;
    let g = groups.get(urlKey);
    if (!g) {
      g = { canonicalUrl: c.source_url?.trim() || '', chunkIds: [], snippet: c.content.slice(0, 420) };
      groups.set(urlKey, g);
    }
    g.chunkIds.push(c.id);
    if (!g.snippet && c.content) g.snippet = c.content.slice(0, 420);
  }

  const groupList = [...groups.values()];
  const batches: Group[][] = [];
  for (let i = 0; i < groupList.length; i += MAX_UNIQUE_SOURCES_PER_CALL) {
    batches.push(groupList.slice(i, i + MAX_UNIQUE_SOURCES_PER_CALL));
  }

  for (const batch of batches) {
    const items = batch.map((g, idx) => ({
      id: g.canonicalUrl ? `url:${g.canonicalUrl}` : `nogroup:${idx}`,
      source_url: g.canonicalUrl || null,
      representative_chunk_ids: g.chunkIds.slice(0, 5),
      text_excerpt: g.snippet,
    }));

    try {
      const result = await callRoleModel({
        role: 'source_class_classifier',
        engineVersion: args.engineVersion,
        researchObjective: args.researchObjective,
        allowFallbackByRole: args.allowFallbackByRole,
        byokApiKeyOverride: args.byokApiKeyOverride,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.source_class_classifier },
          {
            role: 'user',
            content:
              `Research query:\n${researchQuery}\n\nRetriever analysis (summary):\n${retrieverAnalysis.slice(0, 12000)}\n\n` +
              `Classify each item. Use JSON schema from system prompt.\n${JSON.stringify({ items }, null, 2)}`,
          },
        ],
        maxTokens: 4096,
      });

      const rows = parseClassifierPayload(result.content);
      const byBatchId = new Map<string, SourceClassId | null>();
      for (const row of rows) {
        byBatchId.set(row.id, resolvedClass(row));
      }

      for (let idx = 0; idx < batch.length; idx++) {
        const g = batch[idx]!;
        const bid = g.canonicalUrl ? `url:${g.canonicalUrl}` : `nogroup:${idx}`;
        const cls = byBatchId.get(bid) ?? null;
        if (g.canonicalUrl) bySourceUrl.set(normalizeSourceUrl(g.canonicalUrl), cls);
        for (const cid of g.chunkIds) {
          byChunkId.set(cid, cls);
        }
      }
    } catch (e) {
      logger.warn('[sourceClassClassifier] batch failed', {
        error: e instanceof Error ? e.message : String(e),
        batchSize: batch.length,
      });
      for (const g of batch) {
        if (g.canonicalUrl) bySourceUrl.set(normalizeSourceUrl(g.canonicalUrl), null);
        for (const cid of g.chunkIds) byChunkId.set(cid, null);
      }
    }
  }

  return { byChunkId, bySourceUrl };
}
