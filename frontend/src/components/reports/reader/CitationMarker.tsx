import { useEffect, useId, useRef, useState } from 'react';
import { readableDay, referenceAnchor, type ReaderSource } from './readerModel';

/**
 * A bracketed citation number. Hover, keyboard focus or a tap shows the source
 * and the exact passage behind the sentence; the number itself goes to its
 * reference entry. Works with a mouse, a keyboard and a touch screen.
 */
export default function CitationMarker({
  number,
  quote,
  source,
}: {
  number: number;
  quote: string | null;
  source: ReaderSource | null;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const cardId = useId();
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: KeyboardEvent | MouseEvent | TouchEvent): void => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !wrap.current?.contains(event.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  const details = [source?.publisher, readableDay(source?.date ?? null)].filter(Boolean).join(' · ');

  return (
    <span
      ref={wrap}
      className="relative inline-block align-baseline"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
      // Focus may move from the number to the link inside the card; the card closes only when focus leaves both.
      onBlur={(event) => {
        if (!pinned && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded px-0.5 text-[0.85em] align-super leading-none"
        aria-label={`Citation ${number}${source ? `: ${source.title}` : ''}`}
        aria-expanded={open}
        aria-describedby={open ? cardId : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => {
          // A tap has no hover: one tap opens the card and keeps it open, the next closes it.
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
      >
        [{number}]
      </button>
      {open && (
        <span
          id={cardId}
          role="tooltip"
          className="absolute z-30 left-0 top-full mt-1 w-72 max-w-[85vw] rounded-lg border border-indigo-900/40 bg-surface-100 p-3 text-left text-xs shadow-xl not-prose"
        >
          <span className="block font-semibold text-slate-100 leading-snug">{source?.title ?? 'Source'}</span>
          {details && <span className="block text-slate-400 mt-0.5">{details}</span>}
          {source?.notice && <span className="block text-amber-300 mt-1">{source.notice}</span>}
          {quote && <span className="block text-slate-300 mt-2 border-l-2 border-accent/40 pl-2 italic leading-relaxed">“{quote}”</span>}
          <a className="block text-accent hover:underline mt-2" href={`#${referenceAnchor(number)}`} onClick={() => setOpen(false)}>
            Go to reference {number}
          </a>
        </span>
      )}
    </span>
  );
}
