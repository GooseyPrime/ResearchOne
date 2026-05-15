import { describe, it, expect } from 'vitest';
import { parseClassifierPayload, resolvedClass } from '../services/planning/sourceClassClassifier';
import { SOURCE_CLASS_CONFIDENCE_FLOOR } from '../services/planning/sourceClassTypes';

describe('sourceClassClassifier', () => {
  it('parseClassifierPayload extracts items array from model-shaped JSON', () => {
    const raw =
      'Preamble\n{"items":[{"id":"url:https://a.test","source_class":"consensus_held","confidence":0.9},{"id":"x","source_class":"bad_slug","confidence":0.95}]}';
    const rows = parseClassifierPayload(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe('url:https://a.test');
    expect(rows[0]?.source_class).toBe('consensus_held');
    expect(rows[0]?.confidence).toBe(0.9);
  });

  it('parseClassifierPayload returns empty array when JSON missing items', () => {
    expect(parseClassifierPayload('no json here')).toEqual([]);
    expect(parseClassifierPayload('{"foo":[]}')).toEqual([]);
  });

  it('resolvedClass nulls out below-confidence classifications', () => {
    const floor = SOURCE_CLASS_CONFIDENCE_FLOOR;
    expect(resolvedClass({ id: '1', source_class: 'consensus_held', confidence: floor - 0.01 })).toBeNull();
    expect(resolvedClass({ id: '2', source_class: 'consensus_held', confidence: floor })).toBe('consensus_held');
  });

  it('resolvedClass rejects unknown source_class strings', () => {
    expect(resolvedClass({ id: '1', source_class: 'not_a_real_class', confidence: 1 })).toBeNull();
    expect(resolvedClass({ id: '2', source_class: null, confidence: 1 })).toBeNull();
  });
});
