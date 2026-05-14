/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
});
