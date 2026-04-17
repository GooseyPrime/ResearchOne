type SplitDeploymentEnv = Pick<
  ImportMetaEnv,
  'PROD' | 'VITE_API_BASE_URL' | 'VITE_SOCKET_URL'
>;

/**
 * Split deployment (Vercel UI + Emma API): VITE_* vars are baked in at build time.
 * Missing them in production makes the app call same-origin /api (Vercel), which has no API routes.
 */
export function assertSplitDeploymentEnv(env: SplitDeploymentEnv = import.meta.env): void {
  if (!env.PROD) return;

  const apiBase = (env.VITE_API_BASE_URL ?? '').trim();
  const socketUrl = (env.VITE_SOCKET_URL ?? '').trim();

  const missing: string[] = [];
  if (!apiBase) missing.push('VITE_API_BASE_URL');
  if (!socketUrl) missing.push('VITE_SOCKET_URL');

  if (missing.length === 0) return;

  const list = missing.join(', ');
  throw new Error(
    `ResearchOne split deployment misconfiguration: set ${list} in the Vercel project ` +
      '(Production and Preview), then redeploy. Example base: https://research-api.example.com ' +
      '(no trailing /api; the app appends /api for REST).'
  );
}
