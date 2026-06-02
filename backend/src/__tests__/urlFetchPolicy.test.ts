import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, UrlFetchPolicyError } from '../services/ingestion/urlFetchPolicy';

describe('assertPublicHttpUrl', () => {
  it('allows public https URLs', () => {
    expect(assertPublicHttpUrl('https://example.com/page').hostname).toBe('example.com');
  });

  it('blocks localhost', () => {
    expect(() => assertPublicHttpUrl('http://localhost/admin')).toThrow(UrlFetchPolicyError);
  });

  it('blocks loopback IP', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/')).toThrow(UrlFetchPolicyError);
  });

  it('blocks RFC1918', () => {
    expect(() => assertPublicHttpUrl('http://10.0.0.1/')).toThrow(UrlFetchPolicyError);
    expect(() => assertPublicHttpUrl('http://192.168.1.1/')).toThrow(UrlFetchPolicyError);
    expect(() => assertPublicHttpUrl('http://172.16.0.1/')).toThrow(UrlFetchPolicyError);
  });

  it('blocks link-local metadata', () => {
    expect(() => assertPublicHttpUrl('http://169.254.169.254/')).toThrow(UrlFetchPolicyError);
  });

  it('blocks non-http schemes', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(UrlFetchPolicyError);
  });
});
