import { describe, it, expect } from 'vitest';
import { CORPUS_CLEAR_CONFIRM_PHRASE } from '../constants/corpusAdmin';

describe('admin corpus API contract', () => {
  it('exposes a fixed confirmation phrase for corpus clear', () => {
    expect(CORPUS_CLEAR_CONFIRM_PHRASE).toBe('DELETE ALL CORPUS DATA');
  });
});
