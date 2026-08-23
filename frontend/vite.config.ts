/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Same-origin API host for split UI + API deploys (see `frontend/.env.example`). */
const SPLIT_DEPLOYMENT_DEFAULT_ORIGIN = 'https://api.researchone.io';

/**
 * Clerk key checks for a deployable build.
 *
 * TWO separate rules, and conflating them was the defect Copilot caught on
 * #219: a single early return scoped BOTH to production deploys, so a preview
 * build with no key at all sailed through and shipped
 * `<ClerkProvider publishableKey="">` — an app where every sign-in fails.
 *
 *   Key MISSING      — fails every BUILD, whatever the deploy target or mode.
 *                      There is no environment in which shipping a bundle with
 *                      no auth backend is intended. Only `vite dev` is exempt,
 *                      because it is not a deployable artifact.
 *
 *                      Gated on `command`, not `mode`: Vite's ConfigEnv defines
 *                      `command` as 'serve' | 'build', while `mode` is
 *                      independently selectable with `--mode`. Testing `mode`
 *                      let `vite build --mode development` emit a deployable
 *                      bundle with an empty key, and wrongly rejected
 *                      `vite dev --mode production` (Codex, #220).
 *
 *   Key is pk_test_* — a Clerk DEVELOPMENT instance. ResearchOne deliberately
 *                      runs one in production: a production instance is a paid
 *                      Clerk plan and the development instance's limits sit
 *                      well above current traffic. Accepted, and logged once so
 *                      the trade-off stays visible. Preview builds are expected
 *                      to use one and say nothing.
 *
 * Set `REQUIRE_LIVE_CLERK_KEY=1` once a production Clerk instance exists and
 * `pk_test_*` becomes a build failure that cannot regress unnoticed.
 *
 * All of this is BUILD time rather than module scope in `main.tsx`. A throw
 * before `createRoot` does not fail a build — it renders nothing on every
 * route, including marketing pages that never touch Clerk. Failing here means
 * Vercel keeps the last good deployment live instead.
 */
function assertClerkKey(env: Record<string, string>, command: 'serve' | 'build'): void {
  // `vite dev` is not a deployable artifact; every built one is checked.
  if (command !== 'build') return;

  const key = (env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim();
  if (!key) {
    throw new Error(
      'VITE_CLERK_PUBLISHABLE_KEY is unset. A build without it ships ClerkProvider with an ' +
        'empty key and every sign-in fails. Set it in the Vercel project for this scope ' +
        '(Production and Preview both need one).'
    );
  }

  if (!key.startsWith('pk_test_')) return;

  if (process.env.REQUIRE_LIVE_CLERK_KEY === '1') {
    throw new Error(
      'REQUIRE_LIVE_CLERK_KEY=1 but VITE_CLERK_PUBLISHABLE_KEY is a pk_test_* key, which ' +
        'belongs to a Clerk DEVELOPMENT instance. Set the production instance pk_live_* key ' +
        'in the Vercel project (Production scope), or unset REQUIRE_LIVE_CLERK_KEY.'
    );
  }

  if (process.env.VERCEL_ENV === 'production') {
    // Visible in every production build log, so this stays a known trade-off
    // rather than something nobody remembers choosing.
    console.warn(
      '[build] Production is using a Clerk DEVELOPMENT instance (pk_test_*). ' +
        'Accepted while on Clerk\'s free plan. Set REQUIRE_LIVE_CLERK_KEY=1 after moving to a ' +
        'production instance so a test key can never come back unnoticed.'
    );
  }
}

export default defineConfig(({ command, mode }) => {
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
  assertClerkKey(fileEnv, command);
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
