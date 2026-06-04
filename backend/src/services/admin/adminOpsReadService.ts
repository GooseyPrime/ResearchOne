/**
 * Admin ops dashboard read helpers — bypass RLS via adminQuery.
 * Deploy-skew tolerant for optional tables/columns (Rule 13 / cost sidecar I-6).
 */
import { adminQuery } from '../../db/pool';
import { config } from '../../config';
import { getStripeClient } from '../billing/stripeClient';
import { buildOpenRouterAppHeaders } from '../openrouter/openrouterProviderBlock';
import { logger } from '../../utils/logger';

const IN_FLIGHT_RUN_STATUSES = ['running', 'queued', 'plan_pending_confirmation'] as const;

function isPostgresSkew(err: unknown, codes: string[]): boolean {
  const code = (err as { code?: string })?.code;
  return Boolean(code && codes.includes(code));
}

function isMigrationPending(err: unknown): boolean {
  return isPostgresSkew(err, ['42P01']);
}

function isMissingColumn(err: unknown): boolean {
  return isPostgresSkew(err, ['42703']);
}

function clampDays(raw: number | undefined, fallback = 30): number {
  const n = Number.isFinite(raw) ? (raw as number) : fallback;
  return Math.max(1, Math.min(365, n));
}

function sinceIso(days: number): string {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since.toISOString();
}

export interface AdminTierDistributionRow {
  tier: string;
  count: number;
}

export interface AdminPersonaRollupRow {
  persona: string;
  viewCount: number;
  ctaClickCount: number;
}

export interface AdminOverviewMetrics {
  days: number;
  signups: number;
  activeRuns: number;
  reportsCompleted7d: number;
  reportsCompleted30d: number;
  tierDistribution: AdminTierDistributionRow[];
  avgCostPerRunUsd: number | null;
  costTelemetry: { available: boolean; reason?: string };
  personaRollup: {
    available: boolean;
    reason?: string;
    days: number;
    personas: AdminPersonaRollupRow[];
  };
}

