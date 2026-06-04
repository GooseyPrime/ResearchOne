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
      const isNetwork =
        error.code === 'ERR_NETWORK' ||
        error.message === 'Network Error' ||
        error.message.toLowerCase().includes('network');
      if (isNetwork) {
        return `Upload could not reach the server (check your connection). If the file is large, the API proxy may still be limited to about 1 MB until nginx client_max_body_size is updated (app limit is ${INGESTION_MAX_FILE_SIZE_MB} MB per file).`;
      }
      return 'Upload failed before the server accepted the file. Try again or use a smaller file.';
    }
    const apiMsg = extractApiError(error);
    if (apiMsg) return apiMsg;
  }
  return 'Failed to queue file.';
}
