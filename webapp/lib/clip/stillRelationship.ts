import type { Clip } from '../types/clip';
import type { ProjectManifestV1 } from '../types/project';

type ClipStill = ProjectManifestV1['stills'][number];
type ClipBounds = Pick<Clip, 'videoId' | 'startMs' | 'endMs'>;

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

export function listStillsWithinClipBounds(
  stills: ClipStill[],
  clip: ClipBounds,
): ClipStill[] {
  return stills
    .filter((still) => isStillWithinClipBounds(clip, still))
    .slice()
    .sort((a, b) => {
      if (a.t_ms !== b.t_ms) return a.t_ms - b.t_ms;
      return a.id.localeCompare(b.id);
    });
}

export function getClipRelativeMsForStill(
  clip: Pick<Clip, 'startMs'>,
  still: Pick<ClipStill, 't_ms'>,
): number {
  return still.t_ms - clip.startMs;
}
