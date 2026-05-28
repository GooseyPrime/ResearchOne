/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResearchEngineModeToggle from '../../components/research/ResearchEngineModeToggle';

describe('ResearchEngineModeToggle', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows descriptive copy for both modes', () => {
    render(<ResearchEngineModeToggle mode="standard" onModeChange={() => {}} />);
    expect(screen.getByText('Standard Retrieval')).toBeTruthy();
    expect(screen.getByText(/Fast, multi-source knowledge retrieval/)).toBeTruthy();
    expect(screen.getByText('Deep Adversarial Synthesis')).toBeTruthy();
    expect(screen.getByText(/red-team adversarial agents/)).toBeTruthy();
  });

  it('calls onModeChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<ResearchEngineModeToggle mode="standard" onModeChange={onModeChange} />);
    const deepTabs = screen.getAllByRole('tab', { name: /Deep Adversarial Synthesis/i });
    await user.click(deepTabs[0]!);
    expect(onModeChange).toHaveBeenCalledWith('deep');
  });
});
