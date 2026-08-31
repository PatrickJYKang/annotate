import type { VideoFrame } from '../clip/frameMath';
import type { AnnotationAnimationStep, Annotations } from '../types/annotations';
import { parseAnnotations } from '../types/annotations';
import type { AnnotationsV1, ExportShape } from '../export/d7Render';

export interface AnnotationPayload {
  image: { width: number; height: number };
  shapes: ExportShape[];
  perspective?: { quad: { x: number; y: number }[] };
  animations?: AnnotationAnimationStep[];
}

export type AnnotationAnchor =
  | { kind: 'still'; stillId: string }
  | { kind: 'pin'; clipId: string; pinId: string; frame: VideoFrame };

export type AnnotationDocument = AnnotationsV1 | Annotations;

export interface AnnotationDocumentMetadata {
  annotationId: string;
  label?: string;
  imageFile?: string;
}

export interface ParsedAnnotationDocument {
  anchor: AnnotationAnchor;
  payload: AnnotationPayload;
  annotationId: string;
  label?: string;
  document: AnnotationDocument;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePayload(raw: Record<string, unknown>, tolerateLegacyImage = false): AnnotationPayload {
  const rawImage = isRecord(raw.image) ? raw.image : {};
  const width = typeof rawImage.width === 'number' && Number.isFinite(rawImage.width) && rawImage.width >= 0
    ? rawImage.width
    : tolerateLegacyImage ? 0 : null;
  const height = typeof rawImage.height === 'number' && Number.isFinite(rawImage.height) && rawImage.height >= 0
    ? rawImage.height
    : tolerateLegacyImage ? 0 : null;
  if (width === null || height === null || (!tolerateLegacyImage && (width === 0 || height === 0))) {
    throw new Error('Annotation image requires positive width and height.');
  }
  if (!Array.isArray(raw.shapes)) throw new Error('Annotation shapes must be an array.');
  if (raw.perspective !== undefined) {
    if (!isRecord(raw.perspective) || !Array.isArray(raw.perspective.quad) || raw.perspective.quad.length !== 4) {
      throw new Error('Annotation perspective quad must contain exactly four points.');
    }
  }
  return {
    image: { width, height },
    shapes: raw.shapes as ExportShape[],
    perspective: raw.perspective as AnnotationPayload['perspective'],
  };
}

export function toAnnotationsV1(
  payload: AnnotationPayload,
  anchor: Extract<AnnotationAnchor, { kind: 'still' }>,
  metadata: AnnotationDocumentMetadata,
): AnnotationsV1 {
  if (!metadata.imageFile) throw new Error('A v1 still annotation requires imageFile metadata.');
  return {
    schema: 'annotations.v1',
    annotationId: metadata.annotationId,
    label: metadata.label,
    stillId: anchor.stillId,
    image: {
      file: metadata.imageFile,
      width: payload.image.width,
      height: payload.image.height,
    },
    shapes: payload.shapes,
    perspective: payload.perspective,
  };
}

export function toAnnotations(
  payload: AnnotationPayload,
  anchor: Extract<AnnotationAnchor, { kind: 'pin' }>,
  metadata: AnnotationDocumentMetadata,
): Annotations {
  return {
    schema: 'annotations.v2',
    annotationId: metadata.annotationId,
    clipId: anchor.clipId,
    pinId: anchor.pinId,
    frame: anchor.frame,
    image: payload.image,
    shapes: payload.shapes,
    perspective: payload.perspective,
    animations: payload.animations,
  };
}

export function serializeAnnotationDocument(
  payload: AnnotationPayload,
  anchor: AnnotationAnchor,
  metadata: AnnotationDocumentMetadata,
): AnnotationDocument {
  return anchor.kind === 'still'
    ? toAnnotationsV1(payload, anchor, metadata)
    : toAnnotations(payload, anchor, metadata);
}

export function parseAnnotationDocument(raw: unknown): ParsedAnnotationDocument {
  if (!isRecord(raw)) throw new Error('Annotation document must be an object.');
  if (raw.schema === 'annotations.v2') {
    const document = parseAnnotations(raw);
    return {
      anchor: {
        kind: 'pin',
        clipId: document.clipId,
        pinId: document.pinId,
        frame: document.frame,
      },
      payload: {
        image: document.image,
        shapes: document.shapes,
        perspective: document.perspective,
        animations: document.animations,
      },
      annotationId: document.annotationId,
      document,
    };
  }
  if (raw.schema !== 'annotations.v1') {
    throw new Error(`Unsupported annotations schema: ${String(raw.schema)}.`);
  }
  if (typeof raw.stillId !== 'string' || !raw.stillId) {
    throw new Error('v1 annotation stillId is required.');
  }
  const payload = parsePayload(raw, true);
  const rawImage = isRecord(raw.image) ? raw.image : {};
  const document = {
    ...raw,
    image: {
      file: typeof rawImage.file === 'string' ? rawImage.file : '',
      width: payload.image.width,
      height: payload.image.height,
    },
  } as unknown as AnnotationsV1;
  return {
    anchor: { kind: 'still', stillId: raw.stillId },
    payload,
    annotationId: typeof raw.annotationId === 'string' ? raw.annotationId : 'default',
    label: typeof raw.label === 'string' ? raw.label : undefined,
    document,
  };
}

export function annotationPayloadFromDocument(document: AnnotationDocument): AnnotationPayload {
  return parseAnnotationDocument(document).payload;
}

export function annotationAnchorKey(anchor: AnnotationAnchor, annotationId: string): string {
  return anchor.kind === 'still'
    ? `still:${anchor.stillId}:${annotationId}`
    : `pin:${anchor.clipId}:${anchor.pinId}:${anchor.frame}:${annotationId}`;
}

export function annotationAnchorsEqual(left: AnnotationAnchor, right: AnnotationAnchor): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'still' && right.kind === 'still') return left.stillId === right.stillId;
  return (
    left.kind === 'pin'
    && right.kind === 'pin'
    && left.clipId === right.clipId
    && left.pinId === right.pinId
    && left.frame === right.frame
  );
}
