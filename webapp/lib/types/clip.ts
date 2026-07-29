import type { FrameBoundary, VideoFrame } from '../clip/frameMath';
import type { TaggingSelection } from '../tagging/selection';

export type CoordMode = 'image' | 'pitch';
export type AnnotationSource = 'manual' | 'auto' | 'corrected';
export type ClipKeyframeProvenance = 'manual' | 'tracked' | 'lost' | 'correction';
export type ClipVisibilityAction = 'show' | 'hide';
export type ClipAnnotationType =
  | 'box'
  | 'circle'
  | 'shadow'
  | 'arrow'
  | 'lob'
  | 'text'
  | 'poly'
  | 'highlight';
export type StrokePattern = 'solid' | 'dashed' | 'dotted' | 'dashdot';

interface FrameKeyframeBase {
  frame: VideoFrame;
  visible?: boolean;
  provenance?: ClipKeyframeProvenance;
}

export interface BoxKeyframe extends FrameKeyframeBase { x: number; y: number; w: number; h: number; rotation?: number }
export interface BoxQuadKeyframe extends FrameKeyframeBase { points: [number, number][] }
export interface CircleKeyframe extends FrameKeyframeBase { cx: number; cy: number; rx: number; ry: number; rotation?: number }
export interface ShadowKeyframe extends FrameKeyframeBase { x: number; y: number; r: number; rotation: number; spreadDeg: number }
export interface ArrowKeyframe extends FrameKeyframeBase { x1: number; y1: number; x2: number; y2: number }
export interface LobKeyframe extends FrameKeyframeBase { x1: number; y1: number; cx: number; cy: number; x2: number; y2: number }
export interface TextKeyframe extends FrameKeyframeBase { x: number; y: number }
export interface PolyKeyframe extends FrameKeyframeBase { points: [number, number][] }
export interface HighlightKeyframe extends FrameKeyframeBase { cx: number; cy: number; radius: number }

export type ClipKeyframe =
  | BoxKeyframe
  | BoxQuadKeyframe
  | CircleKeyframe
  | ShadowKeyframe
  | ArrowKeyframe
  | LobKeyframe
  | TextKeyframe
  | PolyKeyframe
  | HighlightKeyframe;

export interface ClipVisibilityKeyframe {
  frame: VideoFrame;
  action: ClipVisibilityAction;
}

export interface ClipAnnotationStyle {
  stroke?: string;
  fill?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  strokePattern?: StrokePattern;
  fontSize?: number;
  fontFamily?: string;
  textHighlight?: boolean;
}

export interface ClipAnnotation {
  id: string;
  type: ClipAnnotationType;
  name?: string;
  displayName?: boolean;
  coordMode: CoordMode;
  source: AnnotationSource;
  trackingAnchorId?: string | null;
  vertexRefs?: (string | null)[];
  text?: string;
  closed?: boolean;
  style: ClipAnnotationStyle;
  keyframes: ClipKeyframe[];
  visibilityKeyframes?: ClipVisibilityKeyframe[];
}

export type PinAnnotationRole = 'default' | 'alternate';

export interface PinAnnotationRef {
  id: string;
  file: string;
  role: PinAnnotationRole;
  label?: string;
}

export interface ClipPin {
  id: string;
  frame: VideoFrame;
  label?: string;
  annotations: PinAnnotationRef[];
}

export interface Clip {
  schema: 'clip.v2';
  id: string;
  videoId: string;
  startFrame: VideoFrame;
  endFrame: FrameBoundary;
  label?: string;
  tags: TaggingSelection;
  pins: ClipPin[];
  annotations: ClipAnnotation[];
}

export type ClipIssueCode =
  | 'invalid-id'
  | 'folder-id-mismatch'
  | 'invalid-range'
  | 'duplicate-pin-id'
  | 'duplicate-pin-frame'
  | 'unsorted-pins'
  | 'pin-out-of-range'
  | 'duplicate-annotation-id'
  | 'invalid-annotation-path'
  | 'multiple-default-annotations'
  | 'keyframe-out-of-range'
  | 'duplicate-keyframe-frame'
  | 'unsorted-keyframes'
  | 'overlapping-keyframe-kinds';

export interface ClipIssue {
  code: ClipIssueCode;
  path: string;
  message: string;
}

export interface ValidateClipOptions {
  folderId?: string;
}

export class ClipValidationError extends Error {
  readonly issues: ClipIssue[];

