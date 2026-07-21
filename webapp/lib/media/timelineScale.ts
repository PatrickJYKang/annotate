export const DEFAULT_TIMELINE_WINDOW_SECONDS = 60;
export const MAXIMUM_TIMELINE_ZOOM = 64;

export interface TimelineScale {
  defaultVisibleSeconds: number;
  minimumZoom: number;
  maximumZoom: number;
  zoom: number;
  basePixelsPerSecond: number;
  pixelsPerSecond: number;
  totalWidth: number;
}

export function calculateTimelineScale(
  durationSeconds: number,
  containerWidth: number,
  requestedZoom: number,
): TimelineScale {
  const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const width = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
  const defaultVisibleSeconds = duration > 0
    ? Math.min(DEFAULT_TIMELINE_WINDOW_SECONDS, duration)
    : DEFAULT_TIMELINE_WINDOW_SECONDS;
  const minimumZoom = duration > 0
    ? Math.min(1, defaultVisibleSeconds / duration)
    : 1;
  const zoom = Math.max(
    minimumZoom,
    Math.min(MAXIMUM_TIMELINE_ZOOM, Number.isFinite(requestedZoom) ? requestedZoom : 1),
  );
  const basePixelsPerSecond = width > 0 && duration > 0
    ? width / defaultVisibleSeconds
    : 1;
  const pixelsPerSecond = basePixelsPerSecond * zoom;

  return {
    defaultVisibleSeconds,
    minimumZoom,
    maximumZoom: MAXIMUM_TIMELINE_ZOOM,
    zoom,
    basePixelsPerSecond,
    pixelsPerSecond,
    totalWidth: duration > 0 ? duration * pixelsPerSecond : width,
  };
}
