import { useState } from 'react';

interface PerRunOptOutProps {
  onOptOutChange: (optOut: boolean) => void;
  defaultOptOut?: boolean;
}

export default function PerRunOptOut({ onOptOutChange, defaultOptOut = false }: PerRunOptOutProps) {
  const [optOut, setOptOut] = useState(defaultOptOut);

  const toggle = () => {
    const next = !optOut;
    setOptOut(next);
    onOptOutChange(next);
  };

  return (
    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={optOut}
        onChange={toggle}
        className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
      />
      <span>Exclude this run from research contribution</span>
    </label>
  );
}
