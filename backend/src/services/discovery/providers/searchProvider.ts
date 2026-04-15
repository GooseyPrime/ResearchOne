/**
 * Search provider interface.
 * All discovery adapters must implement this interface.
 * Do not hardwire business logic to any single provider.
 */

import { SearchQuery, SearchResultCandidate } from '../providerTypes';

export interface SearchProvider {
  readonly name: string;
  search(query: SearchQuery): Promise<SearchResultCandidate[]>;
}
