import type {
  AnnotationSource,
  ClipAnnotation,
  ClipKeyframeProvenance,
  ClipKeyframe,
  ClipVisibilityAction,
  ClipVisibilityKeyframe,
} from '../types/clip';
import type { FrameBoundary, VideoFrame } from './frameMath';

export type ClipFrameTrackingState = 'manual' | 'tracked' | 'correction' | 'lost';
export const MAX_INTERPOLATED_TRACK_GAP_FRAMES = 6;

function fallbackProvenanceFromSource(source: AnnotationSource): ClipKeyframeProvenance {
  if (source === 'auto' || source === 'corrected') return 'tracked';
  return 'manual';
}

export function getKeyframeProvenance(
  annotation: Pick<ClipAnnotation, 'source'>,
  keyframe: Pick<ClipKeyframe, 'visible' | 'provenance'>,
): ClipKeyframeProvenance {
  if (keyframe.provenance) return keyframe.provenance;
  if (keyframe.visible === false) return 'lost';
  return fallbackProvenanceFromSource(annotation.source);
}

export function countCorrectionKeyframes(annotation: ClipAnnotation): number {
  return annotation.keyframes.filter(
    (keyframe) => getKeyframeProvenance(annotation, keyframe) === 'correction',
  ).length;
}

export type FrameSpan = { startFrame: VideoFrame; endFrame: FrameBoundary };

function frameSpan(startFrame: number, endFrame: number): FrameSpan {
  return { startFrame: startFrame as VideoFrame, endFrame: endFrame as FrameBoundary };
}

function sortVisibilityKeyframes(
  visibilityKeyframes: ClipVisibilityKeyframe[] | undefined,
): ClipVisibilityKeyframe[] {
  return visibilityKeyframes?.length
    ? [...visibilityKeyframes].sort((left, right) => left.frame - right.frame)
    : [];
}

export function getLossSpans(
  annotation: ClipAnnotation,
  clipEndFrame: FrameBoundary,
): FrameSpan[] {
  const spans: FrameSpan[] = [];
  let activeStart: number | null = null;
  for (const keyframe of annotation.keyframes) {
    if (getKeyframeProvenance(annotation, keyframe) === 'lost') {
      if (activeStart === null) activeStart = keyframe.frame;
      continue;
    }
    if (activeStart !== null) {
      spans.push(frameSpan(activeStart, keyframe.frame));
      activeStart = null;
    }
  }
  if (activeStart !== null) spans.push(frameSpan(activeStart, clipEndFrame));
  return spans;
}

export function getManualVisibilitySpans(
  annotation: ClipAnnotation,
  clipEndFrame: FrameBoundary,
): FrameSpan[] {
  const spans: FrameSpan[] = [];
  let activeStart: number | null = null;
  for (const keyframe of sortVisibilityKeyframes(annotation.visibilityKeyframes)) {
    if (keyframe.action === 'hide') {
      activeStart = keyframe.frame;
    } else if (activeStart !== null) {
      spans.push(frameSpan(activeStart, keyframe.frame));
      activeStart = null;
    }
  }
  if (activeStart !== null) spans.push(frameSpan(activeStart, clipEndFrame));
  return spans;
}

export function getDerivedHiddenGapSpans(annotation: ClipAnnotation): FrameSpan[] {
  if (annotation.source === 'manual') return [];
  const spans: FrameSpan[] = [];
  for (let index = 0; index < annotation.keyframes.length - 1; index += 1) {
    const left = annotation.keyframes[index];
    const right = annotation.keyframes[index + 1];
    if (right.frame - left.frame <= MAX_INTERPOLATED_TRACK_GAP_FRAMES) continue;
    const leftProvenance = getKeyframeProvenance(annotation, left);
    const rightProvenance = getKeyframeProvenance(annotation, right);
    if (leftProvenance === 'lost' || rightProvenance === 'lost') continue;
    if (leftProvenance === 'manual' && rightProvenance === 'manual') continue;
    spans.push(frameSpan(left.frame, right.frame));
  }
  return spans;
}

