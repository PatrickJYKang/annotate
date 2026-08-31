import { describe, expect, it } from 'vitest';

import { validateClip, type Clip } from '../types/clip';
import { frameBoundary, videoFrame } from './frameMath';
import { inspectClipTrim, trimClipInward } from './trimClip';

function clipFixture(): Clip {
  return {
    schema: 'clip.v2',
    id: 'sequence',
    videoId: 'video-main',
    startFrame: videoFrame(5),
    endFrame: frameBoundary(45),
    tags: { primary: null, facets: {} },
    pins: [
      { id: 'early', frame: videoFrame(7), annotations: [] },
      { id: 'middle', frame: videoFrame(15), annotations: [] },
      { id: 'late', frame: videoFrame(39), annotations: [] },
    ],
    annotations: [
      {
        id: 'moving-player',
        type: 'highlight',
        coordMode: 'image',
        source: 'corrected',
        style: { stroke: '#fff' },
        keyframes: [
          { frame: videoFrame(8), cx: 80, cy: 100, radius: 20, provenance: 'tracked' },
          { frame: videoFrame(20), cx: 200, cy: 100, radius: 20, provenance: 'tracked' },
          { frame: videoFrame(38), cx: 380, cy: 100, radius: 20, provenance: 'correction' },
        ],
        visibilityKeyframes: [
          { frame: videoFrame(40), action: 'hide' },
          { frame: videoFrame(43), action: 'show' },
        ],
      },
      {
        id: 'static-arrow',
        type: 'arrow',
        coordMode: 'image',
        source: 'manual',
        trackingAnchorId: 'moving-player',
        vertexRefs: ['moving-player', null],
        style: { stroke: '#fff' },
        keyframes: [
          { frame: videoFrame(6), x1: 10, y1: 10, x2: 40, y2: 40, provenance: 'manual' },
        ],
      },
    ],
  };
}

describe('trimClipInward', () => {
  it('crops pins and keyframes while preserving boundary geometry', () => {
    const source = clipFixture();
    const range = { startFrame: videoFrame(10), endFrame: frameBoundary(35) };
    const result = trimClipInward(source, range);

    expect(result.startFrame).toBe(10);
    expect(result.endFrame).toBe(35);
    expect(result.pins.map((pin) => pin.id)).toEqual(['middle']);
    expect(result.annotations[0].keyframes.map((keyframe) => keyframe.frame)).toEqual([10, 20, 34]);
    expect(result.annotations[0].keyframes[0]).toMatchObject({ cx: 100, cy: 100 });
    expect(result.annotations[0].keyframes.at(-1)).toMatchObject({
      cx: 340,
      cy: 100,
      provenance: 'lost',
      visible: false,
    });
    expect(result.annotations[1].keyframes.map((keyframe) => keyframe.frame)).toEqual([10, 34]);
    expect(validateClip(result)).toEqual([]);
    expect(source.startFrame).toBe(5);
    expect(source.annotations[0].keyframes.map((keyframe) => keyframe.frame)).toEqual([8, 20, 38]);
  });

  it('reports discarded authored content before applying the trim', () => {
    expect(inspectClipTrim(clipFixture(), {
      startFrame: videoFrame(10),
      endFrame: frameBoundary(35),
    })).toEqual({
      pins: 2,
      keyframes: 5,
      annotations: 0,
    });
  });

  it('preserves a hidden start without overlapping position and visibility keyframes', () => {
    const source = clipFixture();
    source.annotations[0].visibilityKeyframes = [
      { frame: videoFrame(9), action: 'hide' },
      { frame: videoFrame(18), action: 'show' },
    ];
    source.annotations[0].keyframes.push({
      frame: videoFrame(10),
      cx: 100,
      cy: 100,
      radius: 20,
      provenance: 'tracked',
    });
    source.annotations[0].keyframes.sort((left, right) => left.frame - right.frame);

    const result = trimClipInward(source, {
      startFrame: videoFrame(10),
      endFrame: frameBoundary(35),
    });
    const annotation = result.annotations[0];
    const positionFrames = new Set(annotation.keyframes.map((keyframe) => keyframe.frame));

    expect(annotation.visibilityKeyframes?.[0]).toEqual({ frame: 10, action: 'hide' });
    expect(annotation.visibilityKeyframes?.some((keyframe) => positionFrames.has(keyframe.frame))).toBe(false);
    expect(validateClip(result)).toEqual([]);
  });

  it('refuses expansion and one-frame clips', () => {
    const clip = clipFixture();
    expect(() => trimClipInward(clip, {
      startFrame: videoFrame(4),
      endFrame: frameBoundary(35),
    })).toThrow('within the current clip');
    expect(() => trimClipInward(clip, {
      startFrame: videoFrame(20),
      endFrame: frameBoundary(21),
    })).toThrow('at least two frames');
  });
});
