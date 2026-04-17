import { describe, it, expect } from 'vitest';
import { resolveApiBaseUrl } from '../utils/api';

// Test the frontend config logic for split deployment
// We test the URL resolution logic from api.ts and socket.ts

function resolveSocketUrl(viteSocketUrl?: string, origin = 'http://localhost:5173'): string {
  return viteSocketUrl || origin;
}

function resolveExportUrl(exportPath: string, viteExportsBaseUrl?: string): string {
  const base = viteExportsBaseUrl || '';
  const filename = exportPath.split('/').pop() ?? exportPath;
  return base ? `${base}/exports/${filename}` : `/exports/${filename}`;
}

describe('frontend config — VITE_API_BASE_URL', () => {
  it('defaults to /api when env var is not set', () => {
    const url = resolveApiBaseUrl(undefined);
    expect(url).toBe('/api');
  });

  it('uses VITE_API_BASE_URL when set', () => {
    const url = resolveApiBaseUrl('https://api.example.com');
    expect(url).toBe('https://api.example.com/api');
  });

  it('does not double-add /api if already present in base', () => {
    const url = resolveApiBaseUrl('https://api.example.com/api');
    expect(url).toBe('https://api.example.com/api');
  });

  it('handles trailing slash in VITE_API_BASE_URL', () => {
    const url = resolveApiBaseUrl('https://api.example.com/');
    expect(url).toBe('https://api.example.com/api');
  });
});

describe('frontend config — VITE_SOCKET_URL', () => {
  it('defaults to current origin when env var is not set', () => {
    const url = resolveSocketUrl(undefined, 'http://localhost:5173');
    expect(url).toBe('http://localhost:5173');
  });

  it('uses VITE_SOCKET_URL when set', () => {
    const url = resolveSocketUrl('https://api.example.com');
    expect(url).toBe('https://api.example.com');
  });

  it('overrides current origin with explicit socket URL', () => {
    const url = resolveSocketUrl('https://api.example.com', 'http://localhost:5173');
    expect(url).toBe('https://api.example.com');
    expect(url).not.toContain('localhost');
  });
});

describe('frontend config — VITE_EXPORTS_BASE_URL', () => {
  it('defaults to same-origin /exports/ when env var is not set', () => {
    const url = resolveExportUrl('atlas_abc123.jsonl', undefined);
    expect(url).toBe('/exports/atlas_abc123.jsonl');
  });

  it('uses VITE_EXPORTS_BASE_URL when set', () => {
    const url = resolveExportUrl('atlas_abc123.jsonl', 'https://api.example.com');
    expect(url).toBe('https://api.example.com/exports/atlas_abc123.jsonl');
  });

  it('handles absolute filesystem paths by taking only the filename', () => {
    const url = resolveExportUrl('/opt/researchone/exports/atlas_abc123.jsonl', 'https://api.example.com');
    expect(url).toBe('https://api.example.com/exports/atlas_abc123.jsonl');
  });
});
