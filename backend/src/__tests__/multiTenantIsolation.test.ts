import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Multi-tenant isolation — route-level user_id predicates', () => {
  describe('GET /api/research (list)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../api/routes/research.ts'),
      'utf8'
    );

    it('scoped query uses appendOwnershipFilter', () => {
      expect(src).toContain('appendOwnershipFilter');
    });

    it('does not expose legacy NULL rows in authenticated list SQL', () => {
      const listHandler = src.slice(src.indexOf('// GET /api/research - List'), src.indexOf('// GET /api/research/:id'));
      expect(listHandler).not.toContain('OR user_id IS NULL');
    });

    it('reads userId from req.auth', () => {
      expect(src).toContain("req.auth?.userId");
    });

    it('fails closed on deploy-skew (42703) instead of unscoped read', () => {
      expect(src).toContain('rejectUnscopedReadOnScopeError');
      expect(src).not.toContain('legacy_unscoped_read');
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

    it('scoped query uses buildOwnershipSql for org sharing', () => {
      expect(src).toContain('buildOwnershipSql');
    });

    it('buildWhere receives scoped=true for the primary query', () => {
      expect(src).toMatch(/buildWhere\(params,\s*true,\s*true\)/);
    });

    it('fails closed on deploy-skew (42703) instead of unscoped read', () => {
      expect(src).toContain('rejectUnscopedReadOnScopeError');
      expect(src).not.toContain('legacy_unscoped_read');
    });
  });

  describe('GET /api/ingestion/jobs (list)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../api/routes/ingestion.ts'),
      'utf8'
    );

    it('scoped query includes user_id predicate', () => {
      expect(src).toContain('buildUserOnlyOwnershipSql');
    });

    it('reads userId from req.auth', () => {
      expect(src).toContain("req.auth?.userId");
    });

    it('fails closed on deploy-skew (42703) instead of unscoped read', () => {
      expect(src).toContain('rejectUnscopedReadOnScopeError');
      expect(src).not.toContain('legacy_unscoped_read');
    });
  });

  describe('GET /api/atlas/exports (list)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../api/routes/atlas.ts'),
      'utf8'
    );

    it('scoped query includes user_id predicate', () => {
      expect(src).toContain('buildUserOnlyOwnershipSql');
    });

    it('reads userId from req.auth', () => {
      expect(src).toContain("req.auth?.userId");
    });

    it('fails closed on deploy-skew (42703) instead of unscoped read', () => {
      expect(src).toContain('rejectUnscopedReadOnScopeError');
      expect(src).not.toContain('legacy_unscoped_read');
    });
  });

  describe('dossier reads (v_dossier)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/research/dossierReadService.ts'),
      'utf8'
    );

    it('filters list/detail by ownership via tenantScope helpers', () => {
      expect(src).toContain('appendOwnershipFilter');
      expect(src).toContain('buildOwnershipSql');
    });

    it('does not include OR user_id IS NULL in dossier SQL', () => {
      expect(src).not.toContain('OR user_id IS NULL');
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

    it('admin bypass skips ownership check via admin userId list', () => {
      expect(src).toContain('config.admin.userIds.includes(userId)');
    });

    it('deploy-skew fallback (42703) also returns 403 rather than 500', () => {
      const deleteHandler = src.slice(src.indexOf("router.delete('/:id'"));
      expect(deleteHandler).toContain("'42703'");
      expect(deleteHandler).toContain('403');
    });
  });
});