export interface AdminReportListRow {
  reportId: string;
  title: string;
  status: string;
  runId: string | null;
  runTitle: string | null;
  runStatus: string | null;
  userId: string | null;
  userEmail: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface AdminReportListResult {
  days: number;
  limit: number;
  offset: number;
  total: number;
  rows: AdminReportListRow[];
}

export interface AdminCorpusSourceRow {
  sourceId: string;
  title: string | null;
  url: string | null;
  sourceType: string;
  documentCount: number;
  chunkCount: number;
  ownerUserId: string | null;
  ingestedAt: string;
}

export interface AdminCorpusListResult {
  search: string;
  limit: number;
  offset: number;
  total: number;
  consentFilterApplied: boolean;
  notice?: string;
  rows: AdminCorpusSourceRow[];
}

export type VendorBalanceStatus = 'ok' | 'unverified' | 'unavailable';

export interface AdminVendorBalance {
  id: string;
  label: string;
  balanceUsd: number | null;
  status: VendorBalanceStatus;
  detail?: string;
}

export interface AdminVendorBalancesResult {
  vendors: AdminVendorBalance[];
}

async function countCompletedReports(since: string): Promise<number> {
  const rows = await adminQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM reports
      WHERE status = 'finalized'
        AND COALESCE(finalized_at, updated_at, created_at) >= $1::timestamptz`,
    [since]
  );
  return Number(rows[0]?.count ?? 0);
}

async function fetchAvgCostPerRunUsd(sinceIso: string): Promise<{
  avgCostPerRunUsd: number | null;
  costTelemetry: { available: boolean; reason?: string };
}> {
  try {
    const rows = await adminQuery<{
      total_cost_usd: string;
      distinct_runs: string;
    }>(
      `SELECT
         COALESCE(SUM(calculated_cost_usd), 0)::text AS total_cost_usd,
         COUNT(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL)::text AS distinct_runs
       FROM agent_executions
       WHERE created_at >= $1`,
      [sinceIso]
    );
    const totalCost = Number(rows[0]?.total_cost_usd ?? 0);
    const distinctRuns = Number(rows[0]?.distinct_runs ?? 0);
    return {
      avgCostPerRunUsd: distinctRuns > 0 ? totalCost / distinctRuns : null,
      costTelemetry: { available: true },
    };
  } catch (err) {
    if (isMigrationPending(err)) {
      return {
        avgCostPerRunUsd: null,
        costTelemetry: { available: false, reason: 'migration_pending' },
      };
    }
    throw err;
  }
}

async function fetchPersonaRollup(days: number, since: string): Promise<AdminOverviewMetrics['personaRollup']> {
  try {
    const rows = await adminQuery<{
      persona: string;
      view_count: string;
      cta_click_count: string;
    }>(
      `SELECT
         persona,
         COUNT(*) FILTER (WHERE event_type = 'view')::text AS view_count,
         COUNT(*) FILTER (WHERE event_type = 'cta_click')::text AS cta_click_count
       FROM landing_persona_events
       WHERE bucketed_at >= $1
       GROUP BY persona
       ORDER BY COUNT(*) FILTER (WHERE event_type = 'view') DESC`,
      [since]
    );
    return {
      available: true,
      days,
      personas: rows.map((r) => ({
        persona: r.persona,
        viewCount: Number(r.view_count),
        ctaClickCount: Number(r.cta_click_count),
      })),
    };
  } catch (err) {
    if (isMigrationPending(err)) {
      return { available: false, reason: 'migration_pending', days, personas: [] };
    }
    throw err;
  }
}

export async function getAdminOverviewMetrics(daysInput = 30): Promise<AdminOverviewMetrics> {
  const days = clampDays(daysInput);
  const since = sinceIso(days);
  const since7d = sinceIso(7);
  const since30d = sinceIso(30);

  const [
    signupRows,
    activeRunRows,
    reportsCompleted7d,
    reportsCompleted30d,
    tierRows,
    costBlock,
    personaRollup,
  ] = await Promise.all([
    adminQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE created_at >= $1`,
      [since]
    ),
    adminQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM research_runs
        WHERE status::text = ANY($1::text[])`,
      [[...IN_FLIGHT_RUN_STATUSES]]
    ),
    countCompletedReports(since7d),
    countCompletedReports(since30d),
    adminQuery<{ tier: string; count: string }>(
      `SELECT COALESCE(tier, 'unknown') AS tier, COUNT(*)::text AS count
         FROM user_tiers
        GROUP BY tier
        ORDER BY COUNT(*) DESC`,
      []
    ),
    fetchAvgCostPerRunUsd(since),
    fetchPersonaRollup(days, since),
  ]);

  return {
    days,
    signups: Number(signupRows[0]?.count ?? 0),
    activeRuns: Number(activeRunRows[0]?.count ?? 0),
    reportsCompleted7d,
    reportsCompleted30d,
    tierDistribution: tierRows.map((r) => ({
      tier: r.tier,
      count: Number(r.count),
    })),
    avgCostPerRunUsd: costBlock.avgCostPerRunUsd,
    costTelemetry: costBlock.costTelemetry,
    personaRollup,
  };
}

export async function listAdminReports(opts: {
  limit?: number;
  offset?: number;
  days?: number;
}): Promise<AdminReportListResult> {
  const days = clampDays(opts.days);
  const limit = Math.max(1, Math.min(200, Number.isFinite(opts.limit) ? (opts.limit as number) : 50));
  const offset = Math.max(0, Number.isFinite(opts.offset) ? (opts.offset as number) : 0);
  const since = sinceIso(days);

  const countRows = await adminQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM reports r
      WHERE r.created_at >= $1`,
    [since]
  );

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await adminQuery(
      `SELECT
         r.id AS report_id,
         r.title,
         r.status::text AS status,
         r.run_id,
         r.user_id,
         r.created_at,
         r.finalized_at,
         rr.title AS run_title,
         rr.status::text AS run_status,
         u.email AS user_email
       FROM reports r
       LEFT JOIN research_runs rr ON rr.id = r.run_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.created_at >= $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [since, limit, offset]
    );
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    rows = await adminQuery(
      `SELECT
         r.id AS report_id,
         r.title,
         r.status::text AS status,
         r.run_id,
         NULL::text AS user_id,
         r.created_at,
         r.finalized_at,
         rr.title AS run_title,
         rr.status::text AS run_status,
         NULL::text AS user_email
       FROM reports r
       LEFT JOIN research_runs rr ON rr.id = r.run_id
       WHERE r.created_at >= $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [since, limit, offset]
    );
  }

  return {
    days,
    limit,
    offset,
    total: Number(countRows[0]?.count ?? 0),
    rows: rows.map((r) => ({
      reportId: String(r.report_id),
      title: String(r.title ?? ''),
      status: String(r.status ?? ''),
      runId: r.run_id ? String(r.run_id) : null,
      runTitle: r.run_title ? String(r.run_title) : null,
      runStatus: r.run_status ? String(r.run_status) : null,
      userId: r.user_id ? String(r.user_id) : null,
      userEmail: r.user_email ? String(r.user_email) : null,
      createdAt: String(r.created_at),
      finalizedAt: r.finalized_at ? String(r.finalized_at) : null,
    })),
  };
}

