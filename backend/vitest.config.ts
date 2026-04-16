import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scope test discovery strictly to source TypeScript files.
    // This prevents vitest from also picking up compiled dist/__tests__/*.js
    // CommonJS artifacts when they exist after a `tsc` build.
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
