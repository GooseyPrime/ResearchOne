import { describe, expect, it } from 'vitest';
import { isPostgresRoleDoesNotExist } from '../db/pgRoleErrors';

describe('isPostgresRoleDoesNotExist', () => {
  it('matches standard Postgres message when code is missing', () => {
    const err = Object.assign(new Error('role "application_role" does not exist'), { code: undefined });
    expect(isPostgresRoleDoesNotExist(err, 'application_role')).toBe(true);
  });

  it('matches 42704 when the message names the role', () => {
    const err = Object.assign(new Error('role "application_role" does not exist'), { code: '42704' });
    expect(isPostgresRoleDoesNotExist(err, 'application_role')).toBe(true);
  });

  it('does not match unrelated 42704 errors', () => {
    const err = Object.assign(new Error('type "bogus_enum" does not exist'), { code: '42704' });
    expect(isPostgresRoleDoesNotExist(err, 'application_role')).toBe(false);
  });

  it('does not match a different role name', () => {
    const err = new Error('role "other_role" does not exist');
    expect(isPostgresRoleDoesNotExist(err, 'application_role')).toBe(false);
  });
});
