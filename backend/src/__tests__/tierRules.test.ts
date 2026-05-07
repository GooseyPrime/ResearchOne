import { describe, expect, it } from 'vitest';
import { TIER_RULES, type TierName, isTierName } from '../config/tierRules';

const ALL_TIERS: TierName[] = [
  'anonymous', 'free_demo', 'student', 'wallet', 'pro', 'team', 'byok', 'sovereign', 'admin',
];

describe('TIER_RULES', () => {
  it('defines rules for all 9 tiers', () => {
    expect(Object.keys(TIER_RULES)).toHaveLength(9);
    for (const tier of ALL_TIERS) {
      expect(TIER_RULES[tier]).toBeDefined();
    }
  });

  describe('anonymous', () => {
    const rules = TIER_RULES.anonymous;
    it('has no allowed objectives', () => {
      expect(rules.allowedObjectives).toEqual([]);
    });
    it('has lifetime cap of 0', () => {
      expect(rules.lifetimeReportCap).toBe(0);
    });
    it('has no feature flags', () => {
      expect(rules.parallelSearch).toBe(false);
      expect(rules.parallelExtract).toBe(false);
      expect(rules.smartCitations).toBe(false);
    });
  });

  describe('free_demo', () => {
    const rules = TIER_RULES.free_demo;
    it('allows only GENERAL_EPISTEMIC_RESEARCH', () => {
      expect(rules.allowedObjectives).toEqual(['GENERAL_EPISTEMIC_RESEARCH']);
    });
    it('denies INVESTIGATIVE_SYNTHESIS', () => {
      expect(rules.allowedObjectives).not.toContain('INVESTIGATIVE_SYNTHESIS');
    });
    it('has lifetime cap of 3', () => {
      expect(rules.lifetimeReportCap).toBe(3);
    });
    it('has no wallet fallback', () => {
      expect(rules.walletFallbackEnabled).toBe(false);
    });
    it('only allows markdown export', () => {
      expect(rules.exportFormats).toEqual(['markdown']);
    });
  });

  describe('student', () => {
    const rules = TIER_RULES.student;
    it('allows GENERAL and INVESTIGATIVE', () => {
      expect(rules.allowedObjectives).toContain('GENERAL_EPISTEMIC_RESEARCH');
      expect(rules.allowedObjectives).toContain('INVESTIGATIVE_SYNTHESIS');
    });
    it('denies PATENT_GAP_ANALYSIS', () => {
      expect(rules.allowedObjectives).not.toContain('PATENT_GAP_ANALYSIS');
    });
    it('has monthly cap of 10', () => {
      expect(rules.monthlyReportCap).toBe(10);
    });
    it('has wallet fallback', () => {
      expect(rules.walletFallbackEnabled).toBe(true);
    });
  });

  describe('wallet', () => {
    const rules = TIER_RULES.wallet;
    it('allows GENERAL and INVESTIGATIVE', () => {
      expect(rules.allowedObjectives).toContain('GENERAL_EPISTEMIC_RESEARCH');
      expect(rules.allowedObjectives).toContain('INVESTIGATIVE_SYNTHESIS');
    });
    it('has no monthly cap', () => {
      expect(rules.monthlyReportCap).toBeNull();
    });
    it('has wallet fallback', () => {
      expect(rules.walletFallbackEnabled).toBe(true);
    });
  });

  describe('pro', () => {
    const rules = TIER_RULES.pro;
    it('allows all objectives', () => {
      expect(rules.allowedObjectives).toHaveLength(5);
      expect(rules.allowedObjectives).toContain('GENERAL_EPISTEMIC_RESEARCH');
      expect(rules.allowedObjectives).toContain('INVESTIGATIVE_SYNTHESIS');
      expect(rules.allowedObjectives).toContain('PATENT_GAP_ANALYSIS');
      expect(rules.allowedObjectives).toContain('ANOMALY_CORRELATION');
    });
    it('has monthly cap of 25', () => {
      expect(rules.monthlyReportCap).toBe(25);
    });
    it('has wallet fallback', () => {
      expect(rules.walletFallbackEnabled).toBe(true);
    });
    it('allows pdf and docx export', () => {
      expect(rules.exportFormats).toContain('pdf');
      expect(rules.exportFormats).toContain('docx');
    });
    it('has parallel features', () => {
      expect(rules.parallelSearch).toBe(true);
      expect(rules.parallelExtract).toBe(true);
    });
  });

  describe('team', () => {
    const rules = TIER_RULES.team;
    it('allows all objectives', () => {
      expect(rules.allowedObjectives).toHaveLength(5);
    });
    it('has monthly cap of 100', () => {
      expect(rules.monthlyReportCap).toBe(100);
    });
    it('includes living reports', () => {
      expect(rules.livingReportsIncluded).toBe(true);
    });
  });

  describe('byok', () => {
    const rules = TIER_RULES.byok;
    it('allows all objectives', () => {
      expect(rules.allowedObjectives).toHaveLength(5);
    });
    it('has no monthly cap', () => {
      expect(rules.monthlyReportCap).toBeNull();
    });
    it('has no wallet fallback', () => {
      expect(rules.walletFallbackEnabled).toBe(false);
    });
  });

  describe('sovereign', () => {
    const rules = TIER_RULES.sovereign;
    it('allows all objectives', () => {
      expect(rules.allowedObjectives).toHaveLength(5);
    });
    it('has no caps', () => {
      expect(rules.lifetimeReportCap).toBeNull();
      expect(rules.monthlyReportCap).toBeNull();
    });
    it('includes all premium features', () => {
      expect(rules.livingReportsIncluded).toBe(true);
      expect(rules.adversarialTwinIncluded).toBe(true);
      expect(rules.provenanceLedgerIncluded).toBe(true);
    });
    it('allows json export', () => {
      expect(rules.exportFormats).toContain('json');
    });
  });

  describe('admin', () => {
    const rules = TIER_RULES.admin;
    it('allows all objectives', () => {
      expect(rules.allowedObjectives).toHaveLength(5);
    });
    it('has no caps', () => {
      expect(rules.lifetimeReportCap).toBeNull();
      expect(rules.monthlyReportCap).toBeNull();
    });
    it('includes all premium features', () => {
      expect(rules.livingReportsIncluded).toBe(true);
      expect(rules.adversarialTwinIncluded).toBe(true);
      expect(rules.provenanceLedgerIncluded).toBe(true);
    });
  });

  describe('isTierName', () => {
    it('returns true for valid tier names', () => {
      for (const tier of ALL_TIERS) {
        expect(isTierName(tier)).toBe(true);
      }
    });

    it('returns false for invalid tier names', () => {
      expect(isTierName('invalid')).toBe(false);
      expect(isTierName('')).toBe(false);
      expect(isTierName('ADMIN')).toBe(false);
    });
  });
});
