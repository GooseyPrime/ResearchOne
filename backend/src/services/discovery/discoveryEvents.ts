/**
 * The run's discovery record (`discovery_events`): one row per thing discovery
 * did. Kept in a module of its own so the retrieval layer can add to the same
 * record without loading the discovery orchestrator and its queues.
 */
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { logger } from '../../utils/logger';

export async function recordDiscoveryEvent(
  runId: string,
  phase: string,
  provider: string,
  queryText: string,
  resultCount: number,
  selectedCount: number,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO discovery_events (id, run_id, phase, provider, query_text, result_count, selected_count, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uuidv4(), runId, phase, provider, queryText, resultCount, selectedCount, JSON.stringify(payload)]
    );
  } catch (err) {
    // Don't fail the research run if audit persistence fails
    logger.warn('[discovery] Failed to persist discovery event:', err);
  }
}
