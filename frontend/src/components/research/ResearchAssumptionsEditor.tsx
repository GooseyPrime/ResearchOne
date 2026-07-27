import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

function normalize(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

function normalizeForCompare(items: string[]): string {
  // Order-independent compare: reordering assumptions alone does not count as an edit.
  // 'en' with sensitivity:'base' gives stable, accent-ignoring results across environments.
  return normalize(items).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join('\n');
}

export default function ResearchAssumptionsEditor({
  assumptions,
  disabled = false,
  onUseAsRefinement,
}: {
  assumptions: string[];
  disabled?: boolean;
  onUseAsRefinement?: (instruction: string) => void;
}) {
  const [drafts, setDrafts] = useState<string[]>(assumptions.length > 0 ? assumptions : ['']);

  useEffect(() => {
    setDrafts(assumptions.length > 0 ? assumptions : ['']);
  }, [assumptions]);

  const cleaned = useMemo(() => normalize(drafts), [drafts]);
  const hasChanges = useMemo(
    () => normalizeForCompare(drafts) !== normalizeForCompare(assumptions),
    [drafts, assumptions]
  );

  return (
    <div className="space-y-2">
      {drafts.map((draft, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <input
            className="input text-xs flex-1"
            value={draft}
            onChange={(e) =>
              setDrafts((prev) => prev.map((item, itemIdx) => (itemIdx === idx ? e.target.value : item)))
            }
            disabled={disabled}
            placeholder="Assumption"
          />
          {drafts.length > 1 ? (
            <button
              type="button"
              className="btn-ghost border border-surface-100 rounded-md p-2 text-slate-300"
              onClick={() => setDrafts((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))}
              disabled={disabled}
              aria-label="Remove assumption"
            >
              <Trash2 size={14} />
            </button>
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1 text-xs"
          onClick={() => setDrafts((prev) => [...prev, ''])}
          disabled={disabled}
        >
          <Plus size={12} />
          Add assumption
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() =>
            onUseAsRefinement?.(
              `Update plan assumptions:\n${cleaned.map((item) => `- ${item}`).join('\n') || '- No assumptions'}`
            )
          }
          disabled={disabled || !hasChanges}
        >
          Use edits in refinement
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        You can continue without editing these. Edits become a refinement instruction when applied.
      </p>
    </div>
  );
}
