"use client";

import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { resolveNumberDraft } from './numberDraft';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'min' | 'max' | 'onChange' | 'onBlur' | 'onKeyDown'> & {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
};

export default function CommittedNumberInput({ value, min, max, onCommit, ...props }: Props) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = resolveNumberDraft(draft, value, min, max);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setDraft(String(value));
        }
      }}
    />
  );
}
