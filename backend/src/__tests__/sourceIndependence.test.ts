import { describe, expect, it } from 'vitest';
import {
  countsAgainstIndependence,
  isCitableAsIndependent,
  isIndependentOrigin,
} from '../services/retrieval/sourceIndependence';

/**
 * The corpus gate and the retrieval citability filter used to answer "is this
 * source independent of the requester?" in two different ways, and both were
 * wrong in opposite directions -- first counting every owned source as
 * self-sourced (which sealed healthy partitions), then counting only
 * `researchone_generated` (which let a requester's own uploads be cited back
 * to them as independent evidence). Both are now this module.
 */
describe('sourceIndependence', () => {
  describe('isIndependentOrigin', () => {
    it('accepts only externally discovered material', () => {
      expect(isIndependentOrigin('external_discovery')).toBe(true);
      expect(isIndependentOrigin('user_upload')).toBe(false);
      expect(isIndependentOrigin('user_supplied_url')).toBe(false);
      expect(isIndependentOrigin('researchone_generated')).toBe(false);
      expect(isIndependentOrigin(null)).toBe(false);
    });
  });

  describe('countsAgainstIndependence (corpus gate)', () => {
    it('does not count an externally discovered source, whoever caused the ingest', () => {
      // This is the original defect: an arXiv paper discovery fetched during a
      // signed-in user's run carries their id, and was counted as self-sourced.
      expect(
        countsAgainstIndependence({ sourceOrigin: 'external_discovery', ownerUserId: 'user_1' })
      ).toBe(false);
    });

    it("counts the requester's own uploads and supplied links", () => {
      // Codex, PR #217: a partition of private uploads reported
      // selfSourceShare 0 and unsealed.
      expect(countsAgainstIndependence({ sourceOrigin: 'user_upload', ownerUserId: 'user_1' })).toBe(true);
      expect(
        countsAgainstIndependence({ sourceOrigin: 'user_supplied_url', ownerUserId: 'user_1' })
      ).toBe(true);
    });

    it("counts ResearchOne's own output", () => {
      expect(
        countsAgainstIndependence({ sourceOrigin: 'researchone_generated', ownerUserId: null })
      ).toBe(true);
    });

    it('treats an unclassified source as self-sourced only when someone owns it', () => {
      expect(countsAgainstIndependence({ sourceOrigin: null, ownerUserId: 'user_1' })).toBe(true);
      expect(countsAgainstIndependence({ sourceOrigin: null, ownerUserId: null })).toBe(false);
    });
  });

  describe('isCitableAsIndependent (retrieval)', () => {
    it('cites externally discovered chunks', () => {
      expect(
        isCitableAsIndependent({ source_origin: 'external_discovery', owner_user_id: 'user_1' }, 'user_1')
      ).toBe(true);
    });

    it("never cites the requester's own material as independent evidence", () => {
      // Codex, PR #218: a market or competitor report could present the user's
      // own upload as independent external support.
      expect(
        isCitableAsIndependent({ source_origin: 'user_upload', owner_user_id: 'user_1' }, 'user_1')
      ).toBe(false);
      expect(
        isCitableAsIndependent({ source_origin: 'user_supplied_url', owner_user_id: 'user_1' }, 'user_1')
      ).toBe(false);
      expect(
        isCitableAsIndependent({ source_origin: 'researchone_generated', owner_user_id: null }, 'user_1')
      ).toBe(false);
    });

    it("does not cite another user's upload either -- origin decides, not ownership", () => {
      expect(
        isCitableAsIndependent({ source_origin: 'user_upload', owner_user_id: 'user_2' }, 'user_1')
      ).toBe(false);
    });

    it('excludes an unclassified chunk only from the requester who owns it', () => {
      expect(
        isCitableAsIndependent({ source_origin: null, owner_user_id: 'user_1' }, 'user_1')
      ).toBe(false);
      expect(
        isCitableAsIndependent({ source_origin: null, owner_user_id: 'user_2' }, 'user_1')
      ).toBe(true);
      expect(isCitableAsIndependent({ source_origin: null, owner_user_id: null }, 'user_1')).toBe(true);
    });

    it('keeps unclassified chunks citable for an anonymous request', () => {
      expect(isCitableAsIndependent({ source_origin: null, owner_user_id: 'user_1' }, null)).toBe(true);
    });
  });
});