  constructor(issues: ClipIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'ClipValidationError';
    this.issues = issues;
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeClipIdSegment(value: string): boolean {
  return SAFE_ID.test(value);
}

export function canonicalPinAnnotationPath(annotationId: string): string {
  return `annotations/${annotationId}.json`;
}

export function isSafePinAnnotationPath(file: string, annotationId: string): boolean {
  if (!file || file.startsWith('/') || file.startsWith('\\')) return false;
  if (file.includes('\\') || file.includes('\0')) return false;
  const segments = file.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return file === canonicalPinAnnotationPath(annotationId);
}

function isFrameInClip(frame: number, clip: Clip): boolean {
  return Number.isInteger(frame) && frame >= clip.startFrame && frame < clip.endFrame;
}

function addDuplicateIdIssue(
  issues: ClipIssue[],
  ids: Set<string>,
  id: string,
  path: string,
): void {
  if (ids.has(id)) {
    issues.push({
      code: 'duplicate-annotation-id',
      path,
      message: `Annotation id "${id}" is not unique within the clip.`,
    });
    return;
  }
  ids.add(id);
}

function validateFrameSequence(
  clip: Clip,
  frames: number[],
  path: string,
  issues: ClipIssue[],
): void {
  const seen = new Set<number>();
  let previous = -1;
  frames.forEach((frame, index) => {
    const framePath = `${path}[${index}].frame`;
    if (!isFrameInClip(frame, clip)) {
      issues.push({
        code: 'keyframe-out-of-range',
        path: framePath,
        message: `Keyframe ${frame} is outside [${clip.startFrame}, ${clip.endFrame}).`,
      });
    }
    if (seen.has(frame)) {
      issues.push({
        code: 'duplicate-keyframe-frame',
        path: framePath,
        message: `Frame ${frame} appears more than once in this keyframe lane.`,
      });
    }
    if (index > 0 && frame < previous) {
      issues.push({
        code: 'unsorted-keyframes',
        path: framePath,
        message: 'Keyframes must be sorted by absolute frame.',
      });
    }
    seen.add(frame);
    previous = frame;
  });
}

export function validateClip(
  clip: Clip,
  options: ValidateClipOptions = {},
): ClipIssue[] {
  const issues: ClipIssue[] = [];

  if (!isSafeClipIdSegment(clip.id)) {
    issues.push({ code: 'invalid-id', path: 'id', message: 'Clip id is not a safe path segment.' });
  }
  if (options.folderId !== undefined && options.folderId !== clip.id) {
    issues.push({
      code: 'folder-id-mismatch',
      path: 'id',
      message: `Clip folder "${options.folderId}" does not match document id "${clip.id}".`,
    });
  }
  if (
    !Number.isInteger(clip.startFrame)
    || !Number.isInteger(clip.endFrame)
    || clip.startFrame < 0
    || clip.endFrame <= clip.startFrame
  ) {
    issues.push({
      code: 'invalid-range',
      path: 'startFrame',
      message: 'Clip range must be a non-empty, non-negative half-open frame range.',
    });
  }

  const pinIds = new Set<string>();
  const pinFrames = new Set<number>();
  const annotationIds = new Set<string>();
  let previousPinFrame = -1;

  clip.pins.forEach((pin, pinIndex) => {
    const pinPath = `pins[${pinIndex}]`;
    if (!isSafeClipIdSegment(pin.id)) {
      issues.push({ code: 'invalid-id', path: `${pinPath}.id`, message: 'Pin id is not a safe path segment.' });
    }
    if (pinIds.has(pin.id)) {
      issues.push({
        code: 'duplicate-pin-id',
        path: `${pinPath}.id`,
        message: `Pin id "${pin.id}" appears more than once.`,
      });
    }
    if (pinFrames.has(pin.frame)) {
      issues.push({
        code: 'duplicate-pin-frame',
        path: `${pinPath}.frame`,
        message: `More than one pin uses frame ${pin.frame}.`,
      });
    }
    if (pinIndex > 0 && pin.frame < previousPinFrame) {
      issues.push({
        code: 'unsorted-pins',
        path: `${pinPath}.frame`,
        message: 'Pins must be sorted by absolute frame.',
      });
    }
    if (!isFrameInClip(pin.frame, clip)) {
      issues.push({
        code: 'pin-out-of-range',
        path: `${pinPath}.frame`,
        message: `Pin frame ${pin.frame} is outside [${clip.startFrame}, ${clip.endFrame}).`,
      });
    }

    const defaultCount = pin.annotations.filter((annotation) => annotation.role === 'default').length;
    if (defaultCount > 1) {
      issues.push({
        code: 'multiple-default-annotations',
        path: `${pinPath}.annotations`,
        message: 'A pin may have at most one default annotation document.',
      });
    }

    pin.annotations.forEach((annotation, annotationIndex) => {
      const annotationPath = `${pinPath}.annotations[${annotationIndex}]`;
      if (!isSafeClipIdSegment(annotation.id)) {
        issues.push({
          code: 'invalid-id',
          path: `${annotationPath}.id`,
          message: 'Annotation id is not a safe path segment.',
        });
      }
      addDuplicateIdIssue(issues, annotationIds, annotation.id, `${annotationPath}.id`);
      if (!isSafePinAnnotationPath(annotation.file, annotation.id)) {
        issues.push({
          code: 'invalid-annotation-path',
          path: `${annotationPath}.file`,
          message: `Annotation file must be "${canonicalPinAnnotationPath(annotation.id)}".`,
        });
      }
    });

    pinIds.add(pin.id);
    pinFrames.add(pin.frame);
    previousPinFrame = pin.frame;
  });

  clip.annotations.forEach((annotation, annotationIndex) => {
    const annotationPath = `annotations[${annotationIndex}]`;
    if (!isSafeClipIdSegment(annotation.id)) {
      issues.push({
        code: 'invalid-id',
        path: `${annotationPath}.id`,
        message: 'Clip annotation id is not a safe path segment.',
      });
    }
    addDuplicateIdIssue(issues, annotationIds, annotation.id, `${annotationPath}.id`);

    const keyframeFrames = annotation.keyframes.map((keyframe) => keyframe.frame);
    const visibilityFrames = (annotation.visibilityKeyframes ?? []).map((keyframe) => keyframe.frame);
    validateFrameSequence(clip, keyframeFrames, `${annotationPath}.keyframes`, issues);
    validateFrameSequence(clip, visibilityFrames, `${annotationPath}.visibilityKeyframes`, issues);

    const geometryFrames = new Set(keyframeFrames);
    visibilityFrames.forEach((frame, visibilityIndex) => {
      if (geometryFrames.has(frame)) {
        issues.push({
          code: 'overlapping-keyframe-kinds',
          path: `${annotationPath}.visibilityKeyframes[${visibilityIndex}].frame`,
          message: `Visibility and location keyframes cannot share frame ${frame}.`,
        });
      }
    });
  });

  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ANNOTATION_TYPES = new Set<ClipAnnotationType>([
  'box',
  'circle',
  'shadow',
  'arrow',
  'lob',
  'text',
  'poly',
  'highlight',
]);
const ANNOTATION_SOURCES = new Set(['manual', 'auto', 'corrected']);
const KEYFRAME_PROVENANCE = new Set(['manual', 'tracked', 'lost', 'correction']);
const STROKE_PATTERNS = new Set(['solid', 'dashed', 'dotted', 'dashdot']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireNumbers(raw: Record<string, unknown>, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!isFiniteNumber(raw[field])) throw new Error(`${path}.${field} must be a finite number.`);
  }
}

function validPointList(value: unknown, minimum: number, exact?: number): boolean {
  return Array.isArray(value)
    && value.length >= minimum
    && (exact === undefined || value.length === exact)
    && value.every((point) => (
      Array.isArray(point)
      && point.length === 2
      && isFiniteNumber(point[0])
      && isFiniteNumber(point[1])
    ));
}

function validateAnnotationStyle(raw: unknown, path: string): void {
  if (!isRecord(raw)) throw new Error(`${path} must be an object.`);
  for (const field of ['stroke', 'fill', 'fontFamily'] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') {
      throw new Error(`${path}.${field} must be a string.`);
    }
  }
  if (
    raw.fillOpacity !== undefined
    && (!isFiniteNumber(raw.fillOpacity) || raw.fillOpacity < 0 || raw.fillOpacity > 1)
  ) {
    throw new Error(`${path}.fillOpacity must be between 0 and 1.`);
  }
  if (raw.strokeWidth !== undefined && (!isFiniteNumber(raw.strokeWidth) || raw.strokeWidth < 0)) {
    throw new Error(`${path}.strokeWidth must be a non-negative number.`);
  }
  if (raw.fontSize !== undefined && (!isFiniteNumber(raw.fontSize) || raw.fontSize <= 0)) {
    throw new Error(`${path}.fontSize must be a positive number.`);
  }
  if (raw.strokePattern !== undefined && !STROKE_PATTERNS.has(String(raw.strokePattern))) {
    throw new Error(`${path}.strokePattern is invalid.`);
  }
  if (raw.textHighlight !== undefined && typeof raw.textHighlight !== 'boolean') {
    throw new Error(`${path}.textHighlight must be boolean.`);
  }
}

function validateAnnotationKeyframe(
  annotationType: ClipAnnotationType,
  raw: Record<string, unknown>,
  path: string,
): void {
  if (raw.visible !== undefined && typeof raw.visible !== 'boolean') {
    throw new Error(`${path}.visible must be boolean.`);
  }
  if (raw.provenance !== undefined && !KEYFRAME_PROVENANCE.has(String(raw.provenance))) {
    throw new Error(`${path}.provenance is invalid.`);
  }
  switch (annotationType) {
    case 'box':
      if (validPointList(raw.points, 4, 4)) return;
      requireNumbers(raw, ['x', 'y', 'w', 'h'], path);
      if (Number(raw.w) < 0 || Number(raw.h) < 0) throw new Error(`${path} box dimensions cannot be negative.`);
      if (raw.rotation !== undefined && !isFiniteNumber(raw.rotation)) {
        throw new Error(`${path}.rotation must be a finite number.`);
      }
      return;
    case 'circle':
      requireNumbers(raw, ['cx', 'cy', 'rx', 'ry'], path);
      if (Number(raw.rx) < 0 || Number(raw.ry) < 0) throw new Error(`${path} circle radii cannot be negative.`);
      if (raw.rotation !== undefined && !isFiniteNumber(raw.rotation)) {
        throw new Error(`${path}.rotation must be a finite number.`);
      }
      return;
    case 'shadow':
      requireNumbers(raw, ['x', 'y', 'r', 'rotation', 'spreadDeg'], path);
      if (Number(raw.r) < 0) throw new Error(`${path}.r cannot be negative.`);
      return;
    case 'arrow':
      requireNumbers(raw, ['x1', 'y1', 'x2', 'y2'], path);
      return;
    case 'lob':
      requireNumbers(raw, ['x1', 'y1', 'cx', 'cy', 'x2', 'y2'], path);
      return;
    case 'text':
      requireNumbers(raw, ['x', 'y'], path);
      return;
    case 'poly':
      if (!validPointList(raw.points, 2)) throw new Error(`${path}.points requires at least two finite points.`);
      return;
    case 'highlight':
      requireNumbers(raw, ['cx', 'cy', 'radius'], path);
      if (Number(raw.radius) < 0) throw new Error(`${path}.radius cannot be negative.`);
  }
}

function validateTaggingSelection(raw: Record<string, unknown>): void {
  if (raw.primary !== null && (typeof raw.primary !== 'string' || !isSafeClipIdSegment(raw.primary))) {
    throw new Error('clip.json tags.primary must be null or a safe identifier.');
  }
  const facets = raw.facets;
  if (!isRecord(facets)) throw new Error('clip.json tags.facets must be an object.');
  for (const [groupId, value] of Object.entries(facets)) {
    if (!isSafeClipIdSegment(groupId)) throw new Error(`Invalid facet group id: ${JSON.stringify(groupId)}.`);
    const values = Array.isArray(value) ? value : [value];
    if (
      values.length === 0
      || values.some((entry) => typeof entry !== 'string' || !isSafeClipIdSegment(entry))
      || new Set(values).size !== values.length
    ) {
      throw new Error(`Facet "${groupId}" contains an invalid selection.`);
    }
  }
}

export function parseClip(raw: unknown, options: ValidateClipOptions = {}): Clip {
  if (!isRecord(raw)) throw new Error('clip.json must contain an object.');
  if (raw.schema !== 'clip.v2') throw new Error('clip.json schema must be "clip.v2".');
  if (
    typeof raw.id !== 'string'
    || typeof raw.videoId !== 'string'
    || !isSafeClipIdSegment(raw.videoId)
  ) {
    throw new Error('clip.json requires string id and videoId fields.');
  }
  if (raw.label !== undefined && typeof raw.label !== 'string') {
    throw new Error('clip.json label must be a string.');
  }
  if (!Number.isInteger(raw.startFrame) || !Number.isInteger(raw.endFrame)) {
    throw new Error('clip.json requires integer startFrame and endFrame fields.');
  }
  if (
    !isRecord(raw.tags)
    || (raw.tags.primary !== null && typeof raw.tags.primary !== 'string')
    || !isRecord(raw.tags.facets)
  ) {
    throw new Error('clip.json requires a valid tags selection.');
  }
  validateTaggingSelection(raw.tags);
  if (!Array.isArray(raw.pins) || !Array.isArray(raw.annotations)) {
    throw new Error('clip.json pins and annotations must be arrays.');
  }
  raw.pins.forEach((pin, pinIndex) => {
    if (
      !isRecord(pin)
      || typeof pin.id !== 'string'
      || !Number.isInteger(pin.frame)
      || !Array.isArray(pin.annotations)
    ) {
      throw new Error(`pins[${pinIndex}] is invalid.`);
    }
    if (pin.label !== undefined && typeof pin.label !== 'string') {
      throw new Error(`pins[${pinIndex}].label must be a string.`);
    }
    pin.annotations.forEach((annotation, annotationIndex) => {
      if (
        !isRecord(annotation)
        || typeof annotation.id !== 'string'
        || typeof annotation.file !== 'string'
        || (annotation.role !== 'default' && annotation.role !== 'alternate')
      ) {
        throw new Error(`pins[${pinIndex}].annotations[${annotationIndex}] is invalid.`);
      }
      if (annotation.label !== undefined && typeof annotation.label !== 'string') {
        throw new Error(`pins[${pinIndex}].annotations[${annotationIndex}].label must be a string.`);
      }
    });
  });
  raw.annotations.forEach((annotation, annotationIndex) => {
    const annotationPath = `annotations[${annotationIndex}]`;
    if (
      !isRecord(annotation)
      || typeof annotation.id !== 'string'
      || !ANNOTATION_TYPES.has(annotation.type as ClipAnnotationType)
      || (annotation.coordMode !== 'image' && annotation.coordMode !== 'pitch')
      || !ANNOTATION_SOURCES.has(String(annotation.source))
      || !isRecord(annotation.style)
      || !Array.isArray(annotation.keyframes)
      || annotation.keyframes.length === 0
      || (annotation.visibilityKeyframes !== undefined && !Array.isArray(annotation.visibilityKeyframes))
    ) {
      throw new Error(`${annotationPath} is invalid.`);
    }
    if (annotation.coordMode === 'pitch' && annotation.type !== 'box' && annotation.type !== 'circle') {
      throw new Error(`${annotationPath} uses pitch coordinates for an unsupported tool.`);
    }
    if (annotation.name !== undefined && typeof annotation.name !== 'string') {
      throw new Error(`${annotationPath}.name must be a string.`);
    }
    if (annotation.displayName !== undefined && typeof annotation.displayName !== 'boolean') {
      throw new Error(`${annotationPath}.displayName must be boolean.`);
    }
    if (
      annotation.trackingAnchorId !== undefined
      && annotation.trackingAnchorId !== null
      && (typeof annotation.trackingAnchorId !== 'string' || !isSafeClipIdSegment(annotation.trackingAnchorId))
    ) {
      throw new Error(`${annotationPath}.trackingAnchorId is invalid.`);
    }
    if (
      annotation.vertexRefs !== undefined
      && (
        !Array.isArray(annotation.vertexRefs)
        || annotation.vertexRefs.some((entry) => (
          entry !== null && (typeof entry !== 'string' || !isSafeClipIdSegment(entry))
        ))
      )
    ) {
      throw new Error(`${annotationPath}.vertexRefs is invalid.`);
    }
    if (annotation.text !== undefined && typeof annotation.text !== 'string') {
      throw new Error(`${annotationPath}.text must be a string.`);
    }
    if (annotation.closed !== undefined && typeof annotation.closed !== 'boolean') {
      throw new Error(`${annotationPath}.closed must be boolean.`);
    }
    validateAnnotationStyle(annotation.style, `${annotationPath}.style`);
    annotation.keyframes.forEach((keyframe, keyframeIndex) => {
      if (!isRecord(keyframe) || !Number.isInteger(keyframe.frame) || 'tMs' in keyframe) {
        throw new Error(`${annotationPath}.keyframes[${keyframeIndex}] is not frame-keyed.`);
      }
      validateAnnotationKeyframe(
        annotation.type as ClipAnnotationType,
        keyframe,
        `${annotationPath}.keyframes[${keyframeIndex}]`,
      );
    });
    if (Array.isArray(annotation.visibilityKeyframes)) {
      annotation.visibilityKeyframes.forEach((keyframe, keyframeIndex) => {
        if (
          !isRecord(keyframe)
          || !Number.isInteger(keyframe.frame)
          || 'tMs' in keyframe
          || (keyframe.action !== 'show' && keyframe.action !== 'hide')
        ) {
          throw new Error(
            `${annotationPath}.visibilityKeyframes[${keyframeIndex}] is invalid.`,
          );
        }
      });
    }
  });

  const clip = raw as unknown as Clip;
  const issues = validateClip(clip, options);
  if (issues.length > 0) throw new ClipValidationError(issues);
  return clip;
}
