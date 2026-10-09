import { useState, type ReactNode } from 'react';

/** How many rows of a long list are drawn before "Show all". */
export const SHOW_ALL_FIRST = 25;

/**
 * A long list, drawn a part at a time (RJ-022B).
 *
 * A run can find several hundred sources (317 on the run of 9 Oct 2026), and
 * the diagnostics page drew every one of them as soon as its section was
 * opened. This draws the first rows and a "Show all 317" button; the rest are
 * drawn when it is pressed, and can be put away again. The count in the button
 * is the length of the list, so nothing is hidden without saying how much.
 */
export default function ShowAllList<T>({
  items,
  first = SHOW_ALL_FIRST,
  className,
  testId,
  children,
}: {
  items: readonly T[];
  first?: number;
  className?: string;
  testId?: string;
  children: (item: T, index: number) => ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const long = items.length > first;
  const drawn = long && !showAll ? items.slice(0, first) : items;
  return (
    <div className={className} data-testid={testId}>
      {drawn.map((item, index) => children(item, index))}
      {long && (
        <button
          type="button"
          className="btn-ghost text-xs text-accent"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? `Show the first ${first}` : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
