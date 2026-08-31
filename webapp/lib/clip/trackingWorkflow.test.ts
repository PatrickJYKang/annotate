import { describe, expect, it } from 'vitest';

import type { ClipAnnotation, HighlightKeyframe } from '../types/clip';
import { frameBoundary, videoFrame } from './frameMath';
import {
  bridgeTrackingHighlight,
  prepareTrackingTailReplacement,
  reusableTrackingHighlight,
  seedTrackingHighlightSegment,
  stopTrackingHighlightSegment,
} from './trackingWorkflow';

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

describe('reusableTrackingHighlight', () => {
  it('reuses a selected image-space highlight on an unkeyed frame', () => {
    const annotation = highlight([
      { frame: videoFrame(10), cx: 100, cy: 200, radius: 22 },
    ]);

    expect(reusableTrackingHighlight(annotation, videoFrame(14))).toBe(annotation);
  });

  it('rejects occupied frames and incompatible annotations', () => {
    const annotation = highlight([
      { frame: videoFrame(10), cx: 100, cy: 200, radius: 22 },
    ]);
    expect(reusableTrackingHighlight(annotation, videoFrame(10))).toBeNull();
    expect(reusableTrackingHighlight({
      ...annotation,
      visibilityKeyframes: [{ frame: videoFrame(14), action: 'hide' }],
    }, videoFrame(14))).toBeNull();
    expect(reusableTrackingHighlight({ ...annotation, type: 'circle' }, videoFrame(14))).toBeNull();
    expect(reusableTrackingHighlight({ ...annotation, coordMode: 'pitch' }, videoFrame(14))).toBeNull();
  });
});

describe('tracking segment boundaries', () => {
  it('builds a provisional tail replacement without mutating the saved annotations', () => {
    const player = highlight([
      { frame: videoFrame(5), cx: 50, cy: 100, radius: 22, provenance: 'tracked' },
      { frame: videoFrame(10), cx: 100, cy: 100, radius: 22, provenance: 'tracked' },
      { frame: videoFrame(15), cx: 150, cy: 100, radius: 22, provenance: 'correction' },
    ]);
    const follower: ClipAnnotation = {
      id: 'arrow',
      type: 'arrow',
      coordMode: 'image',
      source: 'corrected',
      trackingAnchorId: player.id,
      style: { stroke: '#fff' },
      keyframes: [
        { frame: videoFrame(5), x1: 50, y1: 100, x2: 200, y2: 100, provenance: 'tracked' },
        { frame: videoFrame(15), x1: 150, y1: 100, x2: 300, y2: 100, provenance: 'tracked' },
      ],
    };

    const result = prepareTrackingTailReplacement(
      [player, follower],
      player.id,
      videoFrame(10),
      frameBoundary(20),
    );

    expect(result[0].keyframes).toEqual([
      { frame: 5, cx: 50, cy: 100, radius: 22, provenance: 'tracked' },
      { frame: 10, cx: 100, cy: 100, radius: 22, provenance: 'correction' },
      { frame: 11, cx: 100, cy: 100, radius: 22, provenance: 'lost', visible: false },
    ]);
    expect(result[1].keyframes.map((keyframe) => ({
      frame: keyframe.frame,
      provenance: keyframe.provenance,
      visible: keyframe.visible,
    }))).toEqual([
      { frame: 5, provenance: 'tracked', visible: undefined },
      { frame: 10, provenance: 'correction', visible: undefined },
      { frame: 11, provenance: 'lost', visible: false },
    ]);
    expect(player.keyframes.map((keyframe) => keyframe.frame)).toEqual([5, 10, 15]);
  });

  it('preserves an earlier lost span when a selected highlight starts a new segment', () => {
    const result = seedTrackingHighlightSegment(
      highlight([
        { frame: videoFrame(5), cx: 100, cy: 200, radius: 22, provenance: 'tracked' },
        { frame: videoFrame(7), cx: 110, cy: 205, radius: 22, provenance: 'lost', visible: false },
      ]),
      videoFrame(10),
      { cx: 140, cy: 220, radius: 22 },
    );

    expect(result.keyframes).toEqual([
      { frame: 5, cx: 100, cy: 200, radius: 22, provenance: 'tracked' },
      { frame: 7, cx: 110, cy: 205, radius: 22, provenance: 'lost', visible: false },
      { frame: 10, cx: 140, cy: 220, radius: 22, provenance: 'correction' },
    ]);
  });

  it('ends a manual tracking segment with a hidden stop frame', () => {
    const result = stopTrackingHighlightSegment(
      highlight([
        { frame: videoFrame(5), cx: 100, cy: 200, radius: 22, provenance: 'manual' },
      ]),
      videoFrame(8),
      videoFrame(5),
      frameBoundary(20),
    );

    expect(result.keyframes).toEqual([
      { frame: 5, cx: 100, cy: 200, radius: 22, provenance: 'manual' },
      { frame: 7, cx: 100, cy: 200, radius: 22, provenance: 'tracked' },
      {
        frame: 8,
        cx: 100,
        cy: 200,
        radius: 22,
        provenance: 'lost',
        visible: false,
      },
    ]);
  });
});
