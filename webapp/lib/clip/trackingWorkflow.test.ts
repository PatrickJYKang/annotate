import { describe, expect, it } from 'vitest';

import type { ClipAnnotation, HighlightKeyframe } from '../types/clip';
import { videoFrame } from './frameMath';
import { bridgeTrackingHighlight } from './trackingWorkflow';

function highlight(keyframes: HighlightKeyframe[]): ClipAnnotation {
  return {
    id: 'player',
    type: 'highlight',
    coordMode: 'image',
    source: 'auto',
    style: { stroke: '#fff', fill: '#fff', strokeWidth: 4 },
    keyframes,
  };
}

describe('bridgeTrackingHighlight', () => {
  it('fills every empty frame between the trusted path and a reacquisition', () => {
    const result = bridgeTrackingHighlight(
      highlight([{ frame: videoFrame(10), cx: 100, cy: 200, radius: 22, provenance: 'tracked' }]),
      videoFrame(14),
      { cx: 140, cy: 220, radius: 22 },
    );
    const keyframes = result.keyframes as HighlightKeyframe[];

    expect(keyframes.map((keyframe) => keyframe.frame)).toEqual([10, 11, 12, 13, 14]);
    expect(keyframes.map((keyframe) => keyframe.cx)).toEqual([100, 110, 120, 130, 140]);
    expect(keyframes.map((keyframe) => keyframe.cy)).toEqual([200, 205, 210, 215, 220]);
    expect(keyframes.map((keyframe) => keyframe.radius)).toEqual([22, 22, 22, 22, 22]);
    expect(keyframes.map((keyframe) => keyframe.provenance)).toEqual([
      'tracked', 'tracked', 'tracked', 'tracked', 'correction',
    ]);
    expect(result.source).toBe('corrected');
  });

  it('replaces stale lost keyframes inside the repaired gap', () => {
    const result = bridgeTrackingHighlight(
      highlight([
        { frame: videoFrame(10), cx: 100, cy: 200, radius: 22, provenance: 'tracked' },
        { frame: videoFrame(11), cx: 0, cy: 0, radius: 22, provenance: 'lost', visible: false },
        { frame: videoFrame(12), cx: 0, cy: 0, radius: 22, provenance: 'lost', visible: false },
      ]),
      videoFrame(13),
      { cx: 130, cy: 215, radius: 22 },
    );

    expect(result.keyframes.map((keyframe) => ({
      frame: keyframe.frame,
      visible: keyframe.visible,
      provenance: keyframe.provenance,
    }))).toEqual([
      { frame: 10, visible: undefined, provenance: 'tracked' },
      { frame: 11, visible: undefined, provenance: 'tracked' },
      { frame: 12, visible: undefined, provenance: 'tracked' },
      { frame: 13, visible: undefined, provenance: 'correction' },
    ]);
  });

  it('adds a single manual seed when there is no earlier observation', () => {
    const result = bridgeTrackingHighlight(
      highlight([]),
      videoFrame(8),
      { cx: 80, cy: 90, radius: 20 },
    );

    expect(result.keyframes).toEqual([
      { frame: 8, cx: 80, cy: 90, radius: 20, provenance: 'manual' },
    ]);
  });
});
