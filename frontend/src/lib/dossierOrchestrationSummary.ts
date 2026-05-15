/**
 * Wave 5.2 — parse dossier_statistics orchestration JSON and build UI copy.
 */
import type { DossierStats } from '../utils/api';

const STAGE_META_KEYS = new Set(['_profileDisplayName', '_intentId']);

export function parseJsonStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string');
  }
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw) as unknown;
      return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseStageDurationsRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw) as unknown;
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Count of orchestrator stages that recorded a non-null duration (actually ran). */
export function countRanStagesFromDurations(stageDurations: Record<string, unknown>): number {
  let n = 0;
  for (const [k, v] of Object.entries(stageDurations)) {
    if (STAGE_META_KEYS.has(k)) continue;
    if (typeof v === 'number' && !Number.isNaN(v)) n += 1;
  }
  return n;
}

export function totalStagesFromAgentsLists(agentsRan: unknown, agentsSkipped: unknown): number {
  const ran = parseJsonStringArray(agentsRan);
  const skipped = parseJsonStringArray(agentsSkipped);
  const t = ran.length + skipped.length;
  return t > 0 ? t : 0;
}

export function profileDisplayNameFromStats(stats: DossierStats): string | null {
  const sd = parseStageDurationsRecord(stats.stageDurations);
  const v = sd._profileDisplayName;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Prominent one-line summary, e.g. "Reference lookup ran 8 of 11 pipeline stages, completing in about 12 seconds."
 */
export function buildOrchestrationHeadline(stats: DossierStats, intentLabel?: string | null): string | null {
  const total = totalStagesFromAgentsLists(stats.agentsRan, stats.agentsSkipped);
  if (total <= 0) return null;

  const ranFromLists = parseJsonStringArray(stats.agentsRan).length;
  const sd = parseStageDurationsRecord(stats.stageDurations);
  const ranFromDur = countRanStagesFromDurations(sd);
  const ran = ranFromLists > 0 ? ranFromLists : ranFromDur;

  const profile = profileDisplayNameFromStats(stats) ?? (intentLabel && intentLabel.trim()) ?? 'This dossier';
  const ms = stats.totalDurationMs;
  const sec = ms != null && ms > 0 ? Math.max(1, Math.round(ms / 1000)) : null;
  const timing = sec != null ? `, completing in about ${sec} second${sec === 1 ? '' : 's'}` : '';
  return `${profile} ran ${ran} of ${total} pipeline stages${timing}.`;
}
