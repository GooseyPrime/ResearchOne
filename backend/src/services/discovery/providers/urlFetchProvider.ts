/**
 * URL fetch provider.
 * Wraps direct URL ingestion as a discovery source.
 * Used when the discovery plan specifies known target URLs to ingest.
 */

import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';

export class UrlFetchProvider implements SearchProvider {
  readonly name = 'url_fetch';

  constructor(private readonly targetUrls: string[]) {}

  async search(_query: SearchQuery): Promise<SearchResultCandidate[]> {
    // Return the pre-specified URLs as candidates with neutral scores
    return this.targetUrls.map((url, idx) => ({
      url,
      title: url,
      snippet: '',
      score: 1.0,
      rank: idx + 1,
      provider: this.name,
      sourceQuery: url,
    }));
  }
}
