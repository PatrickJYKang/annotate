import { describe, expect, it } from 'vitest';

import type { ClipAnnotation } from '../types/clip';
import { convertTrackingKeyframes } from './bboxConvert';
import { mergeTrackedKeyframesIntoAnnotation } from './editorState';
import { frameBoundary, videoFrame } from './frameMath';
import { occlusionCacheKey } from './occlusionCompositor';
import {
  frameTemporalAdapter,
  resolveClipDrawables,
} from './renderClipAnnotations';
import {
  getCurrentKeyframe,
  getFrameTrackingState,
  getHiddenSpans,
  getNextCorrectionKeyframe,
  getVisibilityAction,
  isAnnotationVisible,
} from './trackingState';

const startFrame = videoFrame(20);
const endFrame = frameBoundary(45);

function frameAnnotation(): ClipAnnotation {
  return {
    id: 'player',
    type: 'highlight',
    coordMode: 'image',
    source: 'corrected',
    style: { stroke: '#fff', fill: '#fff' },
    keyframes: [
      { frame: videoFrame(20), cx: 100, cy: 100, radius: 20, provenance: 'tracked' },
      { frame: videoFrame(30), cx: 200, cy: 120, radius: 24, provenance: 'correction' },
      { frame: videoFrame(38), cx: 280, cy: 140, radius: 24, provenance: 'tracked' },
    ],
    visibilityKeyframes: [
      { frame: videoFrame(40), action: 'hide' },
      { frame: videoFrame(43), action: 'show' },
    ],
  };
}

describe('frame-native clip domain', () => {
  it('renders interpolated frame samples on the absolute source axis', () => {
    const annotation: ClipAnnotation = {
      id: 'box',
      type: 'box',
      coordMode: 'image',
      source: 'manual',
      style: { stroke: '#fff', strokeWidth: 5 },
      keyframes: [
        { frame: videoFrame(20), x: 10, y: 20, w: 30, h: 40 },
        { frame: videoFrame(30), x: 50, y: 60, w: 70, h: 80 },
      ],
    };

    expect(resolveClipDrawables([annotation], 25, frameTemporalAdapter(endFrame))).toEqual([
      expect.objectContaining({ id: 'box', kind: 'box', x: 30, y: 40, w: 50, h: 60 }),
    ]);
  });

  it('uses absolute frames for visibility, correction lookup, and conservative tracking gaps', () => {
    const annotation = frameAnnotation();

    expect(getCurrentKeyframe(annotation, videoFrame(30))?.frame).toBe(30);
    expect(getNextCorrectionKeyframe(annotation, startFrame)?.frame).toBe(30);
    expect(getFrameTrackingState(annotation, videoFrame(25), endFrame)).toBe('lost');
    expect(getFrameTrackingState(annotation, videoFrame(30), endFrame)).toBe('correction');
    expect(getHiddenSpans(annotation, endFrame)).toEqual([
      { startFrame: 20, endFrame: 38 },
      { startFrame: 40, endFrame: 43 },
    ]);
    expect(getVisibilityAction(annotation, videoFrame(41))).toBe('hide');
    expect(isAnnotationVisible(annotation, videoFrame(41))).toBe(false);
    expect(isAnnotationVisible(annotation, videoFrame(43))).toBe(true);
  });

  it('merges a tracked range without converting absolute frames to clip-relative values', () => {
    const annotation = frameAnnotation();
    const result = mergeTrackedKeyframesIntoAnnotation(annotation, [
      { frame: videoFrame(23), cx: 130, cy: 104, radius: 20 },
      { frame: videoFrame(27), cx: 170, cy: 112, radius: 22 },
      { frame: videoFrame(30), cx: 199, cy: 119, radius: 24 },
    ], {
      mergeMode: 'to_correction',
      currentFrame: videoFrame(23),
      rangeEndFrame: videoFrame(30),
      clipEndFrame: endFrame,
    });

    expect(result.keyframes.map((keyframe) => keyframe.frame)).toEqual([20, 23, 27, 30, 38]);
    expect(result.keyframes.find((keyframe) => keyframe.frame === 30)?.provenance).toBe('correction');
    expect(result.keyframes.find((keyframe) => keyframe.frame === 23)?.provenance).toBe('tracked');
  });

  it('maps sidecar milliseconds to canonical source frames and coalesces duplicate samples', () => {
    const keyframes = convertTrackingKeyframes([
      { tMs: 800, bbox: { x: 10, y: 20, w: 30, h: 40 } },
      { tMs: 810, bbox: { x: 11, y: 21, w: 30, h: 40 } },
      { tMs: 1200, bbox: { x: 20, y: 30, w: 30, h: 40 } },
    ], 'highlight', 25, 100);

    expect(keyframes.map((keyframe) => keyframe.frame)).toEqual([20, 30]);
    expect(keyframes[0]).toMatchObject({ frame: 20, cx: 26 });
    expect('tMs' in keyframes[0]).toBe(false);
  });

  it('keys occlusion masks by canonical frame rather than rounded milliseconds', () => {
    expect(occlusionCacheKey(videoFrame(37))).toBe(37);
  });
});
