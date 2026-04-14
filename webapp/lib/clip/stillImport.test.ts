import { describe, expect, it } from 'vitest';

import type { AnnotationsV1 } from '../export/d7Render';
import { importStillDocumentToClip } from './stillImport';

describe('importStillDocumentToClip', () => {
  it('imports common image-space shapes as clip annotations at the requested frame', () => {
    const document: AnnotationsV1 = {
      schema: 'annotations.v1',
      stillId: 'still-a',
      image: { file: 'stills/still-a.png', width: 1920, height: 1080 },
      shapes: [
        { id: 'box-1', type: 'box', x: 10, y: 20, w: 30, h: 40, style: { stroke: '#f00', fill: '#0f0', fillOpacity: 0.2 } },
        { id: 'circle-1', type: 'circle', x: 50, y: 60, rx: 15, ry: 10, style: { stroke: '#0ff' } },
        { id: 'arrow-1', type: 'arrow', x: 0, y: 0, points: [1, 2, 30, 40], style: { stroke: '#00f' } },
        { id: 'text-1', type: 'text', x: 70, y: 80, text: 'Hello', style: { stroke: '#111', fontSize: 24 } },
        { id: 'poly-1', type: 'poly', x: 0, y: 0, points: [0, 0, 20, 0, 20, 10], closed: false, style: { stroke: '#333' } },
        { id: 'hl-1', type: 'highlight', x: 90, y: 100, rx: 25, ry: 8, style: { stroke: '#fa0', fill: '#fa0', fillOpacity: 0.3 } },
      ],
    };

    const result = importStillDocumentToClip(document, 250);

    expect(result.skipped).toBe(0);
    expect(result.annotations).toHaveLength(6);

    expect(result.annotations[0]).toMatchObject({
      type: 'box',
      coordMode: 'image',
      style: { stroke: '#f00', fill: '#0f0', fillOpacity: 0.2 },
      keyframes: [{ tMs: 250, x: 10, y: 20, w: 30, h: 40 }],
    });
    expect(result.annotations[1]).toMatchObject({
      type: 'circle',
      keyframes: [{ tMs: 250, cx: 50, cy: 60, rx: 15, ry: 10 }],
    });
    expect(result.annotations[2]).toMatchObject({
      type: 'arrow',
      keyframes: [{ tMs: 250, x1: 1, y1: 2, x2: 30, y2: 40 }],
    });
    expect(result.annotations[3]).toMatchObject({
      type: 'text',
      text: 'Hello',
      keyframes: [{ tMs: 250, x: 70, y: 80 }],
    });
    expect(result.annotations[4]).toMatchObject({
      type: 'poly',
      closed: false,
      keyframes: [{ tMs: 250, points: [[0, 0], [20, 0], [20, 10]] }],
    });
    expect(result.annotations[5]).toMatchObject({
      type: 'highlight',
      keyframes: [{ tMs: 250, cx: 90, cy: 100, radius: 25 }],
    });
  });

  it('projects plane-space shapes to image-space when perspective is available', () => {
    const document: AnnotationsV1 = {
      schema: 'annotations.v1',
      stillId: 'still-b',
      image: { file: 'stills/still-b.png', width: 100, height: 100 },
      perspective: {
        quad: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
      shapes: [
        {
          id: 'plane-box',
          type: 'box',
          x: 0,
          y: 0,
          plane: { cx: 0.5, cy: 0.5, w: 0.2, h: 0.4 },
          style: { stroke: '#fff' },
        },
      ],
    };

    const result = importStillDocumentToClip(document, 0);

    expect(result.skipped).toBe(0);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.type).toBe('poly');
    expect(result.annotations[0]?.closed).toBe(true);
    expect(result.annotations[0]?.keyframes[0]).toMatchObject({
      tMs: 0,
      points: [
        [40, 30],
        [60, 30],
        [60, 70],
        [40, 70],
      ],
    });
  });

  it('skips plane-space shapes when no perspective is available', () => {
    const document: AnnotationsV1 = {
      schema: 'annotations.v1',
      stillId: 'still-c',
      image: { file: 'stills/still-c.png', width: 100, height: 100 },
      shapes: [
        {
          id: 'plane-circle',
          type: 'circle',
          x: 0,
          y: 0,
          plane: { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2 },
        },
      ],
    };

    const result = importStillDocumentToClip(document, 100);

    expect(result.annotations).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
});
