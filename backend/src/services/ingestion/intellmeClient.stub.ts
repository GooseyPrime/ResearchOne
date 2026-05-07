/**
 * Stub InTellMe client used in Sovereign builds.
 * All methods throw to surface any accidental call during Sovereign deployment.
 */

export interface InTellMeClient {
  ingest(params: { userId: string; documentId: string; content: string }): Promise<void>;
  delete(params: { userId: string; documentId: string }): Promise<void>;
  query(params: { userId: string; query: string }): Promise<{ results: never[] }>;
}

function throwDisabled(method: string): never {
  throw new Error(
    `InTellMe client is disabled in this deployment (method: ${method}). ` +
    'This call should never have been made in a Sovereign build.'
  );
}

export const intellmeClient: InTellMeClient = {
  ingest: () => throwDisabled('ingest'),
  delete: () => throwDisabled('delete'),
  query: () => throwDisabled('query'),
};
