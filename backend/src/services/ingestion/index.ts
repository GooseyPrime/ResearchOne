import { EXCLUDE_INTELLME_CLIENT } from '../../config/deployment';
import type { InTellMeClient } from './intellmeClient.stub';

let _client: InTellMeClient | null = null;

async function getClient(): Promise<InTellMeClient> {
  if (!_client) {
    if (EXCLUDE_INTELLME_CLIENT) {
      const mod = await import('./intellmeClient.stub');
      _client = mod.intellmeClient;
    } else {
      const mod = await import('./intellmeClient');
      _client = mod.intellmeClient;
    }
  }
  return _client;
}

export type { InTellMeClient } from './intellmeClient.stub';

export const intellmeClient: InTellMeClient = {
  ingest: async (params) => (await getClient()).ingest(params),
  delete: async (params) => (await getClient()).delete(params),
  query: async (params) => (await getClient()).query(params),
};
