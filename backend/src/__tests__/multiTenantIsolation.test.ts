import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Multi-tenant isolation — route-level user_id predicates', () => {
  describe('GET /api/research (list)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../api/routes/research.ts'),
      'utf8'
    );

    it('scoped query includes user_id predicate', () => {
      expect(src).toContain('user_id = $1');
    });

    it('scoped query includes org_id fallback predicate', () => {
      expect(src).toContain('org_id IS NOT NULL AND org_id = $2');
    });

    it('includes NULL grace path so legacy rows remain visible', () => {
      expect(src).toContain('OR user_id IS NULL');
    });

    it('reads userId from req.auth', () => {
      expect(src).toContain("req.auth?.userId");
    });

    it('falls back to unscoped read only on deploy-skew (42703)', () => {
      expect(src).toContain("'42703'");
      expect(src).toContain('legacy_unscoped_read');
    });
  });

  describe('GET /api/reports (list)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../api/routes/reports.ts'),
      'utf8'
    );

    it('scoped query includes user_id predicate via buildWhere', () => {
      expect(src).toContain('r.user_id');
    });

    it('scoped query includes org_id fallback predicate', () => {
      expect(src).toContain('r.org_id IS NOT NULL AND r.org_id');
    });

    it('buildWhere receives scoped=true for the primary query', () => {
      expect(src).toMatch(/buildWhere\(params,\s*true,\s*true\)/);
    });

    it('falls back to unscoped read only on deploy-skew (42703)', () => {
      expect(src).toContain("'42703'");
      expect(src).toContain('legacy_unscoped_read');
    });
  });

  describe('GET /api/ingestion/jobs (list)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../api/routes/ingestion.ts'),
      'utf8'
    );

    it('scoped query includes user_id predicate', () => {
      expect(src).toContain('j.user_id = $1');
    });

    it('reads userId from req.auth', () => {
      expect(src).toContain("req.auth?.userId");
    });

    it('falls back to unscoped read only on deploy-skew (42703)', () => {
      expect(src).toContain("'42703'");
      expect(src).toContain('legacy_unscoped_read');
    });
  });

  describe('GET /api/atlas/exports (list)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../api/routes/atlas.ts'),
      'utf8'
    );

    it('scoped query includes user_id predicate', () => {
      expect(src).toContain('user_id = $1');
    });

    it('reads userId from req.auth', () => {
      expect(src).toContain("req.auth?.userId");
    });

    it('falls back to unscoped read only on deploy-skew (42703)', () => {
      expect(src).toContain("'42703'");
      expect(src).toContain('legacy_unscoped_read');
    });
  });

  describe('DELETE /api/sources/:id — ownership enforcement', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../api/routes/sources.ts'),
      'utf8'
    );

    it('joins research_runs and ingestion_jobs to resolve source owner', () => {
      expect(src).toContain('LEFT JOIN research_runs r ON r.id = s.discovered_by_run_id');
      expect(src).toContain('LEFT JOIN ingestion_jobs ij ON ij.source_id = s.id');
    });

    it('compares resolved owner_user_id against request userId', () => {
      expect(src).toContain("row?.owner_user_id === userId");
    });

    it('returns 403 when the user is not the owner', () => {
      expect(src).toContain('403');
      expect(src).toContain('You can only delete sources you ingested');
    });

    it('admin bypass skips ownership check', () => {
      expect(src).toContain('req.adminAuth');
    });

    it('deploy-skew fallback (42703) also returns 403 rather than 500', () => {
      const deleteHandler = src.slice(src.indexOf("router.delete('/:id'"));
      expect(deleteHandler).toContain("'42703'");
      expect(deleteHandler).toContain('403');
    });
  });
});
