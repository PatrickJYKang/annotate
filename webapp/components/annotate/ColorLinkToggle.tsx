"use client";

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
  return (
    <button
      type="button"
      aria-label={linked ? "Unlink stroke and fill colors" : "Link stroke and fill colors"}
      aria-pressed={linked}
      title={linked ? "Stroke and fill change together" : "Stroke and fill change separately"}
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
