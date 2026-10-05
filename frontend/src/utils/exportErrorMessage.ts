/**
 * Why an export failed, in the server's words when it gave any. A request made
 * for a file answers a refusal with a file-shaped body too, so the reason has
 * to be read out of it; without this the reader saw only a status code.
 */
/** The text of a file-shaped body, in browsers with and without `Blob.text`. */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsText(blob);
  });
}

export async function exportErrorMessage(err: unknown): Promise<string> {
  const fallback = err instanceof Error ? err.message : String(err);
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  try {
    const body: unknown = data instanceof Blob ? JSON.parse(await blobText(data)) : data;
    if (body && typeof body === 'object') {
      const { detail, error } = body as { detail?: unknown; error?: unknown };
      if (typeof detail === 'string' && detail.trim()) return detail;
      if (typeof error === 'string' && error.trim()) return error;
    }
  } catch {
    // Not a readable reason: the status message stands.
  }
  return fallback;
}
