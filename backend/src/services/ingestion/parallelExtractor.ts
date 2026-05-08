import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface ParallelExtractResult {
  html: string;
  text: string;
  canonical_url: string;
  title: string;
  fetch_method: string;
  original_mime_type: string;
}

interface ParallelExtractResponse {
  html?: string;
  text?: string;
  canonical_url?: string;
  url?: string;
  title?: string;
  fetch_method?: string;
  original_mime_type?: string;
  mime_type?: string;
}

/**
 * Extract page content via Parallel's extraction API.
 * THROWS on error — the caller is expected to fall through to a default fetcher.
 */
export async function extractWithParallel(url: string): Promise<ParallelExtractResult> {
  const apiKey = config.discovery.parallelApiKey;
  if (!apiKey) {
    throw new Error('PARALLEL_API_KEY is not configured');
  }

  const baseUrl = config.discovery.parallelBaseUrl;

  logger.debug(`[parallel-extract] Extracting: ${url}`);

  const response = await axios.post<ParallelExtractResponse>(
    `${baseUrl}/extract`,
    { url },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
    },
  );

  const data = response.data;

  return {
    html: data.html ?? '',
    text: data.text ?? '',
    canonical_url: data.canonical_url ?? data.url ?? url,
    title: data.title ?? '',
    fetch_method: data.fetch_method ?? 'parallel',
    original_mime_type: data.original_mime_type ?? data.mime_type ?? 'text/html',
  };
}
