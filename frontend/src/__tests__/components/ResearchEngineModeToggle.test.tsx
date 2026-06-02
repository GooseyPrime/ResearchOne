import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ResearchEngineModeToggle from '../../components/research/ResearchEngineModeToggle';

describe('ResearchEngineModeToggle', () => {
  it('renders Standard and Deep mode titles and descriptions', () => {
    render(
      <ResearchEngineModeToggle
        mode="standard"
        onModeChange={vi.fn()}
      />
    );
    expect(screen.getByText('Standard Research')).toBeTruthy();
    expect(screen.getByText(/Fast, multi-source research/)).toBeTruthy();
    expect(screen.getByText('Deep Research')).toBeTruthy();
    expect(screen.getByText(/skeptic step that argues against the draft/)).toBeTruthy();
  });

  it('shows Pro plan required hint when deep is locked', () => {
    render(
      <ResearchEngineModeToggle mode="standard" onModeChange={vi.fn()} deepLocked />
    );
    const deepTabs = screen.getAllByRole('tab', { name: /Deep Research/i });
    expect(deepTabs.length).toBeGreaterThan(0);
    expect(screen.getByText('Pro plan required')).toBeTruthy();
  });
});
