/** @vitest-environment jsdom */
/**
 * A Markdown or HTML export asks for a file, so a refusal comes back as a
 * file-shaped body. The reader must see the server's reason ("export it in the
 * style it was saved in"), not "Request failed with status code 422".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/utils/api', () => ({ default: { get: mocks.get, post: mocks.post } }));
vi.mock('../utils/api', () => ({ default: { get: mocks.get, post: mocks.post } }));

import ReportExportButton from '../components/reports/ReportExportButton';
import { exportErrorMessage } from '../utils/exportErrorMessage';

const REASON = 'The reference list of this report cannot be rewritten in the apa style. Export it in the style it was saved in (numeric).';
const refusal = () =>
  Object.assign(new Error('Request failed with status code 422'), {
    response: { status: 422, data: new Blob([JSON.stringify({ error: 'validation_error', detail: REASON })], { type: 'application/json' }) },
  });

afterEach(() => {
  cleanup();
  mocks.get.mockReset();
  mocks.post.mockReset();
});

describe('a refused export', () => {
  it('shows the reason the server gave for a Markdown export', async () => {
    mocks.get.mockResolvedValue({ data: { available: true } });
    mocks.post.mockRejectedValue(refusal());
    render(<ReportExportButton reportId="11111111-1111-4111-8111-111111111111" />);
    await waitFor(() => expect((screen.getByLabelText('Export this report') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByLabelText('Export this report'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'md' } });
    const buttons = screen.getAllByRole('button', { name: /Export/ });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(screen.getByText(REASON)).toBeTruthy());
    expect(screen.queryByText(/status code 422/)).toBeNull();
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ format: 'md', sync: true });
  });

  it('reads the reason from a file-shaped or a plain body, and falls back to the status message', async () => {
    expect(await exportErrorMessage(refusal())).toBe(REASON);
    expect(await exportErrorMessage({ message: 'x', response: { data: { error: 'timeout' } } })).toBe('timeout');
    expect(await exportErrorMessage(Object.assign(new Error('Network Error'), { response: { data: new Blob(['<html>'], { type: 'text/html' }) } }))).toBe('Network Error');
    expect(await exportErrorMessage(new Error('Network Error'))).toBe('Network Error');
  });
});
