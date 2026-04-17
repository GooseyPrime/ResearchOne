import { describe, it, expect } from 'vitest';
import { assertSplitDeploymentEnv } from './splitDeployment';

describe('assertSplitDeploymentEnv', () => {
  it('does nothing when not production', () => {
    expect(() =>
      assertSplitDeploymentEnv({
        PROD: false,
        VITE_API_BASE_URL: '',
        VITE_SOCKET_URL: '',
      })
    ).not.toThrow();
  });

  it('throws when production and VITE_API_BASE_URL is missing', () => {
    expect(() =>
      assertSplitDeploymentEnv({
        PROD: true,
        VITE_API_BASE_URL: '',
        VITE_SOCKET_URL: 'https://api.example.com',
      })
    ).toThrow(/VITE_API_BASE_URL/);
  });

  it('throws when production and VITE_SOCKET_URL is missing', () => {
    expect(() =>
      assertSplitDeploymentEnv({
        PROD: true,
        VITE_API_BASE_URL: 'https://api.example.com',
        VITE_SOCKET_URL: '  ',
      })
    ).toThrow(/VITE_SOCKET_URL/);
  });

  it('throws listing both when both are missing', () => {
    expect(() =>
      assertSplitDeploymentEnv({
        PROD: true,
        VITE_API_BASE_URL: '',
        VITE_SOCKET_URL: '',
      })
    ).toThrow(/VITE_API_BASE_URL/);
    expect(() =>
      assertSplitDeploymentEnv({
        PROD: true,
        VITE_API_BASE_URL: '',
        VITE_SOCKET_URL: '',
      })
    ).toThrow(/VITE_SOCKET_URL/);
  });

  it('does not throw when production and both vars are set', () => {
    expect(() =>
      assertSplitDeploymentEnv({
        PROD: true,
        VITE_API_BASE_URL: 'https://api.example.com',
        VITE_SOCKET_URL: 'https://api.example.com',
      })
    ).not.toThrow();
  });
});
