import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('sovereign deployment routing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('deployment config', () => {
    it('defaults to b2c_shared mode', async () => {
      delete process.env.DEPLOYMENT_MODE;
      delete process.env.EXCLUDE_INTELLME_CLIENT;
      const { DEPLOYMENT_MODE, EXCLUDE_INTELLME_CLIENT } = await import('../config/deployment');
      expect(DEPLOYMENT_MODE).toBe('b2c_shared');
      expect(EXCLUDE_INTELLME_CLIENT).toBe(false);
    });

    it('sovereign mode excludes InTellMe client', async () => {
      process.env.DEPLOYMENT_MODE = 'sovereign';
      delete process.env.EXCLUDE_INTELLME_CLIENT;
      const { DEPLOYMENT_MODE, EXCLUDE_INTELLME_CLIENT, isSovereignDeployment } = await import('../config/deployment');
      expect(DEPLOYMENT_MODE).toBe('sovereign');
      expect(EXCLUDE_INTELLME_CLIENT).toBe(true);
      expect(isSovereignDeployment).toBe(true);
    });

    it('EXCLUDE_INTELLME_CLIENT=true works independently of DEPLOYMENT_MODE', async () => {
      process.env.DEPLOYMENT_MODE = 'b2c_shared';
      process.env.EXCLUDE_INTELLME_CLIENT = 'true';
      const { DEPLOYMENT_MODE, EXCLUDE_INTELLME_CLIENT } = await import('../config/deployment');
      expect(DEPLOYMENT_MODE).toBe('b2c_shared');
      expect(EXCLUDE_INTELLME_CLIENT).toBe(true);
    });
  });

  describe('InTellMe client conditional import', () => {
    it('B2C build imports the real client (no throw on call)', async () => {
      delete process.env.DEPLOYMENT_MODE;
      delete process.env.EXCLUDE_INTELLME_CLIENT;
      const { intellmeClient } = await import('../services/ingestion/index');
      await expect(intellmeClient.query({ userId: 'u1', query: 'test' })).resolves.toEqual({ results: [] });
    });

    it('sovereign build imports the stub', async () => {
      process.env.EXCLUDE_INTELLME_CLIENT = 'true';
      const { intellmeClient } = await import('../services/ingestion/index');
      await expect(intellmeClient.ingest({ userId: 'u1', documentId: 'd1', content: 'test' })).rejects.toThrow(
        /InTellMe client is disabled/
      );
    });
  });

  describe('InTellMe stub', () => {
    it('ingest throws', async () => {
      const { intellmeClient } = await import('../services/ingestion/intellmeClient.stub');
      expect(() => intellmeClient.ingest({ userId: 'u1', documentId: 'd1', content: 'x' })).toThrow(
        /InTellMe client is disabled.*ingest/
      );
    });

    it('delete throws', async () => {
      const { intellmeClient } = await import('../services/ingestion/intellmeClient.stub');
      expect(() => intellmeClient.delete({ userId: 'u1', documentId: 'd1' })).toThrow(
        /InTellMe client is disabled.*delete/
      );
    });

    it('query throws', async () => {
      const { intellmeClient } = await import('../services/ingestion/intellmeClient.stub');
      expect(() => intellmeClient.query({ userId: 'u1', query: 'test' })).toThrow(
        /InTellMe client is disabled.*query/
      );
    });
  });
});
