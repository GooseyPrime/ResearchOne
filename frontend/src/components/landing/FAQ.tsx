type FaqItem = {
  question: string;
  answer: string;
};

export default function FAQ({ items }: { items: FaqItem[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <details key={item.question} className="rounded-lg border border-white/10 bg-r1-bg-deep/70 p-4">
          <summary className="cursor-pointer text-base font-semibold text-r1-text">{item.question}</summary>
          <p className="mt-3 text-sm text-r1-text-muted">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
