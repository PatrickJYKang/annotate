import type {
  ClipAnnotation,
  HighlightKeyframe,
} from '../types/clip';
import {
  videoFrame,
  type FrameBoundary,
  type VideoFrame,
} from './frameMath';
import { interpolateAnnotation } from './interpolation';

export type HighlightGeometry = Pick<HighlightKeyframe, 'cx' | 'cy' | 'radius'>;

function isVisibleHighlightKeyframe(keyframe: HighlightKeyframe): boolean {
  return keyframe.visible !== false && keyframe.provenance !== 'lost';
}

export function reusableTrackingHighlight(
  annotation: ClipAnnotation | null,
  frame: VideoFrame,
): ClipAnnotation | null {
  if (!annotation || annotation.type !== 'highlight' || annotation.coordMode !== 'image') return null;
  if (annotation.keyframes.some((keyframe) => keyframe.frame === frame)) return null;
  if (annotation.visibilityKeyframes?.some((keyframe) => keyframe.frame === frame)) return null;
  return annotation;
}

export function seedTrackingHighlightSegment(
  annotation: ClipAnnotation,
  targetFrame: VideoFrame,
  target: HighlightGeometry,
): ClipAnnotation {
  if (annotation.type !== 'highlight') return annotation;
  const targetKeyframe: HighlightKeyframe = {
    frame: targetFrame,
    provenance: annotation.keyframes.length > 0 ? 'correction' : 'manual',
    ...target,
  };
  return {
    ...annotation,
    source: annotation.keyframes.length > 0 ? 'corrected' : annotation.source,
    keyframes: [
      ...annotation.keyframes.filter((keyframe) => keyframe.frame !== targetFrame),
      targetKeyframe,
    ].sort((left, right) => left.frame - right.frame),
    visibilityKeyframes: annotation.visibilityKeyframes?.filter(
      (keyframe) => keyframe.frame !== targetFrame,
    ),
  };
}

function highlightGeometryAt(
  annotation: ClipAnnotation,
  frame: VideoFrame,
  clipEndFrame: FrameBoundary,
): HighlightGeometry | null {
  const value = interpolateAnnotation(annotation, frame, clipEndFrame);
  return value?.type === 'highlight'
    ? { cx: value.cx, cy: value.cy, radius: value.radius }
    : null;
}

export function stopTrackingHighlightSegment(
  annotation: ClipAnnotation,
  stopFrame: VideoFrame,
  clipStartFrame: VideoFrame,
  clipEndFrame: FrameBoundary,
): ClipAnnotation {
  if (annotation.type !== 'highlight') return annotation;
  const keyframes = annotation.keyframes as HighlightKeyframe[];
  const existing = keyframes.find((keyframe) => keyframe.frame === stopFrame);
  if (existing && !isVisibleHighlightKeyframe(existing)) return annotation;

  const previousFrame = videoFrame(Math.max(clipStartFrame, stopFrame - 1));
  const fallback = [...keyframes]
    .reverse()
    .find((keyframe) => keyframe.frame <= stopFrame && isVisibleHighlightKeyframe(keyframe));
  const stopGeometry = highlightGeometryAt(annotation, stopFrame, clipEndFrame)
    ?? highlightGeometryAt(annotation, previousFrame, clipEndFrame)
    ?? (fallback ? { cx: fallback.cx, cy: fallback.cy, radius: fallback.radius } : null);
  if (!stopGeometry) return annotation;

  const supportGeometry = stopFrame > clipStartFrame
    ? highlightGeometryAt(annotation, previousFrame, clipEndFrame) ?? stopGeometry
    : null;
  const supportKeyframe = supportGeometry
    && !keyframes.some((keyframe) => keyframe.frame === previousFrame)
    && !annotation.visibilityKeyframes?.some((keyframe) => keyframe.frame === previousFrame)
    ? {
        frame: previousFrame,
        provenance: 'tracked' as const,
        ...supportGeometry,
      }
    : null;
  const lostKeyframe: HighlightKeyframe = {
    frame: stopFrame,
    provenance: 'lost',
    visible: false,
    ...stopGeometry,
  };

  return {
    ...annotation,
    source: 'corrected',
    keyframes: [
      ...keyframes.filter((keyframe) => keyframe.frame !== stopFrame),
      ...(supportKeyframe ? [supportKeyframe] : []),
      lostKeyframe,
    ].sort((left, right) => left.frame - right.frame),
    visibilityKeyframes: annotation.visibilityKeyframes?.filter(
      (keyframe) => keyframe.frame !== stopFrame,
    ),
  };
}

/** Join a human reacquisition to the last trusted observation frame-by-frame. */
export function bridgeTrackingHighlight(
  annotation: ClipAnnotation,
  targetFrame: VideoFrame,
  target: HighlightGeometry,
): ClipAnnotation {
  if (annotation.type !== 'highlight') return annotation;
  const keyframes = annotation.keyframes as HighlightKeyframe[];
  const previous = [...keyframes]
    .reverse()
    .find((keyframe) => keyframe.frame < targetFrame && isVisibleHighlightKeyframe(keyframe));
  const targetKeyframe: HighlightKeyframe = {
    frame: targetFrame,
    provenance: previous ? 'correction' : 'manual',
    ...target,
  };

  if (!previous) {
    return {
      ...annotation,
      keyframes: [
        ...keyframes.filter((keyframe) => keyframe.frame !== targetFrame),
        targetKeyframe,
      ].sort((left, right) => left.frame - right.frame),
    };
  }

  const bridge: HighlightKeyframe[] = [];
  const span = targetFrame - previous.frame;
  for (let frame = previous.frame + 1; frame <= targetFrame; frame += 1) {
    const alpha = (frame - previous.frame) / span;
    bridge.push({
      frame: videoFrame(frame),
      provenance: frame === targetFrame ? 'correction' : 'tracked',
      cx: previous.cx + (target.cx - previous.cx) * alpha,
      cy: previous.cy + (target.cy - previous.cy) * alpha,
      radius: target.radius,
    });
  }

  return {
    ...annotation,
    source: 'corrected',
    keyframes: [
      ...keyframes.filter((keyframe) => keyframe.frame <= previous.frame || keyframe.frame > targetFrame),
      ...bridge,
    ].sort((left, right) => left.frame - right.frame),
    visibilityKeyframes: annotation.visibilityKeyframes?.filter(
      (keyframe) => keyframe.frame <= previous.frame || keyframe.frame > targetFrame,
    ),
  };
}
