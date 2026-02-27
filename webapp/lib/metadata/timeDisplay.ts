import type { MatchPeriod } from "../types/project";

// ---------------------------------------------------------------------------
// Period-aware timestamp formatter (visual-only, display-only)
// ---------------------------------------------------------------------------

/**
 * Formats a raw video timestamp (ms) as a match-relative string
 * when period boundaries are available.
 *
 * Examples:
 *   - `1H 34:12` — 34 minutes 12 seconds into the 1st half
 *   - `2H 07:40` — 7 minutes 40 seconds into the 2nd half
 *
 * Falls back to the raw video timestamp (`mm:ss.mmm`) when boundaries
 * are unset or incomplete.
 */

const PERIOD_PREFIX: Record<string, string> = {
  "1st Half": "1H",
  "2nd Half": "2H",
  "Extra Time 1": "ET1",
  "Extra Time 2": "ET2",
};

function shortLabel(label: string): string {
  return PERIOD_PREFIX[label] ?? label;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

/**
 * Raw video time → `mm:ss.mmm` (or `h:mm:ss.mmm` if ≥ 1 hour).
 */
export function formatRawTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  let r = clamped;
  const hh = Math.floor(r / 3600000); r %= 3600000;
  const mm = Math.floor(r / 60000); r %= 60000;
  const ss = Math.floor(r / 1000);
  const mmm = r % 1000;
  return hh > 0
    ? `${hh}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}`
    : `${mm}:${pad2(ss)}.${pad3(mmm)}`;
}

/**
 * Match-relative time within a period → `MM:SS`.
 */
function formatMatchTime(offsetMs: number): string {
  const clamped = Math.max(0, Math.floor(offsetMs));
  const mm = Math.floor(clamped / 60000);
  const ss = Math.floor((clamped % 60000) / 1000);
  return `${pad2(mm)}:${pad2(ss)}`;
}

export type FormatResult = {
  /** The formatted display string */
  display: string;
  /** Whether this used period-aware formatting (true) or raw fallback (false) */
  periodAware: boolean;
};

/**
 * Format a video timestamp as a match-relative timestamp if possible,
 * otherwise fall back to the raw video time format.
 *
 * @param videoTimeMs - The raw video time in milliseconds.
 * @param videoId     - The video this timestamp belongs to.
 * @param periods     - Array of period definitions from matchInfo.
 * @returns A `FormatResult` with the display string and a flag.
 */
export function formatMatchTimestamp(
  videoTimeMs: number,
  videoId: string,
  periods: MatchPeriod[],
): FormatResult {
  // Filter periods that belong to this video and have complete boundaries
  const complete = periods.filter(
    (p) =>
      p.videoId === videoId &&
      p.startMs != null &&
      p.endMs != null,
  );

  if (complete.length === 0) {
    return { display: formatRawTime(videoTimeMs), periodAware: false };
  }

  // Find the period this timestamp falls into
  for (const p of complete) {
    const start = p.startMs!;
    const end = p.endMs!;
    if (videoTimeMs >= start && videoTimeMs <= end) {
      const offset = videoTimeMs - start;
      return {
        display: `${shortLabel(p.label)} ${formatMatchTime(offset)}`,
        periodAware: true,
      };
    }
  }

  // Timestamp doesn't fall within any period — try closest period
  // and show offset with a "+" or show raw fallback
  // For simplicity, fall back to raw time
  return { display: formatRawTime(videoTimeMs), periodAware: false };
}
