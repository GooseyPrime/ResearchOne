/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdate = vi.fn();

vi.mock('@clerk/react', () => ({
  useUser: vi.fn(() => ({
    isLoaded: true,
    user: {
      unsafeMetadata: {},
      update: mockUpdate,
    },
  })),
}));

import OnboardingPage from '../../pages/OnboardingPage';
import { useUser } from '@clerk/react';

describe('OnboardingPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUpdate.mockClear();
    vi.mocked(useUser).mockReturnValue({
      isLoaded: true,
      user: {
        unsafeMetadata: {},
        update: mockUpdate,
      },
    } as ReturnType<typeof useUser>);
  });

  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to ResearchOne');
  });

  it('disables continue until a pipeline choice is selected', () => {
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Continue to research workspace/i })).toBeDisabled();
  });

  it('selecting No enables continue and saves pipelineBConsent false', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('radio', { name: /No, opt out/i }));
    const btn = screen.getByRole('button', { name: /Continue to research workspace/i });
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(mockUpdate).toHaveBeenCalledWith({
      unsafeMetadata: expect.objectContaining({
        pipelineBConsent: false,
        pipelineBConsentAt: null,
        initialTier: 'free_demo',
        onboardingComplete: true,
      }),
    });
  });
});
