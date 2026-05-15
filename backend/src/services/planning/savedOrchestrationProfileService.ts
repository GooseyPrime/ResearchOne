/**
 * Wave 5.4 — CRUD for saved_orchestration_profiles with tier gates.
 */
import { query, queryOne } from '../../db/pool';
import type { TierName } from '../../config/tierRules';
import { getUserTier } from '../tier/tierService';

export interface SavedOrchestrationProfileRow {
  id: string;
  userId: string;
  orgId: string | null;
  name: string;
  description: string | null;
  baseIntent: string;
  customizations: unknown;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Wave 5.4: Free Demo and anonymous have no saved profiles; paid paths do. */
function tierAllowsSavedProfiles(tier: TierName): boolean {
  return tier !== 'free_demo' && tier !== 'anonymous';
}

function tierAllowsOrgSharedProfiles(tier: TierName): boolean {
  return tier === 'sovereign' || tier === 'admin';
}

export async function listSavedProfiles(userId: string, orgId: string | null): Promise<SavedOrchestrationProfileRow[]> {
  const { tier } = await getUserTier(userId);
  if (!tierAllowsSavedProfiles(tier)) return [];

  try {
    const rows = await query<{
      id: string;
      user_id: string;
      org_id: string | null;
      name: string;
      description: string | null;
      base_intent: string;
      customizations: unknown;
      is_shared: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, org_id, name, description, base_intent, customizations, is_shared, created_at, updated_at
         FROM saved_orchestration_profiles
        WHERE user_id = $1
           OR ($2::text IS NOT NULL AND org_id = $2::text AND is_shared = TRUE)
        ORDER BY updated_at DESC`,
      [userId, orgId ?? null]
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      orgId: r.org_id,
      name: r.name,
      description: r.description,
      baseIntent: r.base_intent,
      customizations: r.customizations,
      isShared: r.is_shared,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return [];
    throw e;
  }
}

export async function createSavedProfile(input: {
  userId: string;
  orgId: string | null;
  name: string;
  description?: string | null;
  baseIntent: string;
  customizations: unknown;
  isShared?: boolean;
}): Promise<SavedOrchestrationProfileRow> {
  const { tier } = await getUserTier(input.userId);
  if (!tierAllowsSavedProfiles(tier)) {
    throw Object.assign(new Error('Saved profiles require a paid tier'), { statusCode: 403 });
  }
  const wantShared = Boolean(input.isShared);
  if (wantShared && !tierAllowsOrgSharedProfiles(tier)) {
    throw Object.assign(new Error('Org-shared profiles require Sovereign Enterprise'), { statusCode: 403 });
  }
  if (wantShared && !input.orgId) {
    throw Object.assign(new Error('orgId required for shared profiles'), { statusCode: 400 });
  }

  const row = await queryOne<{
    id: string;
    user_id: string;
    org_id: string | null;
    name: string;
    description: string | null;
    base_intent: string;
    customizations: unknown;
    is_shared: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO saved_orchestration_profiles (
       user_id, org_id, name, description, base_intent, customizations, is_shared
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id, user_id, org_id, name, description, base_intent, customizations, is_shared, created_at, updated_at`,
    [
      input.userId,
      wantShared ? input.orgId : null,
      input.name.trim().slice(0, 200),
      input.description?.trim()?.slice(0, 2000) ?? null,
      input.baseIntent.slice(0, 64),
      JSON.stringify(input.customizations ?? {}),
      wantShared,
    ]
  );
  if (!row) throw new Error('createSavedProfile: insert failed');
  return {
    id: row.id,
    userId: row.user_id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    baseIntent: row.base_intent,
    customizations: row.customizations,
    isShared: row.is_shared,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Load a single profile visible to the user (owned row or org-shared).
 * Used when starting a run with `savedOrchestrationProfileId`.
 */
export async function getSavedProfileVisibleToUser(
  userId: string,
  orgId: string | null,
  profileId: string
): Promise<SavedOrchestrationProfileRow | null> {
  const { tier } = await getUserTier(userId);
  if (!tierAllowsSavedProfiles(tier)) return null;
  const id = profileId.trim();
  if (!id) return null;
  try {
    const row = await queryOne<{
      id: string;
      user_id: string;
      org_id: string | null;
      name: string;
      description: string | null;
      base_intent: string;
      customizations: unknown;
      is_shared: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, org_id, name, description, base_intent, customizations, is_shared, created_at, updated_at
         FROM saved_orchestration_profiles
        WHERE id = $1::uuid
          AND (
            user_id = $2
            OR ($3::text IS NOT NULL AND org_id = $3::text AND is_shared = TRUE)
          )`,
      [id, userId, orgId ?? null]
    );
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      orgId: row.org_id,
      name: row.name,
      description: row.description,
      baseIntent: row.base_intent,
      customizations: row.customizations,
      isShared: row.is_shared,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return null;
    throw e;
  }
}

export async function deleteSavedProfile(userId: string, id: string): Promise<boolean> {
  const { tier } = await getUserTier(userId);
  if (!tierAllowsSavedProfiles(tier)) return false;
  const r = await queryOne<{ id: string }>(
    `DELETE FROM saved_orchestration_profiles WHERE id = $1::uuid AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return Boolean(r?.id);
}
