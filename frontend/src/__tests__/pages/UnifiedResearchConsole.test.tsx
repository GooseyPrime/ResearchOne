/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import UnifiedResearchConsole from '../../pages/UnifiedResearchConsole';

vi.mock('../../hooks/useCanAccessDeepResearch', () => ({
  useCanAccessDeepResearch: () => ({ canAccessDeep: true, tierGateUnknown: false }),
}));

vi.mock('../../pages/ResearchEasyPage', () => ({
  default: () => <div data-testid="easy-page">Easy page</div>,
}));

vi.mock('../../pages/ResearchStandardPage', () => ({
  default: () => <div data-testid="standard-page">Standard page</div>,
}));

vi.mock('../../pages/ResearchDeepPage', () => ({
  default: () => <div data-testid="deep-page">Deep page</div>,
}));

vi.mock('../../components/research/ResearchEngineModeToggle', () => ({
  default: ({ onModeChange }: { onModeChange: (next: 'standard' | 'deep') => void }) => (
    <button type="button" data-testid="mode-toggle" onClick={() => onModeChange('deep')}>
      Mode toggle
    </button>
  ),
}));

vi.mock('../../components/research/DeepResearchUpgradeModal', () => ({
  default: () => <div data-testid="upgrade-modal">Upgrade modal</div>,
}));

afterEach(() => {
  cleanup();
});

describe('UnifiedResearchConsole', () => {
  it('defaults to EZ Research', () => {
    render(
      <MemoryRouter>
        <UnifiedResearchConsole
          initialMode="standard"
          onModeChange={vi.fn()}
          syncEngineForRun={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('easy-page')).toBeTruthy();
    expect(screen.queryByTestId('standard-page')).toBeNull();
    expect(screen.queryByTestId('mode-toggle')).toBeNull();
  });

  it('opens Research Lab tab and keeps mode switching active', () => {
    const onModeChange = vi.fn();
    render(
      <MemoryRouter>
        <UnifiedResearchConsole
          initialMode="standard"
          onModeChange={onModeChange}
          syncEngineForRun={vi.fn()}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Research Lab' }));
    expect(screen.getByTestId('standard-page')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(onModeChange).toHaveBeenCalledWith('deep');
    expect(screen.getByTestId('deep-page')).toBeTruthy();
  });

  it('starts on Research Lab when deep mode is preselected', () => {
    render(
      <MemoryRouter>
        <UnifiedResearchConsole
          initialMode="deep"
          onModeChange={vi.fn()}
          syncEngineForRun={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('deep-page')).toBeTruthy();
    expect(screen.queryByTestId('easy-page')).toBeNull();
  });
});
