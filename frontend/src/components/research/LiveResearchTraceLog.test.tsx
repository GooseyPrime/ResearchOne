/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveResearchTraceLog from './LiveResearchTraceLog';
import type { ResearchProgressEvent } from '../../utils/api';

describe('LiveResearchTraceLog', () => {
  it('shows empty copy when there are no events', () => {
    render(<LiveResearchTraceLog traceEvents={[]} emptyMessage="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });

  it('renders multiple events in array order (chronological, newest at bottom)', () => {
    const first: ResearchProgressEvent = {
      runId: 'run-1',
      stage: 'planning',
      percent: 0,
      message: 'first-event-msg',
      timestamp: '2025-06-01T12:00:00.000Z',
    };
    const second: ResearchProgressEvent = {
      runId: 'run-1',
      stage: 'discovery',
      percent: 5,
      message: 'second-event-msg',
      timestamp: '2025-06-01T12:00:05.000Z',
    };
    const { container } = render(<LiveResearchTraceLog traceEvents={[first, second]} />);
    expect(screen.getByText('first-event-msg')).toBeInTheDocument();
    expect(screen.getByText('second-event-msg')).toBeInTheDocument();
    const scroll = container.querySelector('.overflow-y-auto');
    expect(scroll).toBeTruthy();
    const text = scroll?.textContent ?? '';
    expect(text.indexOf('first-event-msg')).toBeLessThan(text.indexOf('second-event-msg'));
  });
});
