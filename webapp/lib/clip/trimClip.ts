import type {
  Clip,
  ClipAnnotation,
  ClipKeyframe,
  ClipKeyframeProvenance,
} from '../types/clip';
import {
  frameBoundary,
  videoFrame,
  type FrameBoundary,
  type VideoFrame,
} from './frameMath';
import {
  interpolateAnnotation,
  interpolateKeyframes,
  type InterpolatedKeyframe,
} from './interpolation';
import {
  getFrameTrackingState,
  getVisibilityAction,
} from './trackingState';

export interface ClipTrimRange {
  startFrame: VideoFrame;
  endFrame: FrameBoundary;
}

export interface ClipTrimImpact {
  pins: number;
  keyframes: number;
  annotations: number;
}

function cloneKeyframe(keyframe: ClipKeyframe): ClipKeyframe {
  return structuredClone(keyframe);
}

function geometryFromInterpolated(
  value: InterpolatedKeyframe,
): Record<string, unknown> {
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

function fallbackGeometryKeyframe(
  annotation: ClipAnnotation,
  frame: VideoFrame,
): ClipKeyframe | null {
  const previous = [...annotation.keyframes]
    .reverse()
    .find((keyframe) => keyframe.frame <= frame);
  const source = previous ?? annotation.keyframes[0];
  if (!source) return null;
  const copy = cloneKeyframe(source) as ClipKeyframe & Record<string, unknown>;
  delete copy.visible;
  delete copy.provenance;
  copy.frame = frame;
  return copy;
}

function sampledKeyframe(
  annotation: ClipAnnotation,
  frame: VideoFrame,
  originalEndFrame: FrameBoundary,
): ClipKeyframe | null {
  const value = interpolateKeyframes(annotation.keyframes, frame, annotation.type);
  const manualHidden = getVisibilityAction(annotation, frame) === 'hide';
  const state = getFrameTrackingState(annotation, frame, originalEndFrame);
  const provenance: ClipKeyframeProvenance = manualHidden
    ? annotation.source === 'manual' ? 'manual' : 'tracked'
    : state;
  const visible = interpolateAnnotation(annotation, frame, originalEndFrame) !== null;
  const sampled = value
    ? {
        frame,
        provenance,
        ...geometryFromInterpolated(value),
      } as ClipKeyframe
    : fallbackGeometryKeyframe(annotation, frame);
  if (!sampled) return null;
  return !visible && !manualHidden
    ? { ...sampled, provenance: 'lost', visible: false } as ClipKeyframe
    : sampled;
}

function annotationVisibleWithin(
  annotation: ClipAnnotation,
  range: ClipTrimRange,
  originalEndFrame: FrameBoundary,
): boolean {
  const candidates = new Set<number>([
    range.startFrame,
    range.endFrame - 1,
    ...annotation.keyframes
      .filter((keyframe) => keyframe.frame >= range.startFrame && keyframe.frame < range.endFrame)
      .map((keyframe) => keyframe.frame),
    ...(annotation.visibilityKeyframes ?? [])
      .filter((keyframe) => (
        keyframe.action === 'show'
        && keyframe.frame >= range.startFrame
        && keyframe.frame < range.endFrame
      ))
      .map((keyframe) => keyframe.frame),
  ]);
  return [...candidates].some((frame) => (
    interpolateAnnotation(annotation, videoFrame(frame), originalEndFrame) !== null
  ));
}

function trimAnnotation(
  annotation: ClipAnnotation,
  range: ClipTrimRange,
  originalEndFrame: FrameBoundary,
): ClipAnnotation | null {
  if (!annotationVisibleWithin(annotation, range, originalEndFrame)) return null;

  let keyframes = annotation.keyframes
    .filter((keyframe) => keyframe.frame >= range.startFrame && keyframe.frame < range.endFrame)
    .map(cloneKeyframe);
  let visibilityKeyframes = (annotation.visibilityKeyframes ?? [])
    .filter((keyframe) => keyframe.frame >= range.startFrame && keyframe.frame < range.endFrame)
    .map((keyframe) => ({ ...keyframe }));

  const actionAtStart = getVisibilityAction(annotation, range.startFrame);
  if (actionAtStart === 'hide' && !visibilityKeyframes.some((keyframe) => keyframe.frame === range.startFrame)) {
    visibilityKeyframes.push({ frame: range.startFrame, action: 'hide' });
  }
  if (actionAtStart === 'hide') {
    keyframes = keyframes.filter((keyframe) => keyframe.frame !== range.startFrame);
  }
  if (actionAtStart !== 'hide') {
    visibilityKeyframes = visibilityKeyframes.filter((keyframe) => (
      keyframe.frame !== range.startFrame || keyframe.action !== 'show'
    ));
  }
  visibilityKeyframes.sort((left, right) => left.frame - right.frame);

  const positionFrames = new Set(keyframes.map((keyframe) => Number(keyframe.frame)));
  const visibilityFrames = new Set(visibilityKeyframes.map((keyframe) => Number(keyframe.frame)));
  const addBoundarySample = (requestedFrame: number, direction: 1 | -1) => {
    for (
      let candidate = requestedFrame;
      candidate >= range.startFrame && candidate < range.endFrame;
      candidate += direction
    ) {
      if (positionFrames.has(candidate)) return;
      if (visibilityFrames.has(candidate)) continue;
      const frame = videoFrame(candidate);
      const sample = sampledKeyframe(annotation, frame, originalEndFrame);
      if (!sample) return;
      keyframes.push(sample);
      positionFrames.add(candidate);
      return;
    }
  };

  addBoundarySample(range.startFrame, 1);
  if (range.endFrame - range.startFrame > 1) {
    addBoundarySample(range.endFrame - 1, -1);
  }
  keyframes.sort((left, right) => left.frame - right.frame);
  if (keyframes.length === 0) return null;

  return {
    ...structuredClone(annotation),
    keyframes,
    visibilityKeyframes: visibilityKeyframes.length > 0 ? visibilityKeyframes : undefined,
  };
}

function requireInwardRange(clip: Clip, range: ClipTrimRange): void {
  if (
    !Number.isInteger(range.startFrame)
    || !Number.isInteger(range.endFrame)
    || range.startFrame < clip.startFrame
    || range.endFrame > clip.endFrame
    || range.endFrame - range.startFrame < 2
  ) {
    throw new RangeError('Trim range must retain at least two frames within the current clip.');
  }
}

export function inspectClipTrim(
  clip: Clip,
  range: ClipTrimRange,
): ClipTrimImpact {
  requireInwardRange(clip, range);
  const trimmedAnnotations = clip.annotations.flatMap((annotation) => {
    const trimmed = trimAnnotation(annotation, range, clip.endFrame);
    return trimmed ? [trimmed] : [];
  });
  return {
    pins: clip.pins.filter((pin) => pin.frame < range.startFrame || pin.frame >= range.endFrame).length,
    keyframes: clip.annotations.reduce((count, annotation) => (
      count
      + annotation.keyframes.filter((keyframe) => (
        keyframe.frame < range.startFrame || keyframe.frame >= range.endFrame
      )).length
      + (annotation.visibilityKeyframes ?? []).filter((keyframe) => (
        keyframe.frame < range.startFrame || keyframe.frame >= range.endFrame
      )).length
    ), 0),
    annotations: clip.annotations.length - trimmedAnnotations.length,
  };
}

export function trimClipInward(
  clip: Clip,
  range: ClipTrimRange,
): Clip {
  requireInwardRange(clip, range);
  const annotations = clip.annotations.flatMap((annotation) => {
    const trimmed = trimAnnotation(annotation, range, clip.endFrame);
    return trimmed ? [trimmed] : [];
  });
  const annotationIds = new Set(annotations.map((annotation) => annotation.id));
  return {
    ...structuredClone(clip),
    startFrame: videoFrame(range.startFrame),
    endFrame: frameBoundary(range.endFrame),
    pins: clip.pins
      .filter((pin) => pin.frame >= range.startFrame && pin.frame < range.endFrame)
      .map((pin) => structuredClone(pin)),
    annotations: annotations.map((annotation) => ({
      ...annotation,
      trackingAnchorId: annotation.trackingAnchorId && annotationIds.has(annotation.trackingAnchorId)
        ? annotation.trackingAnchorId
        : undefined,
      vertexRefs: annotation.vertexRefs?.map((annotationId) => (
        annotationId && annotationIds.has(annotationId) ? annotationId : null
      )),
    })),
  };
}
