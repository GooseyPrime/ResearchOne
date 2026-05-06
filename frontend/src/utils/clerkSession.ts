/** Bridges Clerk session tokens into non-React modules (e.g. Axios). Registered from inside ClerkProvider. */
let getToken: (() => Promise<string | null>) | null = null;

export function registerClerkTokenGetter(fn: () => Promise<string | null>): void {
  getToken = fn;
}

export async function getClerkJwtForApi(): Promise<string | null> {
  if (!getToken) return null;
  try {
    const tok = await getToken();
    return tok ?? null;
  } catch {
    return null;
  }
}
