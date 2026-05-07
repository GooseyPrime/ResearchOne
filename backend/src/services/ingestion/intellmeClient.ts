/**
 * Real InTellMe client — HTTPS with signed requests, idempotency, retry.
 *
 * Contract (per rule 14):
 * - POST /ingest: 200=success, 409=already ingested (dedup), 400=bad request (DLQ), 503=retry
 * - DELETE /data/:id: 200=deleted, 404=not found (no-op)
 * - All requests signed with HMAC-SHA256 using INTELLME_API_SECRET
 * - Idempotency via X-Idempotency-Key header (run_id)
 */

import axios from 'axios';
import { createHmac } from 'crypto';
import type { InTellMeClient } from './intellmeClient.stub';
import { logger } from '../../utils/logger';

const INTELLME_BASE_URL = process.env.INTELLME_API_URL ?? 'https://api.intellme.com/v1';
const INTELLME_API_KEY = process.env.INTELLME_API_KEY ?? '';
const INTELLME_API_SECRET = process.env.INTELLME_API_SECRET ?? '';

function signPayload(body: string): string {
  return createHmac('sha256', INTELLME_API_SECRET).update(body).digest('hex');
}

export const intellmeClient: InTellMeClient = {
  async ingest(params) {
    const body = JSON.stringify({
      document_id: params.documentId,
      content: params.content,
      user_id_hash: createHmac('sha256', INTELLME_API_SECRET).update(params.userId).digest('hex'),
    });

    const signature = signPayload(body);

    const response = await axios.post(`${INTELLME_BASE_URL}/ingest`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INTELLME_API_KEY}`,
        'X-Signature': signature,
        'X-Idempotency-Key': params.documentId,
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
    });

    if (response.status === 409) {
      logger.info('intellme_ingest_deduplicated', { documentId: params.documentId });
      return;
    }

    if (response.status >= 400) {
      throw Object.assign(
        new Error(`InTellMe ingest failed: ${response.status}`),
        { status: response.status, documentId: params.documentId }
      );
    }
  },

  async delete(params) {
    const body = JSON.stringify({ document_id: params.documentId });
    const signature = signPayload(body);

    await axios.delete(`${INTELLME_BASE_URL}/data/${encodeURIComponent(params.documentId)}`, {
      headers: {
        'Authorization': `Bearer ${INTELLME_API_KEY}`,
        'X-Signature': signature,
      },
      timeout: 30000,
      validateStatus: (status) => status < 500 || status === 404,
    });
  },

  async query(params) {
    const body = JSON.stringify({
      query: params.query,
      user_id_hash: createHmac('sha256', INTELLME_API_SECRET).update(params.userId).digest('hex'),
    });
    const signature = signPayload(body);

    const response = await axios.post(`${INTELLME_BASE_URL}/query`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INTELLME_API_KEY}`,
        'X-Signature': signature,
      },
      timeout: 30000,
    });

    return { results: response.data?.results ?? [] };
  },
};
