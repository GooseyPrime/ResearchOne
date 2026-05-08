import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface CTStudy {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
      officialTitle?: string;
    };
    descriptionModule?: {
      briefSummary?: string;
    };
    statusModule?: {
      overallStatus?: string;
    };
  };
}

interface CTResponse {
  studies?: CTStudy[];
  totalCount?: number;
}

export class ClinicalTrialsSearchProvider implements SearchProvider {
  readonly name = 'clinicaltrials';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const maxResults = query.maxResults ?? config.discovery.maxResults;

    try {
      const response = await axios.get<CTResponse>(
        'https://clinicaltrials.gov/api/v2/studies',
        {
          params: {
            'query.term': query.text,
            pageSize: maxResults,
            format: 'json',
          },
          timeout: 15000,
        },
      );

      const studies = response.data.studies ?? [];
      return studies
        .map((study, idx) => {
          const idMod = study.protocolSection?.identificationModule;
          const descMod = study.protocolSection?.descriptionModule;
          const statusMod = study.protocolSection?.statusModule;
          const nctId = idMod?.nctId;
          if (!nctId) return null;

          const url = `https://clinicaltrials.gov/study/${nctId}`;
          const title = idMod?.briefTitle ?? idMod?.officialTitle ?? nctId;
          const status = statusMod?.overallStatus ? `[${statusMod.overallStatus}] ` : '';
          const summary = descMod?.briefSummary ?? '';
          const snippet = `${status}${summary}`.slice(0, 500);

          return {
            url,
            title,
            snippet,
            score: Math.max(0, 1 - idx / Math.max(1, studies.length)),
            rank: idx + 1,
            provider: this.name,
            sourceQuery: query.text,
            contentHash: nctId,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    } catch (err) {
      logger.warn('[discovery] ClinicalTrials.gov search failed:', err);
      return [];
    }
  }
}
