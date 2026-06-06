import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { ingestFileUploadErrorMessage } from './ingestUploadError';

describe('ingestFileUploadErrorMessage', () => {
  it('names nginx/proxy body limit when the browser sees a network error with no response', () => {
    const err = new axios.AxiosError('Network Error', 'ERR_NETWORK', undefined, {}, undefined);
    expect(ingestFileUploadErrorMessage(err)).toContain('1 MB');
  });

  it('uses API 413 message when present', () => {
    const err = new axios.AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 413,
      statusText: 'Payload Too Large',
      headers: {},
      config: {} as never,
      data: { error: 'payload_too_large', message: 'File exceeds the 50 MB upload limit.' },
    });
    expect(ingestFileUploadErrorMessage(err)).toBe('File exceeds the 50 MB upload limit.');
  });
});