function mergeFrameSpans(spans: FrameSpan[]): FrameSpan[] {
  if (spans.length <= 1) return spans.slice();
  const sorted = [...spans].sort((left, right) => left.startFrame - right.startFrame);
  const merged = [frameSpan(sorted[0].startFrame, sorted[0].endFrame)];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.startFrame <= last.endFrame) {
      last.endFrame = Math.max(last.endFrame, current.endFrame) as FrameBoundary;
    } else {
      merged.push(frameSpan(current.startFrame, current.endFrame));
    }
  }
  return merged;
}

export function getHiddenSpans(
  annotation: ClipAnnotation,
  clipEndFrame: FrameBoundary,
): FrameSpan[] {
  return mergeFrameSpans([
    ...getLossSpans(annotation, clipEndFrame),
    ...getDerivedHiddenGapSpans(annotation),
    ...getManualVisibilitySpans(annotation, clipEndFrame),
  ]);
}

export function isFrameWithinHiddenSpan(spans: FrameSpan[], frame: VideoFrame): boolean {
  return spans.some((span) => frame > span.startFrame && frame < span.endFrame);
}

export function getCurrentKeyframe(
  annotation: ClipAnnotation,
  frame: VideoFrame,
): ClipKeyframe | null {
  return annotation.keyframes.find((keyframe) => keyframe.frame === frame) ?? null;
}

export function getCurrentVisibilityKeyframe(
  annotation: ClipAnnotation,
  frame: VideoFrame,
): ClipVisibilityKeyframe | null {
  return annotation.visibilityKeyframes?.find((keyframe) => keyframe.frame === frame) ?? null;
}

export function getVisibilityAction(
  annotation: ClipAnnotation,
  frame: VideoFrame,
): ClipVisibilityAction | null {
  let action: ClipVisibilityAction | null = null;
  for (const keyframe of sortVisibilityKeyframes(annotation.visibilityKeyframes)) {
    if (keyframe.frame > frame) break;
    action = keyframe.action;
  }
  return action;
}

export function isAnnotationVisible(annotation: ClipAnnotation, frame: VideoFrame): boolean {
  return getVisibilityAction(annotation, frame) !== 'hide';
}

export function getNextCorrectionKeyframe(
  annotation: ClipAnnotation,
  frame: VideoFrame,
): ClipKeyframe | null {
  return annotation.keyframes.find((keyframe) => (
    keyframe.frame > frame
    && getKeyframeProvenance(annotation, keyframe) === 'correction'
  )) ?? null;
}

export function getFrameTrackingState(
  annotation: ClipAnnotation,
  frame: VideoFrame,
  clipEndFrame: FrameBoundary,
): ClipFrameTrackingState {
  const provenanceToState = (provenance: ClipKeyframeProvenance): ClipFrameTrackingState => (
    provenance === 'lost' ? 'lost'
      : provenance === 'correction' ? 'correction'
        : provenance === 'tracked' ? 'tracked'
          : 'manual'
  );
  const exact = getCurrentKeyframe(annotation, frame);
  if (exact) return provenanceToState(getKeyframeProvenance(annotation, exact));

  const keyframes = annotation.keyframes;
  if (keyframes.length === 0) return 'manual';
  if (isFrameWithinHiddenSpan(getHiddenSpans(annotation, clipEndFrame), frame)) return 'lost';
  if (frame <= keyframes[0].frame) return provenanceToState(getKeyframeProvenance(annotation, keyframes[0]));
  if (frame >= keyframes[keyframes.length - 1].frame) {
    return provenanceToState(getKeyframeProvenance(annotation, keyframes[keyframes.length - 1]));
  }

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const left = keyframes[index];
    const right = keyframes[index + 1];
    if (frame < left.frame || frame > right.frame) continue;
    const leftState = provenanceToState(getKeyframeProvenance(annotation, left));
    const rightState = provenanceToState(getKeyframeProvenance(annotation, right));
    if (leftState === 'lost' || rightState === 'lost') return 'lost';
    if (leftState === 'correction' || rightState === 'correction') return 'correction';
    if (leftState === 'tracked' || rightState === 'tracked') return 'tracked';
    return 'manual';
  }
  return annotation.source === 'manual' ? 'manual' : annotation.source === 'corrected' ? 'correction' : 'tracked';
}
