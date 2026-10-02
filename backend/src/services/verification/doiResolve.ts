export interface DoiResolution {
  status: 'resolved' | 'unresolved';
  editorialNotice: string | null;
}

export async function resolveDoi(
  doi: string,
  request: (url: string, method: 'HEAD' | 'GET') => Promise<{ status: number; notice?: string | null }> = defaultRequest
): Promise<DoiResolution> {
  const url = `https://doi.org/${doi}`;
  let response = await request(url, 'HEAD');
  if (response.status === 403 || response.status === 405) response = await request(url, 'GET');
  if (response.status === 404 || response.status === 0) return { status: 'unresolved', editorialNotice: null };
  return { status: 'resolved', editorialNotice: response.notice ?? null };
}

async function defaultRequest(url: string, method: 'HEAD' | 'GET'): Promise<{ status: number; notice?: string | null }> {
  const response = await fetch(url, {
    method,
    headers: { 'user-agent': 'ResearchOne/1.0 (mailto:brandon@intellmeai.com)' },
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status };
}

export function retractionAllowsCitation(sentence: string, notice: string | null): boolean {
  if (!notice || !/retract/i.test(notice)) return true;
  return /retract/i.test(sentence);
}
