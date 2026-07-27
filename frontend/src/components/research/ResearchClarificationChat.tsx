import { MessageCircleQuestion } from 'lucide-react';

export default function ResearchClarificationChat({
  questions,
  answers,
  onAnswerChange,
  onContinueWithoutAnswers,
  onSubmitAnswers,
  busy = false,
}: {
  questions: string[];
  answers: string[];
  onAnswerChange: (idx: number, value: string) => void;
  onContinueWithoutAnswers: () => void;
  onSubmitAnswers: () => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-xl border border-surface-100 bg-surface-200/40 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="text-accent mt-0.5" size={18} />
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Optional clarifications</h3>
          <p className="text-xs text-slate-400">
            Answer any of these to improve plan accuracy, or skip and continue.
          </p>
        </div>
      </div>

      {questions.map((question, idx) => (
        <label key={`${question}-${idx}`} className="block space-y-1">
          <span className="text-xs text-slate-300">{question}</span>
          <textarea
            rows={2}
            className="w-full rounded-lg border border-surface-100 bg-[#0b0d14] px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600"
            value={answers[idx] ?? ''}
            onChange={(e) => onAnswerChange(idx, e.target.value)}
            disabled={busy}
            placeholder="Optional answer"
          />
        </label>
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={onContinueWithoutAnswers} disabled={busy}>
          Skip clarifications
        </button>
        <button type="button" className="btn-primary text-xs" onClick={onSubmitAnswers} disabled={busy}>
          Plan using answers
        </button>
      </div>
    </div>
  );
}
