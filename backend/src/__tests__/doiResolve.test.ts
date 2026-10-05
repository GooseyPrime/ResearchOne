import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { resolveDois, fetchCrossrefMetadata, doiResolveEnabled } from '../services/verification/doiResolve';

// Mock axios to avoid actual network calls
vi.mock('axios');

describe('doiResolve', () => {
  beforeEach(() => {
    // Enable DOI resolution for tests
    process.env.DOI_RESOLVE_ENABLED = 'true';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DOI_RESOLVE_ENABLED;
  });

  describe('doiResolveEnabled', () => {
    it('returns true when DOI_RESOLVE_ENABLED is true', () => {
      process.env.DOI_RESOLVE_ENABLED = 'true';
      expect(doiResolveEnabled()).toBe(true);
    });

    it('returns false when DOI_RESOLVE_ENABLED is not set', () => {
      delete process.env.DOI_RESOLVE_ENABLED;
      expect(doiResolveEnabled()).toBe(false);
    });

    it('returns false when DOI_RESOLVE_ENABLED is false', () => {
      process.env.DOI_RESOLVE_ENABLED = 'false';
      expect(doiResolveEnabled()).toBe(false);
    });
  });

  describe('resolveDois', () => {
    it('returns unknown status when disabled', async () => {
      process.env.DOI_RESOLVE_ENABLED = 'false';
      const dois = ['10.1000/test'];
      const results = await resolveDois(dois);
      
      expect(results).toEqual([
        { doi: '10.1000/test', resolveStatus: 'unknown' }
      ]);
    });

    it('handles empty input', async () => {
      const results = await resolveDois([]);
      expect(results).toEqual([]);
    });

    it('passes 200 status as resolved', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.head.mockResolvedValue({ status: 200, request: { res: { responseUrl: 'https://doi.org/10.1000/test' } } });

      const results = await resolveDois(['10.1000/test']);
      
      expect(results[0].resolveStatus).toBe('resolved');
      expect(results[0].doi).toBe('10.1000/test');
    });

    it('handles 404 as unresolved', async () => {
      const mockAxios = vi.mocked(axios);
      // Mock HEAD to fail with 404 - this should return immediately with DOI not found
      const axiosError404 = {
        response: { status: 404 },
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Request failed with status code 404',
        config: {},
        code: 'ERR_BAD_REQUEST'
      };
      mockAxios.head.mockRejectedValue(axiosError404);

      const results = await resolveDois(['10.1000/test']);
      
      expect(results[0].resolveStatus).toBe('unresolved');
      expect(results[0].editorialNotice).toContain('DOI not found');
    });

    it('falls back to GET when HEAD returns 403', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.head.mockRejectedValue({
        response: { status: 403 },
        isAxiosError: true,
      });
      mockAxios.get.mockResolvedValue({ status: 200, request: { res: { responseUrl: 'https://doi.org/10.1000/test' } } });

      const results = await resolveDois(['10.1000/test']);
      
      expect(results[0].resolveStatus).toBe('resolved');
    });

    it('falls back to GET when HEAD returns 405', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.head.mockRejectedValue({
        response: { status: 405 },
        isAxiosError: true,
      });
      mockAxios.get.mockResolvedValue({ status: 200, request: { res: { responseUrl: 'https://doi.org/10.1000/test' } } });

      const results = await resolveDois(['10.1000/test']);
      
      expect(results[0].resolveStatus).toBe('resolved');
    });

    it('handles timeout/network errors as unresolved', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.head.mockRejectedValue(new Error('Network error'));
      mockAxios.get.mockRejectedValue(new Error('Network error'));

      const results = await resolveDois(['10.1000/test']);
      
      expect(results[0].resolveStatus).toBe('unresolved');
      expect(results[0].editorialNotice).toBe('Network error during DOI resolution');
    });

    it('detects retracted papers from URL', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.head.mockResolvedValue({ status: 200, request: { res: { responseUrl: 'https://doi.org/10.1000/retraction' } } });

      const results = await resolveDois(['10.1000/retraction']);
      
      expect(results[0].resolveStatus).toBe('retracted');
      expect(results[0].editorialNotice).toBe('Source has been retracted');
    });
  });

  describe('fetchCrossrefMetadata', () => {
    it('returns defaults when disabled', async () => {
      process.env.DOI_RESOLVE_ENABLED = 'false';
      const result = await fetchCrossrefMetadata('10.1000/test');
      
      expect(result).toEqual({
        retracted: false,
        corrected: false,
        withdrawn: false,
      });
    });

    it('fetches Crossref metadata for DOI', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.get.mockResolvedValue({
        data: {
          message: {
            status: 'updated',
            'update-to': [
              { type: 'retraction', label: 'Retraction notice' }
            ]
          }
        }
      });

      const result = await fetchCrossrefMetadata('10.1000/test');
      
      expect(result.retracted).toBe(true);
      expect(result.retractionNotice).toBe('Retraction notice');
    });

    it('handles Crossref API errors gracefully', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.get.mockRejectedValue(new Error('API error'));

      const result = await fetchCrossrefMetadata('10.1000/test');
      
      expect(result).toEqual({
        retracted: false,
        corrected: false,
        withdrawn: false,
      });
    });
  });
});