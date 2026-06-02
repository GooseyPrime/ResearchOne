/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchEngineModeToggle from '../../components/research/ResearchEngineModeToggle';

afterEach(() => {
  cleanup();
});

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

  it('calls onModeChange when a tab is clicked', () => {
    const onModeChange = vi.fn();
    render(<ResearchEngineModeToggle mode="standard" onModeChange={onModeChange} />);
    const tablist = screen.getByRole('tablist', { name: 'Research method' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    fireEvent.click(tabs[1]!);
    expect(onModeChange).toHaveBeenCalledWith('deep');
  });
});
