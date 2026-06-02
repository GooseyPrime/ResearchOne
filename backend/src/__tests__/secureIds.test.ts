import { describe, expect, it } from 'vitest';
import { isEntityUuid, newEntityUuid } from '../utils/secureIds';

describe('secureIds', () => {
  it('newEntityUuid returns RFC 4122 v4 shape', () => {
    const id = newEntityUuid();
    expect(isEntityUuid(id)).toBe(true);
  });

  it('generates distinct ids', () => {
    const a = newEntityUuid();
    const b = newEntityUuid();
    expect(a).not.toBe(b);
  });
});
