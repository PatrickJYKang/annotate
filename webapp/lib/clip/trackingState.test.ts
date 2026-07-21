import { describe, expect, it } from 'vitest';

import type { ClipAnnotation } from '../types/clip';
import { frameBoundary, videoFrame } from './frameMath';
import {
  countCorrectionKeyframes,
  getCurrentKeyframe,
  getCurrentVisibilityKeyframe,
  getFrameTrackingState,
  getHiddenSpans,
  getNextCorrectionKeyframe,
  getVisibilityAction,
  isAnnotationVisible,
  isFrameWithinHiddenSpan,
} from './trackingState';

function trackedAnnotation(): ClipAnnotation {
  return {
    id: 'tracked',
    type: 'highlight',
    coordMode: 'image',
    source: 'corrected',
    style: {},
    keyframes: [
      { frame: videoFrame(10), cx: 10, cy: 10, radius: 5, provenance: 'tracked' },
      { frame: videoFrame(20), cx: 20, cy: 10, radius: 5, provenance: 'lost', visible: false },
      { frame: videoFrame(30), cx: 30, cy: 10, radius: 5, provenance: 'correction' },
      { frame: videoFrame(40), cx: 40, cy: 10, radius: 5, provenance: 'tracked' },
    ],
    visibilityKeyframes: [
      { frame: videoFrame(42), action: 'hide' },
      { frame: videoFrame(46), action: 'show' },
    ],
  };
}

describe('frame-native tracking state', () => {
  it('resolves exact keyframes and correction boundaries', () => {
    const annotation = trackedAnnotation();
    expect(getCurrentKeyframe(annotation, videoFrame(30))?.frame).toBe(30);
    expect(getNextCorrectionKeyframe(annotation, videoFrame(10))?.frame).toBe(30);
    expect(countCorrectionKeyframes(annotation)).toBe(1);
    expect(getFrameTrackingState(annotation, videoFrame(10), frameBoundary(50))).toBe('tracked');
    expect(getFrameTrackingState(annotation, videoFrame(20), frameBoundary(50))).toBe('lost');
    expect(getFrameTrackingState(annotation, videoFrame(30), frameBoundary(50))).toBe('correction');
  });

  it('merges lost, sparse, and manual visibility spans on one frame axis', () => {
    const annotation = trackedAnnotation();
    const spans = getHiddenSpans(annotation, frameBoundary(50));
    expect(spans).toEqual([
      { startFrame: 20, endFrame: 40 },
      { startFrame: 42, endFrame: 46 },
    ]);
    expect(isFrameWithinHiddenSpan(spans, videoFrame(25))).toBe(true);
    expect(isFrameWithinHiddenSpan(spans, videoFrame(35))).toBe(true);
    expect(isFrameWithinHiddenSpan(spans, videoFrame(41))).toBe(false);
  });

  it('applies show and hide events independently of geometry keyframes', () => {
    const annotation = trackedAnnotation();
    expect(getCurrentVisibilityKeyframe(annotation, videoFrame(42))?.action).toBe('hide');
    expect(getVisibilityAction(annotation, videoFrame(41))).toBeNull();
    expect(getVisibilityAction(annotation, videoFrame(44))).toBe('hide');
    expect(isAnnotationVisible(annotation, videoFrame(44))).toBe(false);
    expect(isAnnotationVisible(annotation, videoFrame(46))).toBe(true);
  });

  it('treats a long tracked interval as lost while allowing short intervals', () => {
    const annotation: ClipAnnotation = {
      ...trackedAnnotation(),
      keyframes: [
        { frame: videoFrame(0), cx: 0, cy: 0, radius: 5, provenance: 'tracked' },
        { frame: videoFrame(5), cx: 5, cy: 0, radius: 5, provenance: 'tracked' },
        { frame: videoFrame(20), cx: 20, cy: 0, radius: 5, provenance: 'correction' },
      ],
      visibilityKeyframes: [],
    };
    expect(getFrameTrackingState(annotation, videoFrame(3), frameBoundary(30))).toBe('tracked');
    expect(getFrameTrackingState(annotation, videoFrame(12), frameBoundary(30))).toBe('lost');
    expect(getFrameTrackingState(annotation, videoFrame(20), frameBoundary(30))).toBe('correction');
  });
});
