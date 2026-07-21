import { describe, expect, it } from 'vitest';

import { frameBoundary, videoFrame } from '../clip/frameMath';
import type { Annotations } from './annotations';
import type { Clip } from './clip';
import {
  canonicalPinAnnotationPath,
  parseClip,
  validateClip,
} from './clip';
import {
  createDefaultPresentation,
  type Presentation,
} from './presentation';
import type { ProjectManifest } from './project';

const canonicalClip = {
  schema: 'clip.v2',
  id: 'clip_demo',
  videoId: 'video_demo',
  label: 'Counter press regain',
  startFrame: videoFrame(120),
  endFrame: frameBoundary(180),
  tags: {
    primary: 'in_possession.build_up',
    facets: { 'zone.vertical_third': ['middle_third'] },
  },
  pins: [
    {
      id: 'pin_regain',
      frame: videoFrame(145),
      label: 'Regain moment',
      annotations: [
        {
          id: 'ann_default',
          file: canonicalPinAnnotationPath('ann_default'),
          role: 'default',
        },
      ],
    },
  ],
  annotations: [
    {
      id: 'animated_highlight',
      type: 'highlight',
      coordMode: 'image',
      source: 'auto',
      style: { stroke: '#ffffff', strokeWidth: 4 },
      keyframes: [
        {
          frame: videoFrame(125),
          cx: 812.4,
          cy: 511,
          radius: 38,
          provenance: 'tracked',
        },
      ],
      visibilityKeyframes: [{ frame: videoFrame(170), action: 'hide' }],
    },
  ],
} satisfies Clip;

const canonicalAnnotation = {
  schema: 'annotations.v2',
  annotationId: 'ann_default',
  clipId: canonicalClip.id,
  pinId: canonicalClip.pins[0].id,
  frame: canonicalClip.pins[0].frame,
  image: { width: 1920, height: 1080 },
  shapes: [],
  perspective: {
    quad: [
      { x: 100, y: 100 },
      { x: 1820, y: 100 },
      { x: 1820, y: 980 },
      { x: 100, y: 980 },
    ],
  },
} satisfies Annotations;

function cloneClip(): Clip {
  return structuredClone(canonicalClip) as Clip;
}

describe('v2 canonical types', () => {
  it('constructs the canonical project, clip, annotation, and presentation documents', () => {
    const project = {
      schema: 'project.v2',
      name: 'Demo project',
      created: '2026-07-11T00:00:00.000Z',
      videos: [
        {
          id: canonicalClip.videoId,
          label: 'First half',
          file: 'media/first-half.mp4',
          fps: 30,
          frameCount: frameBoundary(81_000),
          frameCountSource: 'normalize',
          width: 1920,
          height: 1080,
        },
      ],
    } satisfies ProjectManifest;

    const presentation = {
      schema: 2,
      id: 'presentation_demo',
      name: 'Breaking the first press',
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      slides: [
        {
          id: 'slide_clip',
          kind: 'clip',
          clipId: canonicalClip.id,
          pausePins: null,
          pauseCues: [{ pinId: canonicalClip.pins[0].id, holdMs: 2500 }],
        },
        {
          id: 'slide_pin',
          kind: 'pin',
          clipId: canonicalClip.id,
          pinId: canonicalClip.pins[0].id,
          showAnnotations: true,
          annotationIds: [canonicalAnnotation.annotationId],
        },
      ],
      transitions: [{ mode: 'cut' }],
    } satisfies Presentation;

    expect(project.videos[0].frameCountSource).toBe('normalize');
    expect(validateClip(canonicalClip, { folderId: canonicalClip.id })).toEqual([]);
    expect(canonicalAnnotation.image).toEqual({ width: 1920, height: 1080 });
    expect(presentation.transitions).toHaveLength(presentation.slides.length - 1);
  });

  it('creates an empty presentation with deterministic timestamps', () => {
    const created = createDefaultPresentation(
      'Review',
      'presentation_review',
      new Date('2026-07-11T12:00:00.000Z'),
    );

    expect(created).toMatchObject({
      schema: 2,
      createdAt: '2026-07-11T12:00:00.000Z',
      updatedAt: '2026-07-11T12:00:00.000Z',
      slides: [],
      transitions: [],
    });
  });
});

describe('validateClip', () => {
  it('reports folder identity and malformed half-open ranges', () => {
    const clip = cloneClip();
    clip.endFrame = frameBoundary(120);

    expect(validateClip(clip, { folderId: 'somewhere_else' }).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['folder-id-mismatch', 'invalid-range']),
    );
  });

  it('rejects malformed frame-native annotation payloads at parse time', () => {
    const malformed = cloneClip() as unknown as Record<string, any>;
    malformed.annotations[0].type = 'mystery';
    expect(() => parseClip(malformed)).toThrow('annotations[0] is invalid');

    const invalidGeometry = cloneClip() as unknown as Record<string, any>;
    delete invalidGeometry.annotations[0].keyframes[0].radius;
    expect(() => parseClip(invalidGeometry)).toThrow('radius must be a finite number');

    const invalidTag = cloneClip() as unknown as Record<string, any>;
    invalidTag.tags.facets['../escape'] = 'value';
    expect(() => parseClip(invalidTag)).toThrow('Invalid facet group id');
  });

  it('enforces unique, sorted, in-range pins with one default document', () => {
    const clip = cloneClip();
    clip.pins.push({
      id: clip.pins[0].id,
      frame: clip.pins[0].frame,
      annotations: [
        { id: 'ann_second', file: 'annotations/ann_second.json', role: 'default' },
        { id: 'ann_third', file: 'annotations/ann_third.json', role: 'default' },
      ],
    });
    clip.pins.push({ id: 'pin_earlier', frame: videoFrame(119), annotations: [] });

    expect(validateClip(clip).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'duplicate-pin-id',
        'duplicate-pin-frame',
        'multiple-default-annotations',
        'unsorted-pins',
        'pin-out-of-range',
      ]),
    );
  });

  it('enforces clip-wide annotation ids and canonical confined paths', () => {
    const clip = cloneClip();
    clip.pins[0].annotations.push({
      id: clip.annotations[0].id,
      file: '../outside.json',
      role: 'alternate',
    });

    expect(validateClip(clip).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['duplicate-annotation-id', 'invalid-annotation-path']),
    );
  });

  it('enforces absolute, ordered, non-overlapping keyframe lanes', () => {
    const clip = cloneClip();
    clip.annotations[0].keyframes.push(
      { frame: videoFrame(125), cx: 1, cy: 2, radius: 3 },
      { frame: videoFrame(119), cx: 1, cy: 2, radius: 3 },
    );
    clip.annotations[0].visibilityKeyframes = [
      { frame: videoFrame(125), action: 'hide' },
      { frame: videoFrame(125), action: 'show' },
    ];

    expect(validateClip(clip).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'duplicate-keyframe-frame',
        'unsorted-keyframes',
        'keyframe-out-of-range',
        'overlapping-keyframe-kinds',
      ]),
    );
  });
});
