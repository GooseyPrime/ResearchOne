import { useAuth } from '@clerk/react';

export function useAuthedFetch() {
  const { getToken } = useAuth();

  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = await getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}
