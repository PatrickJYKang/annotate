import type { VideoFrame } from '../clip/frameMath';
import type { ExportShape } from '../export/d7Render';

export interface AnnotationImage {
  width: number;
  height: number;
}

export interface AnnotationPerspective {
  quad: { x: number; y: number }[];
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
