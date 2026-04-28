import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scope test discovery strictly to source TypeScript files.
    // This prevents vitest from also picking up compiled dist/__tests__/*.js
    // CommonJS artifacts when they exist after a `tsc` build.
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/__tests__/vitest.setup.ts'],
    // Setup files run before each test file imports anything. We use this
    // to set safe-default env values (NODE_ENV=test, DISCOVERY_ENABLED=false,
    // OPENROUTER_API_KEY=test-key) so config/index.ts's startup validators
    // do not throw when there is no backend/.env on the test runner.
    setupFiles: ['src/__tests__/vitest.setup.ts'],
  },
});
