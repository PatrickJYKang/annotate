import { useLayoutEffect, useRef } from 'react';

interface Props {
  initial: string;
  label: string;
  hint: string;
  style: React.CSSProperties;
  onFinish: (value: string | null) => void;
}

export default function CanvasTextInput({ initial, label, hint, style, onFinish }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  function finish(value: string | null) {
    if (finished.current) return;
    finished.current = true;
    onFinish(value);
  }

  return <>
    <div aria-hidden="true" className="absolute inset-0 z-10"
      onMouseDown={event => event.preventDefault()}
      onClick={() => input.current?.blur()}
    />
    <textarea
    ref={input}
    aria-label={label}
    aria-keyshortcuts="Control+Enter Meta+Enter Escape"
    title={hint}
    placeholder={label}
    defaultValue={initial}
    rows={1}
    wrap="off"
    style={style}
    onBlur={(event) => finish(event.currentTarget.value)}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === 'Escape' ? null : event.currentTarget.value);
      }
    }}
    />
  </>;
}
