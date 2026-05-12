import { describe, expect, it } from 'vitest';
import {
  deriveRuntimeDbLoginRoleFromEnv,
  getDatabaseAdminUrlFromEnv,
  resolveRuntimeDatabaseUrl,
} from '../db/applicationRoleBootstrap';

describe('applicationRoleBootstrap', () => {
  describe('deriveRuntimeDbLoginRoleFromEnv', () => {
    it('prefers DATABASE_URL username', () => {
      const env = {
        DATABASE_URL: 'postgresql://app_user:secret@db:5432/researchone',
        DB_USER: 'ignored',
      };
      expect(deriveRuntimeDbLoginRoleFromEnv(env)).toBe('app_user');
    });

    it('rejects DATABASE_URL usernames that decode to invalid SQL identifiers', () => {
      const env = {
        DATABASE_URL: 'postgresql://app%40team:secret@db:5432/researchone',
      };
      expect(() => deriveRuntimeDbLoginRoleFromEnv(env)).toThrow(/not a supported unquoted/);
    });

    it('falls back to DB_USER when DATABASE_URL unset', () => {
      const env = { DB_USER: 'researchone' };
      expect(deriveRuntimeDbLoginRoleFromEnv(env)).toBe('researchone');
    });

    it('throws when neither DATABASE_URL nor DB_USER is usable', () => {
      expect(() => deriveRuntimeDbLoginRoleFromEnv({})).toThrow(/Missing runtime DB login/);
    });
  });

  describe('resolveRuntimeDatabaseUrl', () => {
    it('returns DATABASE_URL when set', () => {
      expect(
        resolveRuntimeDatabaseUrl({
          DATABASE_URL: 'postgresql://u:p@h:5432/db',
        }),
      ).toBe('postgresql://u:p@h:5432/db');
    });

    it('builds URL from DB_* when DATABASE_URL unset', () => {
      const url = resolveRuntimeDatabaseUrl({
        DB_USER: 'researchone',
        DB_PASSWORD: 'p:w',
        DB_HOST: 'h',
        DB_PORT: '5432',
        DB_NAME: 'researchone',
      });
      expect(url).toBe('postgresql://researchone:p%3Aw@h:5432/researchone');
    });
  });

  describe('getDatabaseAdminUrlFromEnv', () => {
    it('returns undefined for empty', () => {
      expect(getDatabaseAdminUrlFromEnv({ DATABASE_ADMIN_URL: '   ' })).toBeUndefined();
    });

    it('returns trimmed URL', () => {
      expect(
        getDatabaseAdminUrlFromEnv({ DATABASE_ADMIN_URL: '  postgresql://a:b@h/db  ' }),
      ).toBe('postgresql://a:b@h/db');
    });
  });
});
