/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Same-origin API host for split UI + API deploys (see `frontend/.env.example`). */
const SPLIT_DEPLOYMENT_DEFAULT_ORIGIN = 'https://api.researchone.io';

/**
 * A Clerk publishable key is `pk_live_*` for a production instance and
 * `pk_test_*` for a development one. A development instance issues short-lived
 * sessions, accepts any email, and is rate-limited — shipping one to
 * researchone.io means real users on a throwaway auth backend (WO-AD §12).
 *
 * This is checked HERE, at build time, rather than at module scope in
 * `main.tsx`. A runtime `throw` before `createRoot` does not fail a build — it
 * white-screens every visitor, including on marketing routes that never touch
 * Clerk. Failing the build instead means Vercel keeps the previous good
 * deployment live and nobody sees a blank page.
 *
 * It fires only for a real production deploy. Preview and branch builds SHOULD
 * use a test key, and failing them was a self-inflicted outage of the preview
 * environment.
 */
function assertProductionClerkKey(env: Record<string, string>): void {
  const isProductionDeploy =
    process.env.VERCEL_ENV === 'production' || process.env.REQUIRE_LIVE_CLERK_KEY === '1';
  if (!isProductionDeploy) return;

  const key = (env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim();
  if (!key) {
    throw new Error(
      'VITE_CLERK_PUBLISHABLE_KEY is unset for a production deploy. Set it in the ' +
        'Vercel project (Production scope) to the pk_live_* key of the production Clerk instance.'
    );
  }
  if (key.startsWith('pk_test_')) {
    throw new Error(
      'VITE_CLERK_PUBLISHABLE_KEY is a pk_test_* key, which belongs to a Clerk DEVELOPMENT ' +
        'instance: sessions expire quickly, any email is accepted, and it is rate-limited. ' +
        'Create a production Clerk instance and set its pk_live_* key in the Vercel project ' +
        '(Production scope). Preview deploys may keep the test key.'
    );
  }
}

export default defineConfig(({ mode }) => {
  // Vitest only defaults NODE_ENV to 'test' when it is UNSET. A machine with
  // NODE_ENV=production exported globally therefore runs the suite against
  // React's production build, where `act()` throws — every React component test
  // fails with "act(...) is not supported in production builds of React" while
  // pure-function tests still pass.
  //
  // That failure mode is badly misleading: 66 tests across 13 files went red
  // and looked like repository breakage. Pin it here so the suite reports on
  // the code rather than on the developer's shell.
  if (mode === 'test') process.env.NODE_ENV = 'test';

  const fileEnv = loadEnv(mode, process.cwd(), '');
  if (mode !== 'test') assertProductionClerkKey(fileEnv);
  const useProdDefaults = mode === 'production';
  const apiBase =
    fileEnv.VITE_API_BASE_URL?.trim() ||
    (useProdDefaults ? SPLIT_DEPLOYMENT_DEFAULT_ORIGIN : '');
  const socketUrl =
    fileEnv.VITE_SOCKET_URL?.trim() ||
    (useProdDefaults ? SPLIT_DEPLOYMENT_DEFAULT_ORIGIN : '');

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
      'import.meta.env.VITE_SOCKET_URL': JSON.stringify(socketUrl),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:3001',
          ws: true,
        },
        '/exports': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      // Main bundle is ~1.7 MB (single-SPA pattern); raise the limit to silence
      // the "Some chunks are larger than 500 kB" warning without suppressing it
      // for genuinely oversized future splits.
      chunkSizeWarningLimit: 2000,
    },
    test: {
      environment: 'node',
      environmentMatchGlobs: [
        ['src/__tests__/auth/**', 'jsdom'],
        ['src/__tests__/landing/**', 'jsdom'],
      ],
    },
  };
});
