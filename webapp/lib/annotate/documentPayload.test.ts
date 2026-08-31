import { describe, expect, it } from 'vitest';

import { videoFrame } from '../clip/frameMath';
import {
  annotationAnchorKey,
  annotationAnchorsEqual,
  parseAnnotationDocument,
  serializeAnnotationDocument,
  type AnnotationPayload,
} from './documentPayload';

const payload: AnnotationPayload = {
  image: { width: 1920, height: 1080 },
  shapes: [{ id: 'shape_one', type: 'highlight', x: 10, y: 20 }],
  perspective: {
    quad: [
      { x: 0, y: 0 },
      { x: 1920, y: 0 },
      { x: 1920, y: 1080 },
      { x: 0, y: 1080 },
    ],
  },
};

describe('annotation document payload', () => {
  it('round-trips a v1 still anchor without putting file identity in the payload', () => {
    const anchor = { kind: 'still', stillId: 'still_one' } as const;
    const document = serializeAnnotationDocument(payload, anchor, {
      annotationId: 'default',
      label: 'Default',
      imageFile: 'stills/still_one.png',
    });
    const parsed = parseAnnotationDocument(document);

    expect(document).toMatchObject({ schema: 'annotations.v1', stillId: 'still_one' });
    expect(parsed).toMatchObject({ anchor, annotationId: 'default', payload });
  });

  it('round-trips a v2 pin anchor over the same renderable payload', () => {
    const anchor = {
      kind: 'pin',
      clipId: 'clip_one',
      pinId: 'pin_one',
      frame: videoFrame(412),
    } as const;
    const animatedPayload: AnnotationPayload = {
      ...payload,
      animations: [{
        id: 'animation_one',
        shapeIds: ['shape_one'],
        effect: 'fade',
        trigger: 'on_click',
        delayMs: 100,
        durationMs: 400,
      }],
    };
    const document = serializeAnnotationDocument(animatedPayload, anchor, { annotationId: 'ann_one' });
    const parsed = parseAnnotationDocument(document);

    expect(document).toMatchObject({
      schema: 'annotations.v2',
      annotationId: 'ann_one',
      clipId: 'clip_one',
      pinId: 'pin_one',
      frame: 412,
    });
    expect(parsed.payload).toEqual(animatedPayload);
    expect(annotationAnchorsEqual(parsed.anchor, anchor)).toBe(true);
    expect(annotationAnchorKey(anchor, 'ann_one')).toBe('pin:clip_one:pin_one:412:ann_one');
  });

  it('rejects unknown schemas and malformed payloads with useful errors', () => {
    expect(() => parseAnnotationDocument({ schema: 'annotations.v3' })).toThrow('Unsupported annotations schema');
    expect(() => parseAnnotationDocument({
      schema: 'annotations.v1',
      stillId: 'still_one',
      image: { file: 'still.png', width: 100, height: 100 },
      shapes: 'not-an-array',
    })).toThrow('shapes must be an array');
    expect(() => parseAnnotationDocument({
      schema: 'annotations.v2',
      annotationId: 'ann',
      clipId: 'clip',
      pinId: 'pin',
      frame: 1,
      image: { width: 100, height: 100 },
      shapes: [{ id: 'shape', type: 'box', x: 0, y: 0, w: 10, h: 10 }],
      animations: [{
        id: 'bad',
        shapeIds: ['missing'],
        effect: 'fade',
        trigger: 'on_click',
        delayMs: 0,
        durationMs: 400,
      }],
    })).toThrow('references missing shape');
  });
});