/** Pipeline B shared corpus — consent-filtered source listing for operators. */
const CORPUS_CONSENT_WHERE = `
  (
    owner.owner_user_id IS NULL
    OR (
      EXISTS (
        SELECT 1 FROM user_ingestion_consent uic
         WHERE uic.user_id = owner.owner_user_id
           AND uic.pipeline_b_consent = TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM run_user_overrides ruo
         WHERE ruo.run_id = s.discovered_by_run_id::text
           AND ruo.pipeline_b_opt_out = TRUE
      )
    )
  )
`;

const CORPUS_OWNER_LATERAL = `
  LEFT JOIN research_runs rr ON rr.id = s.discovered_by_run_id
  LEFT JOIN LATERAL (
    SELECT ij2.user_id
      FROM ingestion_jobs ij2
     WHERE ij2.source_id = s.id
     ORDER BY ij2.created_at DESC NULLS LAST
     LIMIT 1
  ) ij ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(s.metadata->>'ingested_by_user_id', ''),
      rr.user_id::text,
      ij.user_id
    ) AS owner_user_id
  ) owner ON TRUE
`;

export async function listAdminCorpusSources(opts: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminCorpusListResult> {
  const search = (opts.search ?? '').trim();
  const limit = Math.max(1, Math.min(200, Number.isFinite(opts.limit) ? (opts.limit as number) : 50));
  const offset = Math.max(0, Number.isFinite(opts.offset) ? (opts.offset as number) : 0);

  const params: unknown[] = [];
  let idx = 1;
  const filters: string[] = [];

  if (search) {
    filters.push(`(
      s.title ILIKE $${idx}
      OR s.url ILIKE $${idx}
      OR s.id::text ILIKE $${idx}
    )`);
    params.push(`%${search}%`);
    idx++;
  }

  const whereParts = [...filters];

  const runListQuery = (consentFilter: boolean) => {
    const consentClause = consentFilter ? [CORPUS_CONSENT_WHERE] : [];
    const whereSql = [...whereParts, ...consentClause].length
      ? `WHERE ${[...whereParts, ...consentClause].join(' AND ')}`
      : '';

    return {
      countSql: `
        SELECT COUNT(*)::text AS count
          FROM sources s
          ${CORPUS_OWNER_LATERAL}
          ${whereSql}`,
      listSql: `
        SELECT
          s.id AS source_id,
          s.title,
          s.url,
          s.source_type::text AS source_type,
          s.ingested_at,
          owner.owner_user_id,
          COUNT(DISTINCT d.id)::text AS document_count,
          COUNT(DISTINCT c.id)::text AS chunk_count
        FROM sources s
        ${CORPUS_OWNER_LATERAL}
        LEFT JOIN documents d ON d.source_id = s.id
        LEFT JOIN chunks c ON c.source_id = s.id
        ${whereSql}
        GROUP BY s.id, s.title, s.url, s.source_type, s.ingested_at, owner.owner_user_id
        ORDER BY s.ingested_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
    };
  };

  let consentFilterApplied = true;
  let notice: string | undefined;

  const tryList = async (consentFilter: boolean) => {
    const { countSql, listSql } = runListQuery(consentFilter);
    const countRows = await adminQuery<{ count: string }>(countSql, params);
    const listParams = [...params, limit, offset];
    const rows = await adminQuery<{
      source_id: string;
      title: string | null;
      url: string | null;
      source_type: string;
      ingested_at: string;
      owner_user_id: string | null;
      document_count: string;
      chunk_count: string;
    }>(listSql, listParams);
    return { total: Number(countRows[0]?.count ?? 0), rows };
  };

  let total = 0;
  let rows: Awaited<ReturnType<typeof tryList>>['rows'];

  try {
    ({ total, rows } = await tryList(true));
  } catch (err) {
    if (isMigrationPending(err) || isMissingColumn(err)) {
      consentFilterApplied = false;
      notice = 'consent_tables_unavailable';
      ({ total, rows } = await tryList(false));
    } else {
      throw err;
    }
  }

  return {
    search,
    limit,
    offset,
    total,
    consentFilterApplied,
    ...(notice ? { notice } : {}),
    rows: rows.map((r) => ({
      sourceId: r.source_id,
      title: r.title,
      url: r.url,
      sourceType: r.source_type,
      documentCount: Number(r.document_count),
      chunkCount: Number(r.chunk_count),
      ownerUserId: r.owner_user_id,
      ingestedAt: r.ingested_at,
    })),
  };
}

/** OpenRouter GET /credits — see https://openrouter.ai/docs/api-reference/credits/get-credits */
async function fetchOpenRouterCreditsBalance(): Promise<AdminVendorBalance> {
  const apiKey = config.openrouter.apiKey.trim();
  if (!apiKey) {
    return {
      id: 'openrouter',
      label: 'OpenRouter',
      balanceUsd: null,
      status: 'unverified',
      detail: 'OPENROUTER_API_KEY not configured',
    };
  }

  const base = config.openrouter.baseUrl.replace(/\/+$/, '');
  const url = `${base}/credits`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: buildOpenRouterAppHeaders(apiKey),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('admin_openrouter_credits_failed', { status: res.status, body: body.slice(0, 200) });
      return {
        id: 'openrouter',
        label: 'OpenRouter',
        balanceUsd: null,
        status: 'unavailable',
        detail: `HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as {
      data?: { total_credits?: number; total_usage?: number };
      total_credits?: number;
      total_usage?: number;
    };
    const data = payload.data ?? payload;
    const totalCredits = Number(data.total_credits);
    const totalUsage = Number(data.total_usage);
    if (!Number.isFinite(totalCredits) && !Number.isFinite(totalUsage)) {
      return {
        id: 'openrouter',
        label: 'OpenRouter',
        balanceUsd: null,
        status: 'unavailable',
        detail: 'Unexpected credits response shape',
      };
    }
    const balanceUsd = (Number.isFinite(totalCredits) ? totalCredits : 0)
      - (Number.isFinite(totalUsage) ? totalUsage : 0);
    return {
      id: 'openrouter',
      label: 'OpenRouter',
      balanceUsd,
      status: 'ok',
    };
  } catch (err) {
    logger.warn('admin_openrouter_credits_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      id: 'openrouter',
      label: 'OpenRouter',
      balanceUsd: null,
      status: 'unavailable',
      detail: err instanceof Error ? err.message : 'Request failed',
    };
  }
}

async function fetchStripeBalance(): Promise<AdminVendorBalance> {
  if (!config.stripe.secretKey.trim()) {
    return {
      id: 'stripe',
      label: 'Stripe',
      balanceUsd: null,
      status: 'unverified',
      detail: 'STRIPE_SECRET_KEY not configured',
    };
  }

  try {
    const stripe = getStripeClient();
    const balance = await stripe.balance.retrieve();
    let cents = 0;
    for (const entry of balance.available ?? []) {
      if (entry.currency === 'usd') {
        cents += entry.amount;
      }
    }
    return {
      id: 'stripe',
      label: 'Stripe',
      balanceUsd: cents / 100,
      status: 'ok',
    };
  } catch (err) {
    logger.warn('admin_stripe_balance_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      id: 'stripe',
      label: 'Stripe',
      balanceUsd: null,
      status: 'unavailable',
      detail: err instanceof Error ? err.message : 'Request failed',
    };
  }
}

export async function getVendorBalances(): Promise<AdminVendorBalancesResult> {
  const [openrouter, stripe] = await Promise.all([
    fetchOpenRouterCreditsBalance(),
    fetchStripeBalance(),
  ]);
  return { vendors: [openrouter, stripe] };
}
