import type {
  ClipAnnotation,
  HighlightKeyframe,
} from '../types/clip';
import { videoFrame, type VideoFrame } from './frameMath';

export type HighlightGeometry = Pick<HighlightKeyframe, 'cx' | 'cy' | 'radius'>;

function isVisibleHighlightKeyframe(keyframe: HighlightKeyframe): boolean {
  return keyframe.visible !== false && keyframe.provenance !== 'lost';
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
