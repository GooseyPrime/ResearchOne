// Vitest setup file: configure env defaults safe for all tests.
// Loaded via vitest.config.ts before any test file imports config.

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DISCOVERY_ENABLED = process.env.DISCOVERY_ENABLED ?? 'false';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
