import type {
  ClipAnnotation,
  ClipKeyframe,
  HighlightKeyframe,
} from '../types/clip';
import {
  videoFrame,
  type FrameBoundary,
  type VideoFrame,
} from './frameMath';
import { interpolateAnnotation, interpolateKeyframes } from './interpolation';
import type { InterpolatedKeyframe } from './interpolation';

export type HighlightGeometry = Pick<HighlightKeyframe, 'cx' | 'cy' | 'radius'>;

function geometryFromInterpolated(value: InterpolatedKeyframe): Record<string, unknown> {
  switch (value.type) {
    case 'box':
      return { x: value.x, y: value.y, w: value.w, h: value.h, rotation: value.rotation };
    case 'circle':
      return { cx: value.cx, cy: value.cy, rx: value.rx, ry: value.ry, rotation: value.rotation };
    case 'shadow':
      return {
        x: value.x,
        y: value.y,
        r: value.r,
        rotation: value.rotation,
        spreadDeg: value.spreadDeg,
      };
    case 'arrow':
      return { x1: value.x1, y1: value.y1, x2: value.x2, y2: value.y2 };
    case 'lob':
      return {
        x1: value.x1,
        y1: value.y1,
        cx: value.cx,
        cy: value.cy,
        x2: value.x2,
        y2: value.y2,
      };
    case 'text':
      return { x: value.x, y: value.y };
    case 'poly':
      return { points: value.points.map((point) => [...point] as [number, number]) };
    case 'highlight':
      return { cx: value.cx, cy: value.cy, radius: value.radius };
  }
}

function truncateTrackedAnnotation(
  annotation: ClipAnnotation,
  frame: VideoFrame,
  clipEndFrame: FrameBoundary,
): ClipAnnotation {
  const value = interpolateKeyframes(annotation.keyframes, frame, annotation.type);
  if (!value) return annotation;
  const current: ClipKeyframe = {
    frame,
    provenance: 'correction',
    ...geometryFromInterpolated(value),
  } as ClipKeyframe;
  const keyframes = [
    ...annotation.keyframes.filter((keyframe) => keyframe.frame < frame),
    current,
  ];
  if (frame + 1 < clipEndFrame) {
    keyframes.push({
      ...current,
      frame: videoFrame(frame + 1),
      provenance: 'lost',
      visible: false,
    } as ClipKeyframe);
  }
  return {
    ...annotation,
    source: 'corrected',
    keyframes,
    visibilityKeyframes: annotation.visibilityKeyframes?.filter(
      (keyframe) => keyframe.frame < frame,
    ),
  };
}

/** Build an unsaved working copy whose selected tracking tail can be reacquired. */
export function prepareTrackingTailReplacement(
  annotations: ClipAnnotation[],
  annotationId: string,
  frame: VideoFrame,
  clipEndFrame: FrameBoundary,
): ClipAnnotation[] {
  const selected = annotations.find((annotation) => annotation.id === annotationId);
  if (!selected || selected.type !== 'highlight' || selected.coordMode !== 'image') {
    return annotations;
  }
  return annotations.map((annotation) => (
    annotation.id === annotationId || annotation.trackingAnchorId === annotationId
      ? truncateTrackedAnnotation(annotation, frame, clipEndFrame)
      : annotation
  ));
}

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
