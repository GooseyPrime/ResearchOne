import axios from 'axios';
import { extractApiError, INGESTION_MAX_FILE_SIZE_MB } from './api';

/**
 * User-visible message for POST /ingestion/file failures.
 * Nginx 413 responses omit CORS headers, so browsers often surface a generic
 * network/CORS error for oversized uploads — detect that pattern here.
 */
export function ingestFileUploadErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 413) {
      const data = error.response.data as Record<string, unknown> | undefined;
      const bodyMessage = typeof data?.message === 'string' ? data.message : '';
      if (bodyMessage) return bodyMessage;
      return `File is too large (maximum ${INGESTION_MAX_FILE_SIZE_MB} MB).`;
    }
    if (!error.response && error.request) {
      return `Upload failed before the server accepted the file. Files over about 1 MB may be blocked by the API proxy until nginx client_max_body_size is raised (limit is ${INGESTION_MAX_FILE_SIZE_MB} MB per file).`;
    }
    const apiMsg = extractApiError(error);
    if (apiMsg) return apiMsg;
  }
  return 'Failed to queue file.';
}
