/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Same-origin API host for split UI + API deploys (see `frontend/.env.example`). */
const SPLIT_DEPLOYMENT_DEFAULT_ORIGIN = 'https://api.researchone.io';

/**
 * A Clerk publishable key is `pk_live_*` for a production instance and
 * `pk_test_*` for a development one.
 *
 * ResearchOne deliberately runs a Clerk DEVELOPMENT instance in production for
 * now: a production instance is a paid Clerk plan, and the development
 * instance's limits are comfortably above current traffic. That is a chosen
 * trade-off, not a defect, so it does not fail the build.
 *
 * What IS always a defect is a missing key — the app then has no auth backend
 * at all and every sign-in silently fails. That still fails the build, at BUILD
 * time rather than at module scope in `main.tsx`: a runtime throw before
 * `createRoot` does not fail a build, it white-screens every route including
 * marketing pages that never touch Clerk. Failing here means Vercel keeps the
 * last good deployment live instead.
 *
 * Set `REQUIRE_LIVE_CLERK_KEY=1` once a production Clerk instance exists, and
 * this becomes an enforcing check: a `pk_test_*` key then fails the build and
 * cannot regress silently.
 */
function assertProductionClerkKey(env: Record<string, string>): void {
  const isProductionDeploy = process.env.VERCEL_ENV === 'production';
  const requireLiveKey = process.env.REQUIRE_LIVE_CLERK_KEY === '1';
  if (!isProductionDeploy && !requireLiveKey) return;

  const key = (env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim();
  if (!key) {
    throw new Error(
      'VITE_CLERK_PUBLISHABLE_KEY is unset for a production deploy. Sign-in cannot work ' +
        'without it. Set it in the Vercel project (Production scope).'
    );
  }

  if (!key.startsWith('pk_test_')) return;

  if (requireLiveKey) {
    throw new Error(
      'REQUIRE_LIVE_CLERK_KEY=1 but VITE_CLERK_PUBLISHABLE_KEY is a pk_test_* key, which ' +
        'belongs to a Clerk DEVELOPMENT instance. Set the production instance pk_live_* key ' +
        'in the Vercel project (Production scope), or unset REQUIRE_LIVE_CLERK_KEY.'
    );
  }

  // Visible in every production build log, so this stays a known trade-off
  // rather than something nobody remembers choosing.
  console.warn(
    '[build] Production is using a Clerk DEVELOPMENT instance (pk_test_*). ' +
      'Accepted while on Clerk\'s free plan. Set REQUIRE_LIVE_CLERK_KEY=1 after moving to a ' +
      'production instance so a test key can never come back unnoticed.'
  );
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
