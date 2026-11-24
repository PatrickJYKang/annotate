/** Milliseconds are relative to the moment the pin appears, not to the video. */
export interface ClickTiming {
  holdMs: number;
  clickTimesMs: number[];
}

export interface ClipTake {
  id: string;
  name: string;
  startFrame: number;
  endFrame: number;
  pauses: Array<ClickTiming & { pinId: string }>;
}

export function validRange(start: unknown, end: unknown): boolean {
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number(start) >= 0 &&
    Number(end) > Number(start)
  );
}

export function validClicks(clicks: unknown, hold: unknown): clicks is number[] {
  return (
    typeof hold === 'number' &&
    Number.isFinite(hold) &&
    hold >= 0 &&
    Array.isArray(clicks) &&
    clicks.every((n, i) => Number.isFinite(n) && n >= 0 && n <= hold && (!i || n >= clicks[i - 1]))
  );
}
