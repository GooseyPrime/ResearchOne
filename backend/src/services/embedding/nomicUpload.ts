import axios from 'axios';
import fs from 'fs';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export async function uploadAtlasJsonlToNomic(args: {
  exportPath: string;
  datasetSlug?: string;
}): Promise<{ uploaded: number; datasetSlug: string; datasetUrl: string }> {
  const apiKey = config.nomic.apiKey.trim();
  if (!apiKey) {
    throw new Error('NOMIC_API_KEY missing');
  }

  const datasetSlug = (args.datasetSlug || config.nomic.atlasDatasetSlug).trim() || 'intellme';
  const baseUrl = config.nomic.atlasBaseUrl.replace(/\/+$/, '');

  if (!fs.existsSync(args.exportPath)) {
    throw new Error(`Atlas export file not found: ${args.exportPath}`);
  }

  const payloadJsonl = fs.readFileSync(args.exportPath, 'utf8');

  try {
    await axios.post(
      `${baseUrl}/v1/data/${encodeURIComponent(datasetSlug)}/append`,
      {
        source: 'ResearchOne',
        export_path: args.exportPath,
        payload_jsonl: payloadJsonl,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 180000,
      }
    );

    const uploaded = payloadJsonl
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean).length;

    return {
      uploaded,
      datasetSlug,
      datasetUrl: `https://atlas.nomic.ai/data/${datasetSlug}`,
    };
  } catch (err) {
    logger.warn('Nomic Atlas upload failed', err);
    throw err instanceof Error ? err : new Error('Nomic upload failed');
  }
}
