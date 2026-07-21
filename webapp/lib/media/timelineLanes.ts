export interface TimelineInterval {
  id: string;
  startFrame: number;
  endFrame: number;
}

export interface PackedTimelineInterval<T extends TimelineInterval> {
  interval: T;
  trackIndex: number;
}

export interface PackedTimelineIntervals<T extends TimelineInterval> {
  placements: PackedTimelineInterval<T>[];
  trackCount: number;
}

export function packTimelineIntervals<T extends TimelineInterval>(
  intervals: readonly T[],
): PackedTimelineIntervals<T> {
  const trackEnds: number[] = [];
  const placements = [...intervals]
    .sort((left, right) => (
      left.startFrame - right.startFrame
      || left.endFrame - right.endFrame
      || left.id.localeCompare(right.id)
    ))
    .map((interval) => {
      let trackIndex = trackEnds.findIndex((endFrame) => endFrame <= interval.startFrame);
      if (trackIndex < 0) {
        trackIndex = trackEnds.length;
        trackEnds.push(interval.endFrame);
      } else {
        trackEnds[trackIndex] = interval.endFrame;
      }
      return { interval, trackIndex };
    });

  return { placements, trackCount: trackEnds.length };
}
