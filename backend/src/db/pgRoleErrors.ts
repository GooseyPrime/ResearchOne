/**
 * Classifies Postgres errors from SET ROLE when the target role was never created.
 * Some pools/proxies omit `code` but keep the English server message; others use
 * sqlstate 42704 (ERRCODE_UNDEFINED_OBJECT). We require the role name in the
 * message when falling back to code so unrelated 42704 errors are not swallowed.
 */
export function isPostgresRoleDoesNotExist(err: unknown, roleName: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const escaped = roleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`role\\s+"${escaped}"\\s+does\\s+not\\s+exist`, 'i').test(msg)) return true;
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return code === '42704' && msg.toLowerCase().includes(roleName.toLowerCase());
}
