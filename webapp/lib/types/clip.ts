// ---------------------------------------------------------------------------
// Clip data model — see plans/post-mvp/clips/clips-feature.md §1, §13
// ---------------------------------------------------------------------------

export type ClipId = string;

export type CoordMode = 'image' | 'pitch';

export type AnnotationSource = 'manual' | 'auto' | 'corrected';

export type ClipAnnotationType =
  | 'box'
  | 'circle'
  | 'arrow'
  | 'text'
  | 'poly'
  | 'highlight';

export type StrokePattern = 'solid' | 'dashed' | 'dotted' | 'dashdot';

// ---------------------------------------------------------------------------
// Per-type keyframe interfaces
// ---------------------------------------------------------------------------

interface KeyframeBase {
  tMs: number;        // clip-relative milliseconds (0 = clip start)
  visible?: boolean;  // false → annotation hidden for this range
}

export interface BoxKeyframe extends KeyframeBase {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoxQuadKeyframe extends KeyframeBase {
  points: [number, number][]; // exactly 4 vertices
}

export interface CircleKeyframe extends KeyframeBase {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface ArrowKeyframe extends KeyframeBase {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextKeyframe extends KeyframeBase {
  x: number;
  y: number;
}

export interface PolyKeyframe extends KeyframeBase {
  points: [number, number][]; // N vertices, N fixed at creation time
}

export interface HighlightKeyframe extends KeyframeBase {
  cx: number;
  cy: number;
  radius: number;
}

export type ClipKeyframe =
  | BoxKeyframe
  | BoxQuadKeyframe
  | CircleKeyframe
  | ArrowKeyframe
  | TextKeyframe
  | PolyKeyframe
  | HighlightKeyframe;

// ---------------------------------------------------------------------------
// Annotation style (per-annotation, not per-keyframe)
// ---------------------------------------------------------------------------

export interface ClipAnnotationStyle {
  stroke?: string;
  fill?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  strokePattern?: StrokePattern;
  // text-specific
  fontSize?: number;
  fontFamily?: string;
  textHighlight?: boolean;
}

// ---------------------------------------------------------------------------
// Clip annotation
// ---------------------------------------------------------------------------

export interface ClipAnnotation {
  id: string;
  type: ClipAnnotationType;
  coordMode: CoordMode;
  source: AnnotationSource;
  text?: string;                   // for type: 'text' — content doesn't vary over time
  closed?: boolean;                // for type: 'poly' — defaults to true when omitted
  style: ClipAnnotationStyle;
  keyframes: ClipKeyframe[];       // sorted by tMs ascending
}

// ---------------------------------------------------------------------------
// Clip
// ---------------------------------------------------------------------------

export const CLIP_SCHEMA_VERSION = 1;

export interface Clip {
  schema: number;
  id: ClipId;
  videoId: string;
  startMs: number;
  endMs: number;
  startMarkId?: string | null;
  endMarkId?: string | null;
  annotations: ClipAnnotation[];
}
