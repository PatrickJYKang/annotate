import type { Clip } from '../types/clip';
import type { ProjectManifestV1 } from '../types/project';
import { roundAbsoluteMsToVideoFrame } from './frameMath';

type ClipStill = ProjectManifestV1['stills'][number];
type ClipBounds = Pick<Clip, 'videoId' | 'startMs' | 'endMs'>;
export type StillClipPosition = 'before' | 'inside' | 'after' | 'different_video';

/**
 * Clip/still relationship is derived, not stored:
 * a still belongs to a clip context iff `clip.startMs <= still.t_ms <= clip.endMs`
 * and both reference the same source video.
 */
export function isStillWithinClipBounds(
  clip: ClipBounds,
  still: Pick<ClipStill, 'videoId' | 't_ms'>,
): boolean {
  return (
    still.videoId === clip.videoId
    && still.t_ms >= clip.startMs
    && still.t_ms <= clip.endMs
  );
}

export function getStillClipPosition(
  clip: ClipBounds,
  still: Pick<ClipStill, 'videoId' | 't_ms'>,
): StillClipPosition {
  if (still.videoId !== clip.videoId) return 'different_video';
  if (still.t_ms < clip.startMs) return 'before';
  if (still.t_ms > clip.endMs) return 'after';
  return 'inside';
}

export function listStillsForClipVideo(
  stills: ClipStill[],
  clip: Pick<ClipBounds, 'videoId'>,
): ClipStill[] {
  return stills
    .filter((still) => still.videoId === clip.videoId)
    .slice()
    .sort((a, b) => {
      if (a.t_ms !== b.t_ms) return a.t_ms - b.t_ms;
      return a.id.localeCompare(b.id);
    });
}

export function listStillsWithinClipBounds(
  stills: ClipStill[],
  clip: ClipBounds,
): ClipStill[] {
  return listStillsForClipVideo(stills, clip)
    .filter((still) => isStillWithinClipBounds(clip, still));
}

export function getClipRelativeMsForStill(
  clip: Pick<Clip, 'startMs'>,
  still: Pick<ClipStill, 't_ms'>,
): number {
  return still.t_ms - clip.startMs;
}

function chooseClosestTimestamp(targetMs: number, candidates: number[]): number | null {
  if (!Number.isFinite(targetMs) || candidates.length === 0) return null;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    const distance = Math.abs(candidate - targetMs);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Stills are recorded as timestamps but conceptually belong to a concrete frame
 * in the source video. For clip import, snap on the source-video frame grid
 * first, then convert back to clip-relative time. Near clip edges, prefer the
 * nearest frame that still lies inside the clip bounds.
 */
export function getClipRelativeImportMsForStill(
  clip: Pick<Clip, 'startMs' | 'endMs'>,
  still: Pick<ClipStill, 't_ms'>,
  fps: number,
): number {
  const rawRelativeMs = still.t_ms - clip.startMs;
  const clipDurationMs = Math.max(0, clip.endMs - clip.startMs);
  if (!Number.isFinite(still.t_ms) || !Number.isFinite(clip.startMs) || !Number.isFinite(clip.endMs)) {
    return Math.max(0, Math.min(clipDurationMs, rawRelativeMs));
  }
  if (!(fps > 0)) {
    return Math.max(0, Math.min(clipDurationMs, rawRelativeMs));
  }

  const frameDurationMs = 1000 / fps;
  const frameIndex = still.t_ms / frameDurationMs;
  const frameCandidates = Array.from(
    new Set([
      Math.floor(frameIndex),
      Math.round(frameIndex),
      Math.ceil(frameIndex),
    ]),
  )
    .map((index) => index * frameDurationMs)
    .filter((timestamp) => Number.isFinite(timestamp));

  const inBoundsCandidates = frameCandidates.filter(
    (timestamp) => timestamp >= clip.startMs && timestamp <= clip.endMs,
  );
  const chosenAbsoluteMs = chooseClosestTimestamp(
    roundAbsoluteMsToVideoFrame(still.t_ms, fps),
    inBoundsCandidates.length > 0 ? inBoundsCandidates : frameCandidates,
  );
  const clampedAbsoluteMs = Math.max(
    clip.startMs,
    Math.min(clip.endMs, chosenAbsoluteMs ?? still.t_ms),
  );
  return clampedAbsoluteMs - clip.startMs;
}
