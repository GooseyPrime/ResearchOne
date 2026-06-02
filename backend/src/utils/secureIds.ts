import { randomUUID } from 'crypto';

/**
 * RFC 4122 UUID v4 for primary keys (research_runs.id, reports.id, etc.).
 * ~122 bits of randomness — suitable for unguessable resource identifiers when
 * combined with auth + RLS on list endpoints (never rely on obscurity alone).
 */
export function newEntityUuid(): string {
  return randomUUID();
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isEntityUuid(id: string): boolean {
  return UUID_V4.test(id);
}
