/**
 * One-shot: assign existing research_runs / reports to a single owner (P0 legacy lock-down).
 *
 * Env (set on Emma VM backend/.env or GitHub Actions deploy secrets):
 *   REASSIGN_LEGACY_RESEARCH_OWNER=1     — enable for this deploy only
 *   LEGACY_OWNER_USER_ID=user_…        — preferred (Clerk id)
 *   LEGACY_OWNER_EMAIL=brandon@…       — fallback lookup in users table
 *   LEGACY_RESEARCH_ASSIGN_SCOPE=all_existing|unscoped_only  (default all_existing)
 *
 * Safe to re-run: after success, app_deploy_markers prevents a second mass assign.
 */
import { loadEnv } from '../bootstrap/loadEnv';
import { initDb } from '../db/pool';
import { logger } from '../utils/logger';
import {
  assignLegacyResearchOwnership,
  resolveLegacyOwnerUserId,
  type LegacyAssignScope,
} from './legacyResearchOwnership';

function parseScope(raw: string | undefined): LegacyAssignScope {
  const v = raw?.trim().toLowerCase();
  if (!v || v === 'all_existing' || v === 'all') return 'all_existing';
  if (v === 'unscoped_only' || v === 'unscoped') return 'unscoped_only';
  throw new Error(
    `Invalid LEGACY_RESEARCH_ASSIGN_SCOPE=${JSON.stringify(raw)} — use all_existing or unscoped_only`,
  );
}

async function main(): Promise<void> {
  if (process.env.REASSIGN_LEGACY_RESEARCH_OWNER !== '1') {
    logger.info(
      '[legacy-research-owner] REASSIGN_LEGACY_RESEARCH_OWNER is not 1 — nothing to do (exit 0)',
    );
    return;
  }

  loadEnv();
  await initDb();

  const ownerUserId = await resolveLegacyOwnerUserId(
    process.env.LEGACY_OWNER_USER_ID,
    process.env.LEGACY_OWNER_EMAIL,
  );
  const scope = parseScope(process.env.LEGACY_RESEARCH_ASSIGN_SCOPE);

  const result = await assignLegacyResearchOwnership({ ownerUserId, scope });
  if (result.skipped) {
    logger.info('[legacy-research-owner] Skipped (already applied)');
    return;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('[legacy-research-owner] Fatal error:', err);
    process.exit(1);
  });
