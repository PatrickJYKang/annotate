import { describe, expect, it } from 'vitest';

import type { Annotations } from '../types/annotations';
import type { ClipAnnotation } from '../types/clip';
import { videoFrame } from './frameMath';
import { applyPinImportToClip, importPinDocumentToClip } from './pinImport';

function document(shapes: Annotations['shapes']): Annotations {
  return {
    schema: 'annotations.v2',
    annotationId: 'pin-document',
    clipId: 'clip-a',
    pinId: 'pin-a',
    frame: videoFrame(42),
    image: { width: 1920, height: 1080 },
    shapes,
  };
}

describe('importPinDocumentToClip', () => {
  it('imports every tactical shape onto one absolute frame and remaps linked highlights', () => {
    const result = importPinDocumentToClip(document([
      { id: 'box', type: 'box', x: 10, y: 20, w: 30, h: 40, style: { stroke: '#f00' } },
      { id: 'circle', type: 'circle', x: 50, y: 60, rx: 12, ry: 8 },
      { id: 'highlight', type: 'highlight', x: 100, y: 120, rx: 24, ry: 8 },
      { id: 'shadow', type: 'shadow', x: 100, y: 120, r: 80, rotation: 0.2, spreadDeg: 45, vertexRefs: ['highlight'] },
      { id: 'arrow', type: 'arrow', x: 0, y: 0, points: [100, 120, 300, 200], vertexRefs: ['highlight', null] },
      { id: 'lob', type: 'lob', x: 0, y: 0, points: [100, 120, 200, 80, 300, 200], vertexRefs: ['highlight', null] },
      { id: 'poly', type: 'poly', x: 0, y: 0, points: [100, 120, 200, 120, 220, 180], vertexRefs: ['highlight', null, null], closed: false },
      { id: 'text', type: 'text', x: 400, y: 200, text: 'Press' },
    ]), videoFrame(42));

    expect(result.skipped).toBe(0);
    expect(result.annotations.map((annotation) => annotation.type)).toEqual([
      'box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly', 'text',
    ]);
    expect(result.annotations.every((annotation) => annotation.keyframes[0].frame === 42)).toBe(true);
    expect(result.annotations.every((annotation) => !('tMs' in annotation.keyframes[0]))).toBe(true);
    const highlight = result.annotations.find((annotation) => annotation.type === 'highlight')!;
    expect(result.annotations.find((annotation) => annotation.type === 'shadow')?.vertexRefs).toEqual([highlight.id]);
    expect(result.annotations.find((annotation) => annotation.type === 'arrow')?.vertexRefs).toEqual([highlight.id, null]);
    expect(result.annotations.find((annotation) => annotation.type === 'lob')?.vertexRefs).toEqual([highlight.id, null]);
    expect(result.annotations.find((annotation) => annotation.type === 'poly')?.vertexRefs).toEqual([highlight.id, null, null]);
    expect(new Set(result.annotations.map((annotation) => annotation.id)).size).toBe(result.annotations.length);
    expect(result.annotations.some((annotation) => annotation.id === 'highlight')).toBe(false);
  });

  it('projects plane shapes through the document perspective and skips them without one', () => {
    const planeBox = {
      id: 'plane-box',
      type: 'box' as const,
      x: 0,
      y: 0,
      plane: { cx: 0.5, cy: 0.5, w: 0.2, h: 0.4 },
    };
    const withPerspective = document([planeBox]);
    withPerspective.perspective = {
      quad: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    };

    const projected = importPinDocumentToClip(withPerspective, videoFrame(42));
    expect(projected.annotations[0]).toMatchObject({
      type: 'poly',
      coordMode: 'image',
      closed: true,
      keyframes: [{ frame: 42, points: [[40, 30], [60, 30], [60, 70], [40, 70]] }],
    });
    expect(importPinDocumentToClip(document([planeBox]), videoFrame(42))).toMatchObject({
      annotations: [],
      skipped: 1,
    });
  });

  it('appends repeated imports without replacing existing frame geometry', () => {
    const existing: ClipAnnotation[] = [{
      id: 'existing',
      type: 'box',
      coordMode: 'image',
      source: 'manual',
      style: {},
      keyframes: [{ frame: videoFrame(42), x: 0, y: 0, w: 10, h: 10 }],
    }];
    const first = importPinDocumentToClip(document([
      { id: 'text', type: 'text', x: 10, y: 20, text: 'A' },
    ]), videoFrame(42));
    const applied = applyPinImportToClip(existing, first.annotations, videoFrame(42));

    expect(applied).toMatchObject({ existingAtFrameCount: 1, importedCount: 1, resolution: 'append' });
    expect(applied.annotations).toHaveLength(2);
    expect(applied.annotations[0].id).toBe('existing');
  });
});
