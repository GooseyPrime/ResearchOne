/**
 * The application's own production build, with two changes for the harness
 * (see README.md): `@clerk/react` is the signed-in stand-in beside this file,
 * and the API address is the harness's own server.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import appConfig from '../../vite.config';

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = `http://127.0.0.1:${process.env.HARNESS_PORT ?? '4010'}`;

export default defineConfig(async (env: ConfigEnv) => {
  // The build refuses to run without a key; the stand-in never reads it.
  process.env.VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_harness';
  const base = (await (appConfig as (env: ConfigEnv) => UserConfig | Promise<UserConfig>)(env)) as UserConfig;
  const merged = mergeConfig(base, {
    root: path.resolve(here, '../..'),
    resolve: { alias: { '@clerk/react': path.resolve(here, 'clerk-stub.tsx') } },
    build: { outDir: path.resolve(here, 'dist'), emptyOutDir: true },
  });
  merged.define = {
    ...merged.define,
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(origin),
    'import.meta.env.VITE_SOCKET_URL': JSON.stringify(origin),
    'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_harness'),
  };
  return merged;
});
