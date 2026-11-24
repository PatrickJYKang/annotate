import { effectivePausePins, validateMatchVideoEdge } from '../presentation/authoring';
import type { Clip } from '../types/clip';
import type { ClipPauseCue, ClipSlide, DeckTake, PinAnnotationCue, TitleSlide } from '../types/presentation';
import type { ClipTake } from '../types/recording';
import type { ProjectManifest, VideoEntry } from '../types/project';

export function importClipTake(slide: ClipSlide, take: ClipTake): ClipSlide {
  return {
    ...slide,
    range: { startFrame: take.startFrame, endFrame: take.endFrame },
    pausePins: take.pauses.map((p) => p.pinId),
    pauseCues: structuredClone(take.pauses),
  };
}

export type OutputSegment =
  | { kind: 'title'; slide: TitleSlide; duration: number }
  | {
      kind: 'video';
      video: VideoEntry;
      clip?: Clip;
      start: number;
      end: number;
      rate: number;
      duration: number;
    }
  | {
      kind: 'pin';
      video: VideoEntry;
      clip: Clip;
      pin: Clip['pins'][number];
      ids?: string[] | null;
      cues?: PinAnnotationCue[];
      clicks: number[];
      duration: number;
    };

export function recordingSegments(
  take: Pick<DeckTake, 'slides' | 'transitions'>,
  clips: readonly Clip[],
  manifest: ProjectManifest,
): OutputSegment[] {
  const result: OutputSegment[] = [];
  function motion(video: VideoEntry, start: number, end: number, rate: number, clip?: Clip) {
    if (end > start)
      result.push({
        kind: 'video',
        video,
        clip,
        start,
        end,
        rate,
        duration: ((end - start) * 1000) / video.fps / rate,
      });
  }
  take.slides.forEach((slide, index) => {
    if (slide.kind === 'title') result.push({ kind: 'title', slide, duration: slide.holdMs ?? 2000 });
    else {
      const clip = clips.find((c) => c.id === slide.clipId);
      const video = manifest.videos.find((v) => v.id === clip?.videoId);
      if (!clip || !video) throw new Error('A recording source is missing: ' + slide.clipId);
      if (slide.kind === 'pin') {
        const pin = clip.pins.find((p) => p.id === slide.pinId);
        if (!pin) throw new Error('Missing recorded pin: ' + slide.pinId);
        result.push({
          kind: 'pin',
          video,
          clip,
          pin,
          ids: slide.showAnnotations ? slide.annotationIds : [],
          cues: slide.annotationCues,
          clicks: slide.clickTimesMs ?? [],
          duration: slide.holdMs ?? 2000,
        });
      } else {
        const { startFrame, endFrame } = slide.range ?? clip;
        if (endFrame > video.frameCount || startFrame >= endFrame)
          throw new Error('Invalid recorded frame range.');
        for (const id of slide.pausePins ?? [])
          if (!clip.pins.some((p) => p.id === id && p.frame >= startFrame && p.frame < endFrame)) {
            throw new Error('Recorded pin is missing or outside the range: ' + id);
          }
        let cursor: number = startFrame;
        for (const pin of effectivePausePins(clip, slide).filter(
          (p) => p.frame >= startFrame && p.frame < endFrame,
        )) {
          motion(video, cursor, pin.frame, 1, clip);
          const cue: ClipPauseCue | undefined = slide.pauseCues?.find((p) => p.pinId === pin.id);
          result.push({
            kind: 'pin',
            video,
            clip,
            pin,
            ids: cue?.annotationIds,
            cues: cue?.annotationCues,
            clicks: cue?.clickTimesMs ?? [],
            duration: cue?.holdMs ?? 2000,
          });
          cursor = pin.frame;
        }
        motion(video, cursor, endFrame, 1, clip);
        if (slide.holdMs)
          result.push({
            kind: 'video',
            video,
            clip,
            start: endFrame - 1,
            end: endFrame,
            rate: 0,
            duration: slide.holdMs,
          });
      }
    }
    const edge = take.transitions[index];
    if (edge?.mode === 'match_video') {
      const next = take.slides[index + 1];
      const valid = next && validateMatchVideoEdge(slide, next, edge, clips, manifest);
      if (!valid?.ok) throw new Error(valid?.reason ?? 'Missing transition destination.');
      motion(valid.video, valid.range.startFrame, valid.range.endFrame, edge.playbackRate ?? 1);
    }
  });
  return result;
}

/** Round the accumulated duration, not each segment: short cues must not introduce drift. */
export function* outputFrames(segments: OutputSegment[], fps: number) {
  let start = 0,
    index = 0;
  for (const segment of segments) {
    const end = start + segment.duration;
    const boundary = Math.ceil((end * fps) / 1000 - 1e-8);
    while (index < boundary) {
      yield { index, segment, elapsed: Math.max(0, (index * 1000) / fps - start) };
      index++;
    }
    start = end;
  }
}
