/**
 * Real InTellMe client — implementation deferred to Work Order L.
 * This file provides the type-compatible placeholder that the conditional
 * import in index.ts resolves for B2C builds.
 */

import type { InTellMeClient } from './intellmeClient.stub';

export const intellmeClient: InTellMeClient = {
  ingest: async (_params) => {
    // WO L: implement real InTellMe ingestion pipeline
  },
  delete: async (_params) => {
    // WO L: implement real InTellMe deletion
  },
  query: async (_params) => {
    // WO L: implement real InTellMe query
    return { results: [] };
  },
};
