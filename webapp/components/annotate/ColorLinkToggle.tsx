"use client";

import { useT } from '../../lib/i18n';

type ColorLinkToggleProps = {
  linked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
};

export default function ColorLinkToggle({
  linked,
  onToggle,
  disabled,
  className = "",
}: ColorLinkToggleProps) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={linked ? t('annotation.unlinkColors') : t('annotation.linkColors')}
      aria-pressed={linked}
      title={linked ? t('annotation.linkedColorsTitle') : t('annotation.unlinkedColorsTitle')}
      onClick={onToggle}
      disabled={disabled}
      className={`inline-flex h-7 w-7 items-center justify-center border border-border p-0 disabled:cursor-not-allowed disabled:opacity-50 ${
        linked ? "bg-white/15 text-primary" : "bg-transparent text-muted"
      } ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9.5 7.5H7a4.5 4.5 0 0 0 0 9h2.5M14.5 7.5H17a4.5 4.5 0 0 1 0 9h-2.5M8.5 12h7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {!linked && (
          <path
            d="M5 19 19 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}
