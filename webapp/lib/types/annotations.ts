import type { VideoFrame } from '../clip/frameMath';
import type { ExportShape } from '../export/d7Render';

export interface AnnotationImage {
  width: number;
  height: number;
}

export interface AnnotationPerspective {
  quad: { x: number; y: number }[];
}

export const annotationAnimationEffects = ['appear', 'fade', 'grow', 'wipe'] as const;
export type AnnotationAnimationEffect = typeof annotationAnimationEffects[number];

export const annotationAnimationTriggers = ['on_click', 'with_previous', 'after_previous'] as const;
export type AnnotationAnimationTrigger = typeof annotationAnimationTriggers[number];

export interface AnnotationAnimationStep {
  id: string;
  shapeIds: string[];
  effect: AnnotationAnimationEffect;
  trigger: AnnotationAnimationTrigger;
  delayMs: number;
  durationMs: number;
}

export interface Annotations {
  schema: 'annotations.v2';
  annotationId: string;
  clipId: string;
  pinId: string;
  frame: VideoFrame;
  image: AnnotationImage;
  shapes: ExportShape[];
  perspective?: AnnotationPerspective;
  animations?: AnnotationAnimationStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAnnotations(raw: unknown): Annotations {
  if (!isRecord(raw) || raw.schema !== 'annotations.v2') {
    throw new Error('Annotation document schema must be "annotations.v2".');
  }
  for (const field of ['annotationId', 'clipId', 'pinId'] as const) {
    if (typeof raw[field] !== 'string' || !raw[field]) {
      throw new Error(`Annotation document ${field} is required.`);
    }
  }
  if (typeof raw.frame !== 'number' || !Number.isInteger(raw.frame) || raw.frame < 0) {
    throw new Error('Annotation document frame must be a non-negative integer.');
  }
  if (
    !isRecord(raw.image)
    || typeof raw.image.width !== 'number'
    || typeof raw.image.height !== 'number'
    || !Number.isFinite(raw.image.width)
    || !Number.isFinite(raw.image.height)
    || raw.image.width <= 0
    || raw.image.height <= 0
  ) {
    throw new Error('Annotation document image requires positive width and height.');
  }
  if (!Array.isArray(raw.shapes)) throw new Error('Annotation document shapes must be an array.');
  if (raw.animations !== undefined) {
    if (!Array.isArray(raw.animations)) throw new Error('Annotation document animations must be an array.');
    const shapeIds = new Set(raw.shapes.flatMap((shape) => (
      isRecord(shape) && typeof shape.id === 'string' ? [shape.id] : []
    )));
    const animationIds = new Set<string>();
    const animatedShapeIds = new Set<string>();
    raw.animations.forEach((animation, index) => {
      if (!isRecord(animation)) throw new Error(`Annotation animation ${index} must be an object.`);
      if (typeof animation.id !== 'string' || !animation.id) {
        throw new Error(`Annotation animation ${index} requires an id.`);
      }
      if (animationIds.has(animation.id)) throw new Error(`Annotation animation id "${animation.id}" is duplicated.`);
      animationIds.add(animation.id);
      if (!Array.isArray(animation.shapeIds) || animation.shapeIds.length === 0) {
        throw new Error(`Annotation animation "${animation.id}" requires at least one shape.`);
      }
      const localShapeIds = new Set<string>();
      animation.shapeIds.forEach((shapeId) => {
        if (typeof shapeId !== 'string' || !shapeId) {
          throw new Error(`Annotation animation "${animation.id}" contains an invalid shape id.`);
        }
        if (!shapeIds.has(shapeId)) {
          throw new Error(`Annotation animation "${animation.id}" references missing shape "${shapeId}".`);
        }
        if (localShapeIds.has(shapeId)) {
          throw new Error(`Annotation animation "${animation.id}" repeats shape "${shapeId}".`);
        }
        if (animatedShapeIds.has(shapeId)) {
          throw new Error(`Annotation shape "${shapeId}" has more than one entrance animation.`);
        }
        localShapeIds.add(shapeId);
        animatedShapeIds.add(shapeId);
      });
      if (!annotationAnimationEffects.includes(animation.effect as AnnotationAnimationEffect)) {
        throw new Error(`Annotation animation "${animation.id}" has an unsupported effect.`);
      }
      if (!annotationAnimationTriggers.includes(animation.trigger as AnnotationAnimationTrigger)) {
        throw new Error(`Annotation animation "${animation.id}" has an unsupported trigger.`);
      }
      for (const field of ['delayMs', 'durationMs'] as const) {
        if (
          typeof animation[field] !== 'number'
          || !Number.isFinite(animation[field])
          || animation[field] < 0
        ) {
          throw new Error(`Annotation animation "${animation.id}" ${field} must be a non-negative number.`);
        }
      }
    });
  }
  if (raw.perspective !== undefined) {
    if (!isRecord(raw.perspective) || !Array.isArray(raw.perspective.quad) || raw.perspective.quad.length !== 4) {
      throw new Error('Annotation perspective quad must contain exactly four points.');
    }
    raw.perspective.quad.forEach((point, index) => {
      if (
        !isRecord(point)
        || typeof point.x !== 'number'
        || typeof point.y !== 'number'
        || !Number.isFinite(point.x)
        || !Number.isFinite(point.y)
      ) {
        throw new Error(`Annotation perspective point ${index} is invalid.`);
      }
    });
  }
  return raw as unknown as Annotations;
}
