export const TIMELINE_MANUAL_OVERRIDE_MS = 5_000;

export interface TimelineManualOverride {
  mark(): void;
  isActive(): boolean;
}

export function createTimelineManualOverride(
  now: () => number = () => Date.now(),
  durationMs = TIMELINE_MANUAL_OVERRIDE_MS,
): TimelineManualOverride {
  let activeUntil = Number.NEGATIVE_INFINITY;

  return {
    mark() {
      activeUntil = now() + durationMs;
    },
    isActive() {
      return now() < activeUntil;
    },
  };
}
