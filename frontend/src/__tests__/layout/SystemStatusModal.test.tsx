/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SystemHealth } from '../../utils/api';
import SystemStatusModal from '../../components/layout/SystemStatusModal';

vi.mock('../../utils/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRuntimeLogs: vi.fn(),
}));

const health: SystemHealth = {
  status: 'ok',
  timestamp: '2026-08-26T22:00:00.000Z',
  restartAvailable: true,
  checks: {
    api: { ok: true, latencyMs: 3 },
    db: { ok: true, latencyMs: 7 },
    redis: { ok: true, latencyMs: 2 },
    queue: { ok: true, latencyMs: 4 },
    openrouter: { ok: true, latencyMs: 18, modelProbe: 'private-model-name' },
    discovery: { ok: true, provider: 'private-provider', ready: true },
    exports: { ok: true, writable: true },
    websocket: { ok: true },
  },
};

function mount(isAllowlistedAdmin: boolean) {
  render(
    <SystemStatusModal
      open
      onClose={vi.fn()}
      health={health}
      healthLoading={false}
      healthError={null}
      onRefreshHealth={vi.fn()}
      onRestart={vi.fn()}
      restartBusy={false}
      isAllowlistedAdmin={isAllowlistedAdmin}
    />,
  );
}

afterEach(cleanup);

describe('SystemStatusModal permissions', () => {
  it('shows ordinary users only basic operational status', () => {
    mount(false);

    expect(screen.getByText('All systems operational')).toBeInTheDocument();
    expect(screen.queryByText('Health checks')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime logs')).not.toBeInTheDocument();
    expect(screen.queryByText('private-model-name')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ADMIN_RUNTIME_TOKEN/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restart runtime/i })).not.toBeInTheDocument();
  });

  it('keeps technical checks and runtime controls available to allowlisted admins', () => {
    mount(true);

    expect(screen.getByText('Health checks')).toBeInTheDocument();
    expect(screen.getByText('Runtime logs')).toBeInTheDocument();
    expect(screen.getByText(/private-model-name/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restart runtime/i })).toBeInTheDocument();
  });
});
