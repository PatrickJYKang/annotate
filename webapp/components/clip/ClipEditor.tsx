"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { applyHomography, invert3 } from '../../lib/annotate/homography';
import { buildHomographyGrid } from '../../lib/annotate/homographyOverlay';
import { PITCH_LENGTH_M, PITCH_WIDTH_M } from '../../lib/annotate/pitchCalibration';
import { bboxToHighlight, convertTrackingKeyframes } from '../../lib/clip/bboxConvert';
import {
  cloneClipAnnotations,
  inspectClipAnnotationMerge,
  mergeClipAnnotations,
  mergeTrackedKeyframesIntoAnnotation,
  recordClipAnnotationHistoryChange,
  redoClipAnnotationHistory,
  undoClipAnnotationHistory,
  updateClipAnnotationSelection,
  updateSelectedClipAnnotationStyles,
  type ClipAnnotationSelectionMode,
} from '../../lib/clip/editorState';
import {
  canRunRangeSidecarAction,
  frameBoundary,
  frameToCenterSeconds,
  frameToMs,
  frameToSeconds,
  mediaTimeToVideoFrame,
  sidecarSampleEndMs,
  timestampMsToNearestFrame,
  videoFrame,
} from '../../lib/clip/frameMath';
import { resolveUsableHomographyAtTime } from '../../lib/clip/homographyInterpolation';
import { fitContainedMediaRect } from '../../lib/clip/mediaGeometry';
import {
  interpolateAnnotation,
  type InterpolatedKeyframe,
} from '../../lib/clip/interpolation';
import { applyPinImportToClip, importPinDocumentToClip } from '../../lib/clip/pinImport';
import {
  annotationTypeSupportsPitchCoords,
  convertImageGeometryToPitchGeometry,
  projectImagePointToPitchPoint,
} from '../../lib/clip/pitchProjection';
import {
  frameTemporalAdapter,
  paintClipDrawablesToCanvas,
  resolveClipDrawables,
  type ClipDrawable,
} from '../../lib/clip/renderClipAnnotations';
import {
  buildShapeTransformOverlay,
  clipGeometryFromOrientedShape,
  hitShapeTransformHandle,
  orientedClipShapeFromGeometry,
  rotationPointerOffset,
  transformOrientedClipShape,
  type ShapeTransformHandleId,
  type ShapeTransformOverlay,
} from '../../lib/clip/shapeTransform';
import {
  advancePinPauseMachine,
  resumePinPauseMachine,
  seekPinPauseMachine,
  type PinPauseMachine,
} from '../../lib/presentation/playback';
import {
  requestHomography,
  requestPlayerDetections,
  requestTrackingStream,
  type PlayerDetection,
  type TrackingError,
  type TrackingKeyframe,
} from '../../lib/clip/sidecarClient';
import {
  getCurrentKeyframe,
  getCurrentVisibilityKeyframe,
  getFrameTrackingState,
} from '../../lib/clip/trackingState';
import {
  bridgeTrackingHighlight,
  reusableTrackingHighlight,
  seedTrackingHighlightSegment,
  stopTrackingHighlightSegment,
} from '../../lib/clip/trackingWorkflow';
import {
  deleteOverlappingHomographyCache,
  findOverlappingCache,
  writeHomographyCache,
  type HomographyFrame,
} from '../../lib/fs/homographyCache';
import {
  defaultAnnotationFontSize,
  defaultAnnotationStrokeWidth,
} from '../../lib/annotate/styleScale';
import { readClip } from '../../lib/fs/clipStorage';
import {
  createPinAnnotationExclusive,
  createPinExclusive,
  deletePinExclusive,
  readPinAnnotationDocument,
  renamePinExclusive,
  restorePinExclusive,
} from '../../lib/fs/pinAnnotationStorage';
import type { TrashOperationRecord } from '../../lib/fs/trash';
import { useSidecar } from '../../lib/state/SidecarContext';
import type {
  ClipAnnotationType,
  ClipAnnotation,
  ClipKeyframeProvenance,
  ClipKeyframe,
  HighlightKeyframe,
  Clip,
} from '../../lib/types/clip';
import type { VideoEntry } from '../../lib/types/project';
import {
  AnnotationInspector,
  ClipEditorShell,
  PinList,
} from './ClipEditorPanels';
import PinAnnotator from './PinAnnotator';
import TimelineStrip, { type TimelineKeyframeRef } from './TimelineStrip';
import { useLocale } from '../../lib/i18n';

export type ClipTool = 'select' | 'box' | 'circle' | 'shadow' | 'arrow' | 'lob' | 'poly' | 'text' | 'highlight';
export type ClipEditorSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const CLIP_HOMOGRAPHY_SKIP_INTERVAL = 4;

interface ClipEditorProps {
  clip: Clip;
  video: VideoEntry;
  videoUrl: string;
  videoRef?: string;
  videoPath?: string;
  projectDir?: FileSystemDirectoryHandle;
  persistAnnotations: (annotations: ClipAnnotation[]) => Promise<Clip>;
  onClipUpdate?: (clip: Clip) => void;
  initialPinId?: string | null;
}

type Point = { x: number; y: number };
type LinkedDraftPoint = Point & { refId?: string | null };
type PolyDraftCursor = {
  raw: Point;
  snapped: LinkedDraftPoint;
};
type PointerDraft = {
  mode: 'draw' | 'move' | 'select' | 'transform';
  start: Point;
  current: Point;
  annotationId?: string;
  baseGeometry?: Record<string, unknown>;
  transformHandle?: ShapeTransformHandleId;
  rotationOffset?: number;
  startClient?: Point;
  hasMoved?: boolean;
  selectionMode?: ClipAnnotationSelectionMode;
};

const POLY_VERTEX_SNAP_DISTANCE = 10;

function nearestPolyVertexIndex(points: LinkedDraftPoint[], point: Point): number {
  let nearestIndex = -1;
  let nearestDistance = Infinity;
  points.forEach((candidate, index) => {
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance <= POLY_VERTEX_SNAP_DISTANCE && distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  });
  return nearestIndex;
}

function isDuplicatePolyPoint(left: LinkedDraftPoint, right: LinkedDraftPoint): boolean {
  return (left.refId ?? null) === (right.refId ?? null)
    && Math.hypot(left.x - right.x, left.y - right.y) <= 1;
}

type TrackingSession = {
  phase: 'choosing' | 'running';
  annotationId: string | null;
  hasStarted: boolean;
  selectedDetection: PlayerDetection | null;
  selectedCandidateIndex: number | null;
  selectedFrame: number | null;
  originFrame: number | null;
  radius: number;
  runId: number;
};

type ProvisionalPlayerFrame = {
  frame: number;
  detections: PlayerDetection[];
};

const TOOLS: Array<{ id: ClipTool; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'box', label: 'Box' },
  { id: 'circle', label: 'Circle' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'lob', label: 'Lob' },
  { id: 'poly', label: 'Poly' },
  { id: 'text', label: 'Text' },
  { id: 'highlight', label: 'Highlight' },
];

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function reservePinTab(): Window | null {
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  return popup;
}

function navigatePinTab(popup: Window, clipId: string, pinId: string): void {
  const url = new URL(`/clip/${encodeURIComponent(clipId)}`, window.location.href);
  url.searchParams.set('pinId', pinId);
  popup.location.replace(url.toString());
}

function isTextInput(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return !!element && (
    element.isContentEditable
    || element.tagName === 'INPUT'
    || element.tagName === 'TEXTAREA'
    || element.tagName === 'SELECT'
    || element.closest('[data-resize-handle]') !== null
  );
}

function clampToClip(clip: Clip, frame: number): number {
  return Math.max(clip.startFrame, Math.min(clip.endFrame - 1, Math.round(frame)));
}

function defaultTrackingRadius(width: number, height: number): number {
  return Math.max(32, Math.min(width, height) * 0.044);
}

function geometryFromInterpolated(value: InterpolatedKeyframe): Record<string, unknown> {
  switch (value.type) {
    case 'box': return {
      x: value.x,
      y: value.y,
      w: value.w,
      h: value.h,
      rotation: value.rotation,
    };
    case 'circle': return {
      cx: value.cx,
      cy: value.cy,
      rx: value.rx,
      ry: value.ry,
      rotation: value.rotation,
    };
    case 'shadow': return { x: value.x, y: value.y, r: value.r, rotation: value.rotation, spreadDeg: value.spreadDeg };
    case 'arrow': return { x1: value.x1, y1: value.y1, x2: value.x2, y2: value.y2 };
    case 'lob': return { x1: value.x1, y1: value.y1, cx: value.cx, cy: value.cy, x2: value.x2, y2: value.y2 };
    case 'text': return { x: value.x, y: value.y };
    case 'poly': return { points: value.points.map(([x, y]) => [x, y] as [number, number]) };
    case 'highlight': return { cx: value.cx, cy: value.cy, radius: value.radius };
  }
}

function translateGeometry(
  type: ClipAnnotationType,
  geometry: Record<string, unknown>,
  dx: number,
  dy: number,
): Record<string, unknown> {
  const n = (key: string) => Number(geometry[key] ?? 0);
  switch (type) {
    case 'box': return { ...geometry, x: n('x') + dx, y: n('y') + dy };
    case 'circle': return { ...geometry, cx: n('cx') + dx, cy: n('cy') + dy };
    case 'shadow': return { ...geometry, x: n('x') + dx, y: n('y') + dy };
    case 'arrow': return { ...geometry, x1: n('x1') + dx, y1: n('y1') + dy, x2: n('x2') + dx, y2: n('y2') + dy };
    case 'lob': return {
      ...geometry,
      x1: n('x1') + dx,
      y1: n('y1') + dy,
      cx: n('cx') + dx,
      cy: n('cy') + dy,
      x2: n('x2') + dx,
      y2: n('y2') + dy,
    };
    case 'text': return { ...geometry, x: n('x') + dx, y: n('y') + dy };
    case 'poly': return {
      ...geometry,
      points: ((geometry.points as [number, number][] | undefined) ?? []).map(([x, y]) => [x + dx, y + dy]),
    };
    case 'highlight': return { ...geometry, cx: n('cx') + dx, cy: n('cy') + dy };
  }
}

function geometryFromDrag(tool: ClipTool, start: Point, end: Point): Record<string, unknown> {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(8, Math.hypot(dx, dy));
  switch (tool) {
    case 'box': {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return { x: start.x - 60, y: start.y - 40, w: 120, h: 80 };
      return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(dx), h: Math.abs(dy) };
    }
    case 'circle': {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return { cx: start.x, cy: start.y, rx: 50, ry: 30 };
      return { cx: (start.x + end.x) / 2, cy: (start.y + end.y) / 2, rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2 };
    }
    case 'shadow': return { x: start.x, y: start.y, r: distance, rotation: Math.atan2(dy, dx), spreadDeg: 50 };
    case 'arrow': return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    case 'lob': return {
      x1: start.x,
      y1: start.y,
      cx: (start.x + end.x) / 2,
      cy: (start.y + end.y) / 2 - Math.max(24, distance * 0.25),
      x2: end.x,
      y2: end.y,
    };
    case 'text': return { x: start.x, y: start.y };
    case 'highlight': return { cx: start.x, cy: start.y, radius: Math.max(20, distance) };
    default: return {};
  }
}

function rotatePointAround(
  point: Point,
  center: Point,
  rotationDegrees: number,
): Point {
  const radians = rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

function drawableBounds(drawable: ClipDrawable): { x: number; y: number; w: number; h: number } {
  switch (drawable.kind) {
    case 'box': {
      const center = { x: drawable.x + drawable.w / 2, y: drawable.y + drawable.h / 2 };
      const corners = [
        { x: drawable.x, y: drawable.y },
        { x: drawable.x + drawable.w, y: drawable.y },
        { x: drawable.x + drawable.w, y: drawable.y + drawable.h },
        { x: drawable.x, y: drawable.y + drawable.h },
      ].map((point) => rotatePointAround(point, center, drawable.rotation));
      const xs = corners.map((point) => point.x);
      const ys = corners.map((point) => point.y);
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
    }
    case 'ellipse': {
      const radians = drawable.rotation * Math.PI / 180;
      const halfWidth = Math.hypot(drawable.rx * Math.cos(radians), drawable.ry * Math.sin(radians));
      const halfHeight = Math.hypot(drawable.rx * Math.sin(radians), drawable.ry * Math.cos(radians));
      return {
        x: drawable.cx - halfWidth,
        y: drawable.cy - halfHeight,
        w: halfWidth * 2,
        h: halfHeight * 2,
      };
    }
    case 'polygon': {
      const xs = drawable.points.map(([x]) => x);
      const ys = drawable.points.map(([, y]) => y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'arrow': return {
      x: Math.min(drawable.x1, drawable.x2),
      y: Math.min(drawable.y1, drawable.y2),
      w: Math.abs(drawable.x2 - drawable.x1),
      h: Math.abs(drawable.y2 - drawable.y1),
    };
    case 'lob': {
      const xs = [drawable.start.x, drawable.control.x, drawable.end.x];
      const ys = [drawable.start.y, drawable.control.y, drawable.end.y];
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'text': return { x: drawable.x, y: drawable.y, w: Math.max(80, drawable.text.length * drawable.style.fontSize * 0.55), h: drawable.style.fontSize };
  }
}

function hitDrawable(drawable: ClipDrawable, point: Point): boolean {
  const padding = Math.max(8, drawable.style.strokeWidth * 2);
  if (drawable.kind === 'box') {
    const center = { x: drawable.x + drawable.w / 2, y: drawable.y + drawable.h / 2 };
    const local = rotatePointAround(point, center, -drawable.rotation);
    return local.x >= drawable.x - padding
      && local.x <= drawable.x + drawable.w + padding
      && local.y >= drawable.y - padding
      && local.y <= drawable.y + drawable.h + padding;
  }
  if (drawable.kind === 'ellipse') {
    const local = rotatePointAround(point, { x: drawable.cx, y: drawable.cy }, -drawable.rotation);
    const rx = Math.max(0.5, drawable.rx + padding);
    const ry = Math.max(0.5, drawable.ry + padding);
    return ((local.x - drawable.cx) ** 2) / (rx ** 2)
      + ((local.y - drawable.cy) ** 2) / (ry ** 2) <= 1;
  }
  const bounds = drawableBounds(drawable);
  return point.x >= bounds.x - padding
    && point.x <= bounds.x + bounds.w + padding
    && point.y >= bounds.y - padding
    && point.y <= bounds.y + bounds.h + padding;
}

function selectionModeFromModifiers(
  shiftKey: boolean,
  subtractKey: boolean,
): ClipAnnotationSelectionMode {
  if (shiftKey) return 'add';
  if (subtractKey) return 'subtract';
  return 'replace';
}

function selectionBounds(start: Point, end: Point) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

function boundsIntersect(
  left: { x: number; y: number; w: number; h: number },
  right: { x: number; y: number; w: number; h: number },
): boolean {
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y;
}

function drawSelection(context: CanvasRenderingContext2D, drawable: ClipDrawable | undefined): void {
  if (!drawable) return;
  const bounds = drawableBounds(drawable);
  context.save();
  context.strokeStyle = '#fff';
  context.lineWidth = 2;
  context.setLineDash([7, 5]);
  context.strokeRect(bounds.x - 5, bounds.y - 5, bounds.w + 10, bounds.h + 10);
  context.restore();
}

function drawShapeTransformOverlay(
  context: CanvasRenderingContext2D,
  overlay: ShapeTransformOverlay,
  handleRadius: number,
): void {
  if (overlay.outline.length < 2) return;
  context.save();
  context.strokeStyle = '#60a5fa';
  context.fillStyle = '#ffffff';
  context.lineWidth = Math.max(1.5, handleRadius * 0.3);
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(overlay.outline[0].x, overlay.outline[0].y);
  overlay.outline.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.stroke();
  context.beginPath();
  context.moveTo(overlay.rotationStem[0].x, overlay.rotationStem[0].y);
  context.lineTo(overlay.rotationStem[1].x, overlay.rotationStem[1].y);
  context.stroke();
  for (const handle of overlay.resizeHandles) {
    context.beginPath();
    context.rect(
      handle.x - handleRadius,
      handle.y - handleRadius,
      handleRadius * 2,
      handleRadius * 2,
    );
    context.fill();
    context.stroke();
  }
  context.beginPath();
  context.arc(
    overlay.rotationHandle.x,
    overlay.rotationHandle.y,
    handleRadius * 1.08,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.stroke();
  context.restore();
}

function createAnnotation(
  tool: Exclude<ClipTool, 'select'>,
  frame: number,
  geometry: Record<string, unknown>,
  color: string,
  strokeWidth: number,
  coordMode: 'image' | 'pitch',
  fontSize = 48,
): ClipAnnotation {
  return {
    id: makeId(tool),
    type: tool,
    coordMode,
    source: 'manual',
    style: {
      stroke: color,
      fill: ['box', 'circle', 'shadow', 'highlight'].includes(tool) ? color : 'transparent',
      fillOpacity: tool === 'shadow' ? 0.22 : 0.28,
      strokeWidth,
      ...(tool === 'text' ? { fontSize } : {}),
    },
    ...(tool === 'text' ? { text: 'Text' } : {}),
    ...(tool === 'poly' ? { closed: true } : {}),
    keyframes: [{ frame: videoFrame(frame), provenance: 'manual', ...geometry } as ClipKeyframe],
  };
}

export default function ClipEditor({
  clip,
  video,
  videoUrl,
  videoRef,
  videoPath,
  projectDir,
  persistAnnotations,
  onClipUpdate,
  initialPinId = null,
}: ClipEditorProps) {
  const sidecar = useSidecar();
  const { t, formatNumber } = useLocale();
  const initialPinFrameRef = useRef(
    clip.pins.find((pin) => pin.id === initialPinId)?.frame ?? clip.startFrame,
  );
  const initialPinFrame = initialPinFrameRef.current;
  const [currentClip, setCurrentClip] = useState(clip);
  const [annotations, setAnnotations] = useState(() => cloneClipAnnotations(clip.annotations));
  const [currentFrame, setCurrentFrame] = useState<number>(initialPinFrame);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPausedPinId, setPlaybackPausedPinId] = useState<string | null>(null);
  const [pinPlaybackAnnotations, setPinPlaybackAnnotations] = useState<Map<string, ClipAnnotation[]>>(
    () => new Map(),
  );
  const [pinPlaybackRevision, setPinPlaybackRevision] = useState(0);
  const [tool, setTool] = useState<ClipTool>('select');
  const [color, setColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(() => defaultAnnotationStrokeWidth(video.width, video.height));
  const defaultFontSize = defaultAnnotationFontSize(video.width, video.height);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>(
    () => clip.annotations[0]?.id ? [clip.annotations[0].id] : [],
  );
  const [selectedKeyframe, setSelectedKeyframe] = useState<TimelineKeyframeRef | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(initialPinId ?? clip.pins[0]?.id ?? null);
  const [timelineRevealRequest, setTimelineRevealRequest] = useState<{ frame: number; id: number } | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(initialPinId);
  const [deletedPin, setDeletedPin] = useState<TrashOperationRecord | null>(null);
  const [pinLabelDraft, setPinLabelDraft] = useState('');
  const [pointerDraft, setPointerDraft] = useState<PointerDraft | null>(null);
  const [polyPoints, setPolyPoints] = useState<LinkedDraftPoint[]>([]);
  const [polyCursor, setPolyCursor] = useState<PolyDraftCursor | null>(null);
  const [arrowStart, setArrowStart] = useState<LinkedDraftPoint | null>(null);
  const [arrowCursor, setArrowCursor] = useState<LinkedDraftPoint | null>(null);
  const [saveStatus, setSaveStatus] = useState<ClipEditorSaveStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [trackingSession, setTrackingSession] = useState<TrackingSession | null>(null);
  const [provisionalPlayers, setProvisionalPlayers] = useState<ProvisionalPlayerFrame | null>(null);
  const [detectingPlayers, setDetectingPlayers] = useState(false);
  const [homographyFrames, setHomographyFrames] = useState<HomographyFrame[] | null>(null);
  const [computingHomography, setComputingHomography] = useState(false);
  const [showHomography, setShowHomography] = useState(false);
  const [drawCoordMode, setDrawCoordMode] = useState<'image' | 'pitch'>('image');
  const [videoSize, setVideoSize] = useState({ width: video.width, height: video.height });
  const [mediaRect, setMediaRect] = useState(() => fitContainedMediaRect(0, 0, video.width, video.height));
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const viewerSurfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawablesRef = useRef<ClipDrawable[]>([]);
  const transformOverlayRef = useRef<ShapeTransformOverlay | null>(null);
  const historyPastRef = useRef<ClipAnnotation[][]>([]);
  const historyFutureRef = useRef<ClipAnnotation[][]>([]);
  const annotationsRef = useRef(annotations);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveGenerationRef = useRef(0);
  const styleEditHistoryBaseRef = useRef<ClipAnnotation[] | null>(null);
  const styleEditLatestRef = useRef<ClipAnnotation[] | null>(null);
  const styleEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTrackingRunRef = useRef(0);
  const activeTrackingFrameRef = useRef<number | null>(null);
  const desiredDetectionFrameRef = useRef<number | null>(null);
  const detectionInFlightRef = useRef(false);
  const detectionGenerationRef = useRef(0);
  const pinPauseMachineRef = useRef<PinPauseMachine | null>(null);
  const currentFrameRef = useRef<number>(initialPinFrame);
  const clipPinsRef = useRef(currentClip.pins);
  clipPinsRef.current = currentClip.pins;

  const updateCurrentFrame = useCallback((frame: number) => {
    currentFrameRef.current = frame;
    setCurrentFrame(frame);
  }, []);

  const selectedAnnotationId = selectedAnnotationIds.at(-1) ?? null;
  const selectedAnnotationIdSet = useMemo(
    () => new Set(selectedAnnotationIds),
    [selectedAnnotationIds],
  );
  const selectOnlyAnnotation = useCallback((annotationId: string | null) => {
    setSelectedAnnotationIds(annotationId ? [annotationId] : []);
  }, []);
  const selectAnnotationFromUi = useCallback((
    annotationId: string | null,
    mode: ClipAnnotationSelectionMode = 'replace',
  ) => {
    setSelectedAnnotationIds((current) => updateClipAnnotationSelection(
      current,
      annotationId ? [annotationId] : [],
      mode,
    ));
    setSelectedKeyframe(null);
  }, []);
  const selectAnnotationsFromUi = useCallback((
    annotationIds: readonly string[],
    mode: ClipAnnotationSelectionMode,
  ) => {
    setSelectedAnnotationIds((current) => updateClipAnnotationSelection(
      current,
      annotationIds,
      mode,
    ));
    setSelectedKeyframe(null);
  }, []);
  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null,
    [annotations, selectedAnnotationId],
  );
  const selectedAnnotations = useMemo(
    () => selectedAnnotationIds.flatMap((annotationId) => {
      const annotation = annotations.find((candidate) => candidate.id === annotationId);
      return annotation ? [annotation] : [];
    }),
    [annotations, selectedAnnotationIds],
  );
  const objectMergeInspection = useMemo(
    () => inspectClipAnnotationMerge(annotations, selectedAnnotationIds),
    [annotations, selectedAnnotationIds],
  );
  const selectedPin = useMemo(
    () => currentClip.pins.find((pin) => pin.id === selectedPinId) ?? null,
    [currentClip.pins, selectedPinId],
  );
  const editingPin = useMemo(
    () => currentClip.pins.find((pin) => pin.id === editingPinId) ?? null,
    [currentClip.pins, editingPinId],
  );
  const pinAtCurrentFrame = useMemo(
    () => currentClip.pins.find((pin) => pin.frame === currentFrame) ?? null,
    [currentClip.pins, currentFrame],
  );
  const playbackPausedPin = useMemo(
    () => currentClip.pins.find((pin) => pin.id === playbackPausedPinId) ?? null,
    [currentClip.pins, playbackPausedPinId],
  );
  const currentHomography = useMemo(
    () => resolveUsableHomographyAtTime(homographyFrames, Number(frameToMs(videoFrame(currentFrame), video.fps))),
    [currentFrame, homographyFrames, video.fps],
  );
  const currentHomographyInverse = useMemo(
    () => currentHomography ? invert3(currentHomography) : null,
    [currentHomography],
  );
  const activeToolSupportsPitch = tool !== 'select' && annotationTypeSupportsPitchCoords(tool);

  useEffect(() => {
    setPinLabelDraft(selectedPin?.label ?? '');
  }, [selectedPin?.id, selectedPin?.label]);

  useEffect(() => {
    const available = new Set(annotations.map((annotation) => annotation.id));
    setSelectedAnnotationIds((current) => {
      const next = current.filter((annotationId) => available.has(annotationId));
      return next.length === current.length ? current : next;
    });
  }, [annotations]);

  useEffect(() => {
    if (!projectDir || currentClip.endFrame - currentClip.startFrame < 2) return;
    let active = true;
    const range = {
      startFrame: videoFrame(currentClip.startFrame),
      endFrame: frameBoundary(currentClip.endFrame),
    };
    void findOverlappingCache(
      projectDir,
      video.id,
      Number(frameToMs(range.startFrame, video.fps)),
      Number(sidecarSampleEndMs(range, video.fps)),
    ).then((frames) => {
      if (active && frames?.length) setHomographyFrames(frames);
    });
    return () => {
      active = false;
    };
  }, [currentClip.endFrame, currentClip.startFrame, projectDir, video.fps, video.id]);

  useEffect(() => {
    let active = true;
    if (!projectDir || currentClip.pins.length === 0) {
      setPinPlaybackAnnotations(new Map());
      return () => {
        active = false;
      };
    }
    void Promise.all(currentClip.pins.map(async (pin) => {
      const documents = await Promise.all(pin.annotations.map(async (reference) => {
        try {
          const result = await readPinAnnotationDocument(projectDir, currentClip.id, reference.id);
          if (!result.document || result.error) return [];
          return importPinDocumentToClip(result.document, pin.frame).annotations;
        } catch {
          return [];
        }
      }));
      return [pin.id, documents.flat()] as const;
    })).then((entries) => {
      if (active) setPinPlaybackAnnotations(new Map(entries));
    });
    return () => {
      active = false;
    };
  }, [currentClip.id, currentClip.pins, pinPlaybackRevision, projectDir]);

  useEffect(() => {
    const refreshPinDocuments = () => setPinPlaybackRevision((revision) => revision + 1);
    window.addEventListener('focus', refreshPinDocuments);
    return () => window.removeEventListener('focus', refreshPinDocuments);
  }, []);

  useEffect(() => {
    if (!currentHomography || !activeToolSupportsPitch) {
      if (!activeToolSupportsPitch) setDrawCoordMode('image');
      return;
    }
    setDrawCoordMode('pitch');
  }, [activeToolSupportsPitch, currentHomography]);

  useEffect(() => {
    const surface = viewerSurfaceRef.current;
    if (!surface) return;
    const fit = (width: number, height: number) => {
      setMediaRect(fitContainedMediaRect(width, height, videoSize.width, videoSize.height));
    };
    const rect = surface.getBoundingClientRect();
    fit(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => {
      fit(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [videoSize.height, videoSize.width]);

  const queuePersist = useCallback((next: ClipAnnotation[]) => {
    const payload = cloneClipAnnotations(next);
    const generation = ++saveGenerationRef.current;
    setSaveStatus('saving');
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await persistAnnotations(payload);
          setCurrentClip(saved);
          onClipUpdate?.(saved);
          if (generation === saveGenerationRef.current) setSaveStatus('saved');
        } catch (error) {
          if (generation === saveGenerationRef.current) setSaveStatus('error');
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
  }, [onClipUpdate, persistAnnotations]);

  const replaceAnnotations = useCallback((next: ClipAnnotation[]) => {
    annotationsRef.current = next;
    setAnnotations(next);
  }, []);

  const finalizePendingStyleEdit = useCallback((persist = true) => {
    if (styleEditTimerRef.current) clearTimeout(styleEditTimerRef.current);
    styleEditTimerRef.current = null;
    const historyBase = styleEditHistoryBaseRef.current;
    const latest = styleEditLatestRef.current;
    styleEditHistoryBaseRef.current = null;
    styleEditLatestRef.current = null;
    if (!historyBase || !latest) return;
    const history = recordClipAnnotationHistoryChange(
      historyBase,
      latest,
      historyPastRef.current,
    );
    historyPastRef.current = history.past;
    historyFutureRef.current = history.future;
    if (persist) queuePersist(latest);
  }, [queuePersist]);

  const commitAnnotations = useCallback((
    next: ClipAnnotation[],
    recordHistory = true,
    historyBase: ClipAnnotation[] = annotationsRef.current,
  ) => {
    finalizePendingStyleEdit(false);
    if (recordHistory) {
      const history = recordClipAnnotationHistoryChange(historyBase, next, historyPastRef.current);
      historyPastRef.current = history.past;
      historyFutureRef.current = history.future;
    }
    replaceAnnotations(next);
    setCurrentClip((previous) => ({ ...previous, annotations: next }));
    queuePersist(next);
  }, [finalizePendingStyleEdit, queuePersist, replaceAnnotations]);

  const updateSelectedAnnotationStyles = useCallback((
    updateStyle: Parameters<typeof updateSelectedClipAnnotationStyles>[2],
  ) => {
    if (selectedAnnotationIds.length === 0) return;
    const current = annotationsRef.current;
    if (!styleEditHistoryBaseRef.current) {
      styleEditHistoryBaseRef.current = current;
      setSaveStatus('saving');
    }
    const next = updateSelectedClipAnnotationStyles(
      current,
      selectedAnnotationIds,
      updateStyle,
    );
    styleEditLatestRef.current = next;
    replaceAnnotations(next);
    if (styleEditTimerRef.current) clearTimeout(styleEditTimerRef.current);
    styleEditTimerRef.current = setTimeout(finalizePendingStyleEdit, 180);
  }, [finalizePendingStyleEdit, replaceAnnotations, selectedAnnotationIds]);

  useEffect(() => () => finalizePendingStyleEdit(), [finalizePendingStyleEdit]);

  const acceptPinClipUpdate = useCallback((next: Clip) => {
    const visibleClip = { ...next, annotations };
    setCurrentClip(visibleClip);
    onClipUpdate?.(visibleClip);
  }, [annotations, onClipUpdate]);

  const closePinAnnotator = useCallback(() => {
    if (initialPinId) window.close();
    setEditingPinId(null);
  }, [initialPinId]);

  const openPinAnnotator = useCallback(async (
    pinId: string,
    sourceClip = currentClip,
    reservedTab?: Window | null,
  ) => {
    if (!projectDir) return;
    const popup = reservedTab === undefined ? reservePinTab() : reservedTab;
    if (!popup) {
      setMessage(t('clip.pinPopupBlocked'));
      return;
    }
    try {
      let next = sourceClip;
      let target = next.pins.find((pin) => pin.id === pinId);
      if (!target) throw new Error(t('clip.pinMissing'));
      if (target.annotations.length === 0) {
        const annotationId = makeId('annotation');
        next = await createPinAnnotationExclusive(projectDir, {
          schema: 'annotations.v2',
          annotationId,
          clipId: next.id,
          pinId: target.id,
          frame: target.frame,
          image: { width: video.width, height: video.height },
          shapes: [],
        }, { role: 'default', label: 'Default annotations' });
        target = next.pins.find((pin) => pin.id === pinId);
        acceptPinClipUpdate(next);
      }
      if (!target) throw new Error(t('clip.pinMissing'));
      setSelectedPinId(target.id);
      navigatePinTab(popup, next.id, target.id);
      setMessage(t('clip.openedPin', { frame: formatNumber(target.frame) }));
    } catch (error) {
      popup.close();
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [acceptPinClipUpdate, currentClip, formatNumber, projectDir, t, video.height, video.width]);

  const createOrOpenPinAtCurrentFrame = useCallback(async () => {
    if (!projectDir) return;
    const popup = reservePinTab();
    if (!popup) {
      setMessage(t('clip.pinPopupBlocked'));
      return;
    }
    try {
      if (pinAtCurrentFrame) {
        await openPinAnnotator(pinAtCurrentFrame.id, currentClip, popup);
        return;
      }
      const pinId = makeId('pin');
      const next = await createPinExclusive(projectDir, currentClip.id, {
        id: pinId,
        frame: videoFrame(currentFrame),
        label: `Pin f${currentFrame}`,
        annotations: [],
      });
      acceptPinClipUpdate(next);
      setSelectedPinId(pinId);
      await openPinAnnotator(pinId, next, popup);
    } catch (error) {
      popup.close();
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [acceptPinClipUpdate, currentClip, currentFrame, openPinAnnotator, pinAtCurrentFrame, projectDir, t]);

  const deleteSelectedPin = useCallback(async () => {
    if (!projectDir || !selectedPin) return;
    try {
      const record = await deletePinExclusive(projectDir, currentClip.id, selectedPin.id);
      const latest = await readClip(projectDir, currentClip.id);
      if (!latest.ok) throw new Error(latest.error.message);
      acceptPinClipUpdate(latest.clip);
      setDeletedPin(record);
      setSelectedPinId(null);
      if (editingPinId === selectedPin.id) setEditingPinId(null);
      setMessage(t('clip.pinDeleted', { frame: formatNumber(selectedPin.frame) }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [acceptPinClipUpdate, currentClip.id, editingPinId, formatNumber, projectDir, selectedPin, t]);

  const undoDeletePin = useCallback(async () => {
    if (!projectDir || !deletedPin) return;
    try {
      const next = await restorePinExclusive(
        projectDir,
        currentClip.id,
        deletedPin.entityId,
        deletedPin.operationId,
      );
      acceptPinClipUpdate(next);
      setSelectedPinId(deletedPin.entityId);
      setDeletedPin(null);
      setMessage(t('clip.pinRestored'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [acceptPinClipUpdate, currentClip.id, deletedPin, projectDir, t]);

  const savePinLabel = useCallback(async () => {
    if (!projectDir || !selectedPin) return;
    try {
      const next = await renamePinExclusive(
        projectDir,
        currentClip.id,
        selectedPin.id,
        pinLabelDraft.trim() || undefined,
      );
      acceptPinClipUpdate(next);
      setMessage(t('clip.pinLabelSaved'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [acceptPinClipUpdate, currentClip.id, pinLabelDraft, projectDir, selectedPin, t]);

  const importPinDocument = useCallback(async (annotationId: string) => {
    if (!projectDir || !editingPin) throw new Error(t('clip.noPinImport'));
    const result = await readPinAnnotationDocument(projectDir, currentClip.id, annotationId);
    if (result.error) throw new Error(result.error);
    if (!result.document) throw new Error(t('clip.importDocumentMissing', { id: annotationId }));
    const imported = importPinDocumentToClip(result.document, editingPin.frame);
    const applied = applyPinImportToClip(annotations, imported.annotations, editingPin.frame);
    commitAnnotations(applied.annotations);
    setMessage(t('clip.importResult', {
      count: formatNumber(applied.importedCount),
      skipped: imported.skipped
        ? t('clip.importSkipped', { count: formatNumber(imported.skipped) })
        : '',
    }));
  }, [annotations, commitAnnotations, currentClip.id, editingPin, formatNumber, projectDir, t]);

  const seekFrame = useCallback((nextFrame: number, pause = true) => {
    const frame = clampToClip(currentClip, nextFrame);
    const element = videoElementRef.current;
    if (pause && element) {
      element.pause();
      setIsPlaying(false);
    }
    const targetFrame = videoFrame(frame);
    pinPauseMachineRef.current = seekPinPauseMachine(
      pinPauseMachineRef.current ?? {
        previousFrame: targetFrame,
        pausedPinId: null,
        consumedPinIds: new Set(),
      },
      targetFrame,
      clipPinsRef.current,
    );
    setPlaybackPausedPinId(null);
    updateCurrentFrame(frame);
    if (element) element.currentTime = frameToCenterSeconds(videoFrame(frame), video.fps);
  }, [currentClip, updateCurrentFrame, video.fps]);

  const goToPin = useCallback((frame: number) => {
    seekFrame(frame);
    setTimelineRevealRequest((previous) => ({
      frame,
      id: (previous?.id ?? 0) + 1,
    }));
  }, [seekFrame]);

  const synchronizeMediaToClipStart = useCallback((element: HTMLVideoElement) => {
    const startFrame = initialPinFrame;
    element.pause();
    element.currentTime = frameToCenterSeconds(videoFrame(startFrame), video.fps);
    const targetFrame = videoFrame(startFrame);
    pinPauseMachineRef.current = seekPinPauseMachine(
      pinPauseMachineRef.current ?? {
        previousFrame: targetFrame,
        pausedPinId: null,
        consumedPinIds: new Set(),
      },
      targetFrame,
      clipPinsRef.current,
    );
    setPlaybackPausedPinId(null);
    updateCurrentFrame(startFrame);
    setIsPlaying(false);
  }, [initialPinFrame, updateCurrentFrame, video.fps]);

  useEffect(() => {
    const element = videoElementRef.current;
    if (!element) return;
    const synchronize = () => synchronizeMediaToClipStart(element);
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) synchronize();
    else element.addEventListener('loadedmetadata', synchronize, { once: true });
    return () => element.removeEventListener('loadedmetadata', synchronize);
  }, [synchronizeMediaToClipStart, videoUrl]);

  const resumePlaybackFromPin = useCallback(async () => {
    const element = videoElementRef.current;
    if (!element || !playbackPausedPinId) return;
    if (pinPauseMachineRef.current) {
      pinPauseMachineRef.current = resumePinPauseMachine(pinPauseMachineRef.current);
    }
    setPlaybackPausedPinId(null);
    try {
      await element.play();
      setIsPlaying(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [playbackPausedPinId]);

  const togglePlayback = useCallback(async () => {
    const element = videoElementRef.current;
    if (!element) return;
    if (playbackPausedPinId) {
      await resumePlaybackFromPin();
      return;
    }
    if (!element.paused) {
      element.pause();
      setIsPlaying(false);
      return;
    }
    const clipStartSeconds = frameToSeconds(videoFrame(currentClip.startFrame), video.fps);
    const clipEndSeconds = frameToSeconds(videoFrame(currentClip.endFrame), video.fps);
    const playbackStartFrame = currentFrame >= currentClip.endFrame - 1
      ? currentClip.startFrame
      : currentFrame;
    if (
      currentFrame >= currentClip.endFrame - 1
      || element.currentTime < clipStartSeconds - (0.5 / video.fps)
      || element.currentTime >= clipEndSeconds
    ) {
      seekFrame(playbackStartFrame, false);
    }
    const playbackFrame = videoFrame(playbackStartFrame);
    pinPauseMachineRef.current = seekPinPauseMachine(
      pinPauseMachineRef.current ?? {
        previousFrame: playbackFrame,
        pausedPinId: null,
        consumedPinIds: new Set(),
      },
      playbackFrame,
      currentClip.pins,
    );
    try {
      await element.play();
      setIsPlaying(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [currentClip.endFrame, currentClip.pins, currentClip.startFrame, currentFrame, playbackPausedPinId, resumePlaybackFromPin, seekFrame, video.fps]);

  useEffect(() => {
    const element = videoElementRef.current;
    if (!element || !isPlaying) return;
    let callbackId = 0;
    let cancelled = false;
    const update = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (cancelled) return;
      const frame = mediaTimeToVideoFrame(metadata.mediaTime, video.fps, video.frameCount);
      const playbackFrame = videoFrame(Math.min(frame, currentClip.endFrame - 1));
      if (frame >= currentClip.startFrame && pinPauseMachineRef.current) {
        const step = advancePinPauseMachine(
          pinPauseMachineRef.current,
          playbackFrame,
          currentClip.pins,
        );
        pinPauseMachineRef.current = step.state;
        if (step.triggeredPinId) {
          const pin = currentClip.pins.find((candidate) => candidate.id === step.triggeredPinId);
          if (pin) {
            element.pause();
            element.currentTime = frameToCenterSeconds(pin.frame, video.fps);
            updateCurrentFrame(pin.frame);
            setPlaybackPausedPinId(pin.id);
            setIsPlaying(false);
            return;
          }
        }
      }
      if (frame >= currentClip.endFrame) {
        element.pause();
        setIsPlaying(false);
        seekFrame(currentClip.endFrame - 1, false);
        return;
      }
      if (frame >= currentClip.startFrame) updateCurrentFrame(frame);
      callbackId = element.requestVideoFrameCallback(update);
    };
    callbackId = element.requestVideoFrameCallback(update);
    return () => {
      cancelled = true;
      element.cancelVideoFrameCallback(callbackId);
    };
  }, [currentClip.endFrame, currentClip.pins, currentClip.startFrame, isPlaying, seekFrame, updateCurrentFrame, video.fps, video.frameCount]);

  const previewAnnotation = useMemo((): ClipAnnotation | null => {
    if (!pointerDraft) return null;
    if (pointerDraft.mode === 'move' || pointerDraft.mode === 'transform') {
      const annotation = annotations.find((candidate) => candidate.id === pointerDraft.annotationId);
      if (!annotation || !pointerDraft.baseGeometry) return null;
      let geometry: Record<string, unknown>;
      if (pointerDraft.mode === 'transform') {
        if (!pointerDraft.transformHandle) return null;
        if (annotation.coordMode === 'pitch' && !currentHomographyInverse) return null;
        const shape = orientedClipShapeFromGeometry(annotation.type, pointerDraft.baseGeometry);
        if (!shape) return null;
        const pitchPointer = annotation.coordMode === 'pitch'
          ? projectImagePointToPitchPoint(
              currentHomographyInverse,
              pointerDraft.current.x,
              pointerDraft.current.y,
            )
          : null;
        const pointer = pitchPointer
          ? { x: pitchPointer.u, y: pitchPointer.v }
          : pointerDraft.current;
        geometry = clipGeometryFromOrientedShape(transformOrientedClipShape(
          shape,
          pointerDraft.transformHandle,
          pointer,
          {
            minWidth: annotation.coordMode === 'pitch' ? 0.1 : 2,
            minHeight: annotation.coordMode === 'pitch' ? 0.1 : 2,
            rotationOffset: pointerDraft.rotationOffset,
          },
        ));
      } else {
        let dx = pointerDraft.current.x - pointerDraft.start.x;
        let dy = pointerDraft.current.y - pointerDraft.start.y;
        if (annotation.coordMode === 'pitch' && currentHomographyInverse) {
          const start = projectImagePointToPitchPoint(
            currentHomographyInverse,
            pointerDraft.start.x,
            pointerDraft.start.y,
          );
          const end = projectImagePointToPitchPoint(
            currentHomographyInverse,
            pointerDraft.current.x,
            pointerDraft.current.y,
          );
          dx = end.u - start.u;
          dy = end.v - start.v;
        }
        geometry = translateGeometry(annotation.type, pointerDraft.baseGeometry, dx, dy);
      }
      return {
        ...annotation,
        keyframes: [{
          frame: videoFrame(currentFrame),
          provenance: annotation.source === 'manual' ? 'manual' : 'correction',
          ...geometry,
        } as ClipKeyframe],
        visibilityKeyframes: undefined,
      };
    }
    if (tool === 'select' || tool === 'poly' || tool === 'arrow') return null;
    let geometry = geometryFromDrag(tool, pointerDraft.start, pointerDraft.current);
    const usePitch = drawCoordMode === 'pitch' && activeToolSupportsPitch && !!currentHomographyInverse;
    if (usePitch) geometry = convertImageGeometryToPitchGeometry(tool, geometry, currentHomographyInverse);
    return createAnnotation(tool, currentFrame, geometry, color, strokeWidth, usePitch ? 'pitch' : 'image', defaultFontSize);
  }, [activeToolSupportsPitch, annotations, color, currentFrame, currentHomographyInverse, defaultFontSize, drawCoordMode, pointerDraft, strokeWidth, tool]);

  const transformHandleRadius = useMemo(() => {
    const displayScale = mediaRect.width > 0 && videoSize.width > 0
      ? mediaRect.width / videoSize.width
      : 1;
    return Math.max(4, 6 / Math.max(displayScale, 0.01));
  }, [mediaRect.width, videoSize.width]);

  const selectedTransformOverlay = useMemo((): ShapeTransformOverlay | null => {
    if (
      tool !== 'select'
      || isPlaying
      || trackingSession
      || playbackPausedPin
      || selectedAnnotationIds.length !== 1
      || !selectedAnnotation
      || (selectedAnnotation.type !== 'box' && selectedAnnotation.type !== 'circle')
    ) {
      return null;
    }
    const source = previewAnnotation?.id === selectedAnnotation.id
      ? previewAnnotation
      : selectedAnnotation;
    const value = interpolateAnnotation(
      source,
      videoFrame(currentFrame),
      frameBoundary(currentClip.endFrame),
    );
    if (!value) return null;
    const shape = orientedClipShapeFromGeometry(
      selectedAnnotation.type,
      geometryFromInterpolated(value),
    );
    if (!shape) return null;
    if (selectedAnnotation.coordMode === 'pitch' && !currentHomography) return null;
    const project = selectedAnnotation.coordMode === 'pitch'
      ? (point: Point) => {
          const projected = applyHomography(currentHomography!, point.x, point.y);
          return Number.isFinite(projected.x) && Number.isFinite(projected.y)
            ? projected
            : null;
        }
      : (point: Point) => point;
    return buildShapeTransformOverlay(
      shape,
      project,
      transformHandleRadius * 4,
    );
  }, [
    currentClip.endFrame,
    currentFrame,
    currentHomography,
    isPlaying,
    playbackPausedPin,
    previewAnnotation,
    selectedAnnotation,
    selectedAnnotationIds.length,
    tool,
    trackingSession,
    transformHandleRadius,
  ]);
  transformOverlayRef.current = selectedTransformOverlay;

  const findHighlightHit = useCallback((point: Point): (LinkedDraftPoint & { refId: string }) | null => {
    for (let index = drawablesRef.current.length - 1; index >= 0; index -= 1) {
      const drawable = drawablesRef.current[index];
      const annotation = annotationsRef.current.find((candidate) => candidate.id === drawable.id);
      if (annotation?.type !== 'highlight' || drawable.kind !== 'ellipse') continue;
      const dx = point.x - drawable.cx;
      const dy = point.y - drawable.cy;
      const normalizedDistance = (dx * dx) / Math.max(drawable.rx * drawable.rx, 1e-6)
        + (dy * dy) / Math.max(drawable.ry * drawable.ry, 1e-6);
      if (normalizedDistance <= 1) {
        return { x: drawable.cx, y: drawable.cy, refId: annotation.id };
      }
    }
    return null;
  }, []);

  const polyPreviewAnnotation = useMemo((): ClipAnnotation | null => {
    if (polyPoints.length === 0) return null;
    const nearVertexIndex = polyCursor
      ? nearestPolyVertexIndex(polyPoints, polyCursor.raw)
      : -1;
    const closed = nearVertexIndex === 0 && polyPoints.length >= 3;
    const points = nearVertexIndex < 0 && polyCursor
      ? [...polyPoints, polyCursor.snapped]
      : polyPoints;
    const refs = points.map((point) => point.refId ?? null);
    return {
      id: '__draft-poly__',
      type: 'poly',
      coordMode: 'image',
      source: 'manual',
      closed,
      vertexRefs: refs.some(Boolean) ? refs : undefined,
      style: {
        stroke: color,
        strokeWidth,
        strokePattern: 'solid',
        fill: closed ? color : 'transparent',
        fillOpacity: closed ? 0.3 : undefined,
      },
      keyframes: [{
        frame: videoFrame(currentFrame),
        provenance: 'manual',
        points: points.map((point) => [point.x, point.y] as [number, number]),
      }],
    };
  }, [color, currentFrame, polyCursor, polyPoints, strokeWidth]);

  const arrowPreviewAnnotation = useMemo((): ClipAnnotation | null => {
    if (!arrowStart || !arrowCursor) return null;
    const refs = [arrowStart.refId ?? null, arrowCursor.refId ?? null];
    return {
      id: '__draft-arrow__',
      type: 'arrow',
      coordMode: 'image',
      source: 'manual',
      vertexRefs: refs.some(Boolean) ? refs : undefined,
      style: {
        stroke: color,
        fill: 'transparent',
        strokeWidth,
        strokePattern: 'solid',
      },
      keyframes: [{
        frame: videoFrame(currentFrame),
        provenance: 'manual',
        x1: arrowStart.x,
        y1: arrowStart.y,
        x2: arrowCursor.x,
        y2: arrowCursor.y,
      }],
    };
  }, [arrowCursor, arrowStart, color, currentFrame, strokeWidth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== videoSize.width || canvas.height !== videoSize.height) {
      canvas.width = videoSize.width;
      canvas.height = videoSize.height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!playbackPausedPin && showHomography && currentHomography) {
      const grid = buildHomographyGrid(currentHomography, {
        width: PITCH_LENGTH_M,
        height: PITCH_WIDTH_M,
        columns: 7,
        rows: 5,
      });
      context.save();
      context.strokeStyle = '#38bdf8';
      context.lineWidth = 1.5;
      context.globalAlpha = 0.82;
      for (const line of grid) {
        context.beginPath();
        line.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.stroke();
      }
      context.restore();
    }
    const baseAnnotations = playbackPausedPin
      ? pinPlaybackAnnotations.get(playbackPausedPin.id) ?? []
      : pointerDraft?.mode === 'move' && previewAnnotation
        ? [...annotations.filter((annotation) => annotation.id !== previewAnnotation.id), previewAnnotation]
        : previewAnnotation
          ? [...annotations, previewAnnotation]
          : annotations;
    const renderedAnnotations = playbackPausedPin
      ? baseAnnotations
      : [
          ...baseAnnotations,
          ...(polyPreviewAnnotation ? [polyPreviewAnnotation] : []),
          ...(arrowPreviewAnnotation ? [arrowPreviewAnnotation] : []),
        ];
    const drawables = resolveClipDrawables(
      renderedAnnotations,
      currentFrame,
      frameTemporalAdapter(frameBoundary(currentClip.endFrame)),
      () => currentHomography,
      { color, fillOpacity: 0.28, fontSize: defaultFontSize },
    );
    paintClipDrawablesToCanvas(context, drawables, {
      width: canvas.width,
      height: canvas.height,
      sourceWidth: videoSize.width,
      sourceHeight: videoSize.height,
    });
    drawablesRef.current = playbackPausedPin ? [] : drawables;
    if (!playbackPausedPin) {
      for (const annotationId of selectedAnnotationIds) {
        if (selectedTransformOverlay && annotationId === selectedAnnotation?.id) continue;
        drawSelection(context, drawables.find((drawable) => drawable.id === annotationId));
      }
      if (selectedTransformOverlay) {
        drawShapeTransformOverlay(context, selectedTransformOverlay, transformHandleRadius);
      }
    }
    if (!playbackPausedPin && pointerDraft?.mode === 'select' && pointerDraft.hasMoved) {
      const bounds = selectionBounds(pointerDraft.start, pointerDraft.current);
      context.save();
      context.fillStyle = 'rgba(59, 130, 246, 0.15)';
      context.strokeStyle = '#60a5fa';
      context.lineWidth = 2;
      context.setLineDash([6, 5]);
      context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
      context.restore();
    }
    if (!playbackPausedPin && trackingSession?.phase === 'choosing' && provisionalPlayers) {
      context.save();
      provisionalPlayers.detections.forEach((detection, index) => {
        const preview = bboxToHighlight(detection, trackingSession.radius);
        const selected = trackingSession.selectedCandidateIndex === index
          && trackingSession.selectedFrame === provisionalPlayers.frame;
        context.beginPath();
        context.ellipse(preview.cx, preview.cy, preview.radius, preview.radius * 0.35, 0, 0, Math.PI * 2);
        context.fillStyle = selected ? 'rgba(245, 158, 11, 0.24)' : 'rgba(255, 255, 255, 0.16)';
        context.strokeStyle = selected ? '#f59e0b' : '#ffffff';
        context.lineWidth = Math.max(2, strokeWidth * 0.75);
        context.setLineDash(selected ? [] : [8, 5]);
        context.fill();
        context.stroke();
      });
      context.restore();
    }
  }, [annotations, arrowPreviewAnnotation, color, currentClip.endFrame, currentFrame, currentHomography, defaultFontSize, pinPlaybackAnnotations, playbackPausedPin, pointerDraft, polyPreviewAnnotation, previewAnnotation, provisionalPlayers, selectedAnnotation, selectedAnnotationIds, selectedTransformOverlay, showHomography, strokeWidth, trackingSession, transformHandleRadius, videoSize]);

  const pointFromClient = useCallback((clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * videoSize.width,
      y: ((clientY - rect.top) / rect.height) * videoSize.height,
    };
  }, [videoSize]);

  const findSelectionHit = useCallback((
    point: Point,
    mode: ClipAnnotationSelectionMode,
  ): ClipDrawable | undefined => {
    const reversed = [...drawablesRef.current]
      .reverse()
      .filter((drawable) => annotationsRef.current.some((annotation) => annotation.id === drawable.id));
    if (mode === 'add') {
      const unselectedHit = reversed.find(
        (drawable) => !selectedAnnotationIdSet.has(drawable.id) && hitDrawable(drawable, point),
      );
      if (unselectedHit) return unselectedHit;
      return reversed.find((drawable) => hitDrawable(drawable, point));
    }
    if (mode === 'subtract') {
      return reversed.find(
        (drawable) => selectedAnnotationIdSet.has(drawable.id) && hitDrawable(drawable, point),
      ) ?? reversed.find((drawable) => hitDrawable(drawable, point));
    }
    const primary = selectedAnnotationId
      ? drawablesRef.current.find((drawable) => drawable.id === selectedAnnotationId)
      : undefined;
    return primary && hitDrawable(primary, point)
      ? primary
      : reversed.find((drawable) => hitDrawable(drawable, point));
  }, [selectedAnnotationId, selectedAnnotationIdSet]);

  const finishPoly = useCallback((
    closed = polyPoints.length >= 3,
    points = polyPoints,
  ) => {
    if (points.length < 2) {
      setPolyPoints([]);
      setPolyCursor(null);
      return;
    }
    const refs = points.map((point) => point.refId ?? null);
    const annotation = createAnnotation(
      'poly',
      currentFrame,
      { points: points.map((point) => [point.x, point.y] as [number, number]) },
      color,
      strokeWidth,
      'image',
      defaultFontSize,
    );
    annotation.closed = closed;
    annotation.vertexRefs = refs.some(Boolean) ? refs : undefined;
    annotation.style = {
      ...annotation.style,
      fill: closed ? color : 'transparent',
      fillOpacity: closed ? 0.3 : undefined,
      strokePattern: 'solid',
    };
    const next = [...annotations, annotation];
    selectOnlyAnnotation(annotation.id);
    setSelectedKeyframe({ annotationId: annotation.id, kind: 'position', index: 0, frame: currentFrame });
    setPolyPoints([]);
    setPolyCursor(null);
    commitAnnotations(next);
  }, [annotations, color, commitAnnotations, currentFrame, defaultFontSize, polyPoints, selectOnlyAnnotation, strokeWidth]);

  const finishArrow = useCallback((end: LinkedDraftPoint) => {
    if (!arrowStart) return;
    const refs = [arrowStart.refId ?? null, end.refId ?? null];
    const annotation = createAnnotation(
      'arrow',
      currentFrame,
      {
        x1: arrowStart.x,
        y1: arrowStart.y,
        x2: end.x,
        y2: end.y,
      },
      color,
      strokeWidth,
      'image',
      defaultFontSize,
    );
    annotation.vertexRefs = refs.some(Boolean) ? refs : undefined;
    annotation.style = { ...annotation.style, strokePattern: 'solid' };
    const next = [...annotations, annotation];
    selectOnlyAnnotation(annotation.id);
    setSelectedKeyframe({
      annotationId: annotation.id,
      kind: 'position',
      index: 0,
      frame: currentFrame,
    });
    setArrowStart(null);
    setArrowCursor(null);
    commitAnnotations(next);
  }, [annotations, arrowStart, color, commitAnnotations, currentFrame, defaultFontSize, selectOnlyAnnotation, strokeWidth]);

  const upsertKeyframe = useCallback((annotationId: string, frame = currentFrame) => {
    const annotation = annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation) return;
    const value = interpolateAnnotation(annotation, videoFrame(frame), frameBoundary(currentClip.endFrame));
    if (!value) {
      setMessage(t('clip.noGeometry'));
      return;
    }
    const geometry = geometryFromInterpolated(value);
    const provenance: ClipKeyframeProvenance = annotation.source === 'manual' ? 'manual' : 'correction';
    const existingIndex = annotation.keyframes.findIndex((keyframe) => keyframe.frame === frame);
    const keyframes = annotation.keyframes.slice();
    const nextKeyframe = { frame: videoFrame(frame), provenance, ...geometry } as ClipKeyframe;
    if (existingIndex >= 0) keyframes[existingIndex] = nextKeyframe;
    else keyframes.push(nextKeyframe);
    keyframes.sort((left, right) => left.frame - right.frame);
    const next = annotations.map((candidate) => candidate.id === annotationId
      ? {
          ...candidate,
          keyframes,
          visibilityKeyframes: candidate.visibilityKeyframes?.filter((keyframe) => keyframe.frame !== frame),
        }
      : candidate);
    commitAnnotations(next);
    const index = keyframes.findIndex((keyframe) => keyframe.frame === frame);
    setSelectedKeyframe({ annotationId, kind: 'position', index, frame });
  }, [annotations, commitAnnotations, currentClip.endFrame, currentFrame, t]);

  const updateSelectedShadowGeometry = useCallback((patch: {
    r?: number;
    spreadDeg?: number;
  }) => {
    if (!selectedAnnotation || selectedAnnotation.type !== 'shadow') return;
    const value = interpolateAnnotation(
      selectedAnnotation,
      videoFrame(currentFrame),
      frameBoundary(currentClip.endFrame),
    );
    if (!value) return;
    const geometry = { ...geometryFromInterpolated(value), ...patch };
    const provenance: ClipKeyframeProvenance = selectedAnnotation.source === 'manual'
      ? 'manual'
      : 'correction';
    const keyframes = selectedAnnotation.keyframes
      .filter((keyframe) => keyframe.frame !== currentFrame);
    keyframes.push({
      frame: videoFrame(currentFrame),
      provenance,
      ...geometry,
    } as ClipKeyframe);
    keyframes.sort((left, right) => left.frame - right.frame);
    commitAnnotations(annotations.map((annotation) => (
      annotation.id === selectedAnnotation.id
        ? {
            ...annotation,
            keyframes,
            visibilityKeyframes: annotation.visibilityKeyframes?.filter(
              (keyframe) => keyframe.frame !== currentFrame,
            ),
          }
        : annotation
    )));
    setSelectedKeyframe({
      annotationId: selectedAnnotation.id,
      kind: 'position',
      index: keyframes.findIndex((keyframe) => keyframe.frame === currentFrame),
      frame: currentFrame,
    });
  }, [
    annotations,
    commitAnnotations,
    currentClip.endFrame,
    currentFrame,
    selectedAnnotation,
  ]);

  const deleteSelectedKeyframe = useCallback(() => {
    if (!selectedAnnotation) return;
    const ref = selectedKeyframe;
    const position = ref?.kind === 'position'
      ? selectedAnnotation.keyframes.findIndex((keyframe) => keyframe.frame === ref.frame)
      : selectedAnnotation.keyframes.findIndex((keyframe) => keyframe.frame === currentFrame);
    const visibility = ref?.kind === 'visibility'
      ? (selectedAnnotation.visibilityKeyframes ?? []).findIndex((keyframe) => keyframe.frame === ref.frame)
      : (selectedAnnotation.visibilityKeyframes ?? []).findIndex((keyframe) => keyframe.frame === currentFrame);
    if (position >= 0) {
      if (selectedAnnotation.keyframes.length <= 1) {
        setMessage(t('clip.keyframeLocationRequired'));
        return;
      }
      const keyframes = selectedAnnotation.keyframes.filter((_, index) => index !== position);
      commitAnnotations(annotations.map((annotation) => annotation.id === selectedAnnotation.id ? { ...annotation, keyframes } : annotation));
      setSelectedKeyframe(null);
      return;
    }
    if (visibility >= 0) {
      const visibilityKeyframes = (selectedAnnotation.visibilityKeyframes ?? []).filter((_, index) => index !== visibility);
      commitAnnotations(annotations.map((annotation) => annotation.id === selectedAnnotation.id ? { ...annotation, visibilityKeyframes } : annotation));
      setSelectedKeyframe(null);
    }
  }, [annotations, commitAnnotations, currentFrame, selectedAnnotation, selectedKeyframe, t]);

  const deleteSelectedObject = useCallback(() => {
    if (selectedAnnotationIds.length === 0) return;
    const selectedIds = new Set(selectedAnnotationIds);
    commitAnnotations(annotations.filter((annotation) => !selectedIds.has(annotation.id)));
    setSelectedAnnotationIds([]);
    setSelectedKeyframe(null);
  }, [annotations, commitAnnotations, selectedAnnotationIds]);

  const mergeSelectedObjects = useCallback(() => {
    const result = mergeClipAnnotations(annotations, selectedAnnotationIds);
    if (!result.didMerge || !result.selectedAnnotationId) return;
    commitAnnotations(result.annotations);
    selectOnlyAnnotation(result.selectedAnnotationId);
    setSelectedKeyframe(null);
    setMessage(t('clip.objectsMerged', { count: formatNumber(selectedAnnotationIds.length) }));
  }, [annotations, commitAnnotations, formatNumber, selectOnlyAnnotation, selectedAnnotationIds, t]);

  const renameSelectedHighlight = useCallback((name?: string) => {
    if (!selectedAnnotation || selectedAnnotation.type !== 'highlight') return;
    const normalized = name?.trim() || undefined;
    if (normalized === selectedAnnotation.name) return;
    commitAnnotations(annotations.map((annotation) => (
      annotation.id === selectedAnnotation.id
        ? { ...annotation, name: normalized }
        : annotation
    )));
  }, [annotations, commitAnnotations, selectedAnnotation]);

  const setSelectedHighlightDisplayName = useCallback((displayName: boolean) => {
    if (!selectedAnnotation || selectedAnnotation.type !== 'highlight') return;
    if (displayName === !!selectedAnnotation.displayName) return;
    commitAnnotations(annotations.map((annotation) => (
      annotation.id === selectedAnnotation.id
        ? {
            ...annotation,
            displayName,
            style: displayName && !annotation.style.fontSize
              ? { ...annotation.style, fontSize: defaultFontSize }
              : annotation.style,
          }
        : annotation
    )));
  }, [annotations, commitAnnotations, defaultFontSize, selectedAnnotation]);

  const setSelectedHighlightNameFontSize = useCallback((requestedFontSize: number) => {
    if (!selectedAnnotation || selectedAnnotation.type !== 'highlight') return;
    const fontSize = Math.max(8, Math.min(300, requestedFontSize));
    if (fontSize === selectedAnnotation.style.fontSize) return;
    commitAnnotations(annotations.map((annotation) => (
      annotation.id === selectedAnnotation.id
        ? { ...annotation, style: { ...annotation.style, fontSize } }
        : annotation
    )));
  }, [annotations, commitAnnotations, selectedAnnotation]);

  const undo = useCallback(() => {
    finalizePendingStyleEdit(false);
    const result = undoClipAnnotationHistory({
      past: historyPastRef.current,
      future: historyFutureRef.current,
      currentAnnotations: annotationsRef.current,
      selectedAnnotationId,
    });
    if (!result.didUndo) return;
    historyPastRef.current = result.past;
    historyFutureRef.current = result.future;
    selectOnlyAnnotation(result.selectedAnnotationId);
    setSelectedKeyframe(null);
    replaceAnnotations(result.annotations);
    setCurrentClip((previous) => ({ ...previous, annotations: result.annotations }));
    queuePersist(result.annotations);
  }, [
    finalizePendingStyleEdit,
    queuePersist,
    replaceAnnotations,
    selectOnlyAnnotation,
    selectedAnnotationId,
  ]);

  const redo = useCallback(() => {
    finalizePendingStyleEdit(false);
    const result = redoClipAnnotationHistory({
      past: historyPastRef.current,
      future: historyFutureRef.current,
      currentAnnotations: annotationsRef.current,
      selectedAnnotationId,
    });
    if (!result.didRedo) return;
    historyPastRef.current = result.past;
    historyFutureRef.current = result.future;
    selectOnlyAnnotation(result.selectedAnnotationId);
    setSelectedKeyframe(null);
    replaceAnnotations(result.annotations);
    setCurrentClip((previous) => ({ ...previous, annotations: result.annotations }));
    queuePersist(result.annotations);
  }, [
    finalizePendingStyleEdit,
    queuePersist,
    replaceAnnotations,
    selectOnlyAnnotation,
    selectedAnnotationId,
  ]);

  const moveTimelineKeyframe = useCallback((ref: TimelineKeyframeRef, targetFrame: number) => {
    const frame = clampToClip(currentClip, targetFrame);
    const annotation = annotations.find((candidate) => candidate.id === ref.annotationId);
    if (!annotation || frame === ref.frame) return;
    if (annotation.keyframes.some((keyframe) => keyframe.frame === frame)
      || annotation.visibilityKeyframes?.some((keyframe) => keyframe.frame === frame)) {
      setMessage(t('clip.keyframeDuplicate', { frame: formatNumber(frame) }));
      return;
    }
    if (ref.kind === 'position') {
      const source = annotation.keyframes.find((keyframe) => keyframe.frame === ref.frame);
      if (!source || source.provenance === 'tracked' || source.provenance === 'lost') return;
      const keyframes = annotation.keyframes
        .map((keyframe) => keyframe === source ? { ...keyframe, frame: videoFrame(frame) } as ClipKeyframe : keyframe)
        .sort((left, right) => left.frame - right.frame);
      commitAnnotations(annotations.map((candidate) => candidate.id === annotation.id ? { ...candidate, keyframes } : candidate));
    } else {
      const visibilityKeyframes = (annotation.visibilityKeyframes ?? [])
        .map((keyframe) => keyframe.frame === ref.frame ? { ...keyframe, frame: videoFrame(frame) } : keyframe)
        .sort((left, right) => left.frame - right.frame);
      commitAnnotations(annotations.map((candidate) => candidate.id === annotation.id ? { ...candidate, visibilityKeyframes } : candidate));
    }
    setSelectedKeyframe({ ...ref, frame });
    seekFrame(frame);
  }, [annotations, commitAnnotations, currentClip, formatNumber, seekFrame, t]);

  const desiredDetectionFrame = useMemo(() => {
    if (trackingSession?.phase !== 'choosing') return null;
    if (!isPlaying) return currentFrame;
    const stride = Math.max(1, Math.round(video.fps / 4));
    return clampToClip(
      currentClip,
      currentClip.startFrame + Math.floor((currentFrame - currentClip.startFrame) / stride) * stride,
    );
  }, [currentClip, currentFrame, isPlaying, trackingSession?.phase, video.fps]);

  const requestDesiredPlayerDetections = useCallback(async function requestDesired(): Promise<void> {
    if (detectionInFlightRef.current) return;
    const frame = desiredDetectionFrameRef.current;
    if (frame == null || (!videoRef && !videoPath)) return;
    const generation = detectionGenerationRef.current;
    detectionInFlightRef.current = true;
    setDetectingPlayers(true);
    try {
      const result = await requestPlayerDetections({
        videoRef,
        videoPath,
        frameMs: Number(frameToMs(videoFrame(frame), video.fps)),
      }, sidecar.baseUrl);
      if (generation !== detectionGenerationRef.current || desiredDetectionFrameRef.current == null) return;
      setProvisionalPlayers({ frame, detections: result.detections });
    } catch (error) {
      if (generation === detectionGenerationRef.current) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      detectionInFlightRef.current = false;
      if (generation !== detectionGenerationRef.current) {
        if (desiredDetectionFrameRef.current != null) void requestDesired();
        return;
      }
      setDetectingPlayers(false);
      if (desiredDetectionFrameRef.current !== frame) void requestDesired();
    }
  }, [sidecar.baseUrl, video.fps, videoPath, videoRef]);

  useEffect(() => {
    desiredDetectionFrameRef.current = desiredDetectionFrame;
    if (desiredDetectionFrame == null) {
      detectionGenerationRef.current += 1;
      setDetectingPlayers(false);
      setProvisionalPlayers(null);
      return;
    }
    void requestDesiredPlayerDetections();
  }, [desiredDetectionFrame, requestDesiredPlayerDetections]);

  const beginTracking = useCallback(() => {
    if (!videoRef && !videoPath) {
      setMessage(t('clip.videoNotRegistered'));
      return;
    }
    const reusableAnnotation = reusableTrackingHighlight(
      selectedAnnotation,
      videoFrame(currentFrame),
    );
    const reusableGeometry = reusableAnnotation
      ? interpolateAnnotation(
        reusableAnnotation,
        videoFrame(currentFrame),
        frameBoundary(currentClip.endFrame),
      )
      : null;
    videoElementRef.current?.pause();
    setIsPlaying(false);
    const trackingFrame = videoFrame(currentFrame);
    pinPauseMachineRef.current = seekPinPauseMachine(
      pinPauseMachineRef.current ?? {
        previousFrame: trackingFrame,
        pausedPinId: null,
        consumedPinIds: new Set(),
      },
      trackingFrame,
      currentClip.pins,
    );
    setPlaybackPausedPinId(null);
    setTool('select');
    setPointerDraft(null);
    setPolyPoints([]);
    setPolyCursor(null);
    setArrowStart(null);
    setArrowCursor(null);
    setMessage(null);
    setProvisionalPlayers(null);
    activeTrackingFrameRef.current = null;
    setTrackingSession({
      phase: 'choosing',
      annotationId: reusableAnnotation?.id ?? null,
      hasStarted: false,
      selectedDetection: null,
      selectedCandidateIndex: null,
      selectedFrame: null,
      originFrame: null,
      radius: reusableGeometry?.type === 'highlight'
        ? reusableGeometry.radius
        : defaultTrackingRadius(videoSize.width, videoSize.height),
      runId: activeTrackingRunRef.current,
    });
  }, [
    currentClip.endFrame,
    currentClip.pins,
    currentFrame,
    selectedAnnotation,
    t,
    videoPath,
    videoRef,
    videoSize.height,
    videoSize.width,
  ]);

  const stopTracking = useCallback(() => {
    const session = trackingSession;
    if (session?.annotationId) {
      const current = annotationsRef.current;
      const target = current.find((annotation) => annotation.id === session.annotationId);
      if (target?.type === 'highlight') {
        const stopFrame = videoFrame(
          session.phase === 'running'
            ? activeTrackingFrameRef.current ?? currentFrameRef.current
            : currentFrameRef.current,
        );
        const stopped = stopTrackingHighlightSegment(
          target,
          stopFrame,
          videoFrame(currentClip.startFrame),
          frameBoundary(currentClip.endFrame),
        );
        if (stopped !== target) {
          commitAnnotations(current.map((annotation) => (
            annotation.id === stopped.id ? stopped : annotation
          )));
        }
      }
    }
    activeTrackingFrameRef.current = null;
    if (session?.originFrame != null) seekFrame(session.originFrame);
    setTrackingSession(null);
    setProvisionalPlayers(null);
    setDetectingPlayers(false);
  }, [
    commitAnnotations,
    currentClip.endFrame,
    currentClip.startFrame,
    seekFrame,
    trackingSession,
  ]);

  const startTracking = useCallback(() => {
    setTrackingSession((session) => {
      if (!session?.selectedDetection || session.selectedFrame == null || !session.annotationId) return session;
      return {
        ...session,
        phase: 'running',
        hasStarted: true,
        runId: activeTrackingRunRef.current + 1,
      };
    });
  }, []);

  const chooseTrackingCandidate = useCallback((candidateIndex: number) => {
    const session = trackingSession;
    const candidateFrame = provisionalPlayers?.frame;
    const detection = provisionalPlayers?.detections[candidateIndex];
    if (!session || session.phase !== 'choosing' || candidateFrame == null || !detection) return;

    const frame = videoFrame(candidateFrame);
    const geometry = bboxToHighlight(detection, session.radius);
    let annotationId = session.annotationId;
    let next = annotations;

    if (!annotationId) {
      const created = createAnnotation(
        'highlight',
        candidateFrame,
        geometry,
        color,
        strokeWidth,
        'image',
        defaultFontSize,
      );
      created.source = 'auto';
      annotationId = created.id;
      next = [...annotations, created];
    } else {
      const existing = annotations.find((annotation) => annotation.id === annotationId);
      if (!existing || existing.type !== 'highlight') return;
      const previous = [...existing.keyframes]
        .reverse()
        .find((keyframe) => keyframe.frame < frame && keyframe.visible !== false && keyframe.provenance !== 'lost') as HighlightKeyframe | undefined;
      const updated = session.hasStarted
        ? bridgeTrackingHighlight(existing, frame, geometry)
        : seedTrackingHighlightSegment(existing, frame, geometry);
      next = annotations.map((annotation) => annotation.id === annotationId ? updated : annotation);

      if (previous && session.hasStarted) {
        const primaryBridge = (updated.keyframes as HighlightKeyframe[]).filter(
          (keyframe) => keyframe.frame > previous.frame && keyframe.frame <= frame,
        );
        const seedAnchor = { x: previous.cx, y: previous.cy + previous.radius * 0.35 };
        next = next.map((annotation) => {
          if (annotation.trackingAnchorId !== annotationId || annotation.coordMode !== 'image') return annotation;
          const followerSeed = interpolateAnnotation(
            annotation,
            videoFrame(previous.frame),
            frameBoundary(currentClip.endFrame),
          );
          if (!followerSeed) return annotation;
          const base = geometryFromInterpolated(followerSeed);
          const followerKeyframes = primaryBridge.map((highlight) => {
            const anchorY = highlight.cy + highlight.radius * 0.35;
            return {
              frame: highlight.frame,
              provenance: highlight.provenance,
              ...translateGeometry(annotation.type, base, highlight.cx - seedAnchor.x, anchorY - seedAnchor.y),
            } as ClipKeyframe;
          });
          return mergeTrackedKeyframesIntoAnnotation(annotation, followerKeyframes, {
            mergeMode: 'range',
            currentFrame: videoFrame(previous.frame + 1),
            rangeEndFrame: frame,
            clipEndFrame: frameBoundary(currentClip.endFrame),
          });
        });
      }
    }

    seekFrame(candidateFrame);
    commitAnnotations(next);
    selectOnlyAnnotation(annotationId);
    const selected = next.find((annotation) => annotation.id === annotationId);
    const selectedIndex = selected?.keyframes.findIndex((keyframe) => keyframe.frame === frame) ?? -1;
    if (selectedIndex >= 0) {
      setSelectedKeyframe({ annotationId, kind: 'position', index: selectedIndex, frame: candidateFrame });
    }
    setTrackingSession({
      ...session,
      phase: 'choosing',
      annotationId,
      selectedDetection: detection,
      selectedCandidateIndex: candidateIndex,
      selectedFrame: candidateFrame,
      originFrame: session.originFrame ?? candidateFrame,
      runId: session.runId,
    });
  }, [annotations, color, commitAnnotations, currentClip.endFrame, defaultFontSize, provisionalPlayers, seekFrame, selectOnlyAnnotation, strokeWidth, trackingSession]);

  useEffect(() => {
    const session = trackingSession;
    if (
      session?.phase !== 'running'
      || !session.annotationId
      || !session.selectedDetection
      || session.selectedFrame == null
      || session.runId === activeTrackingRunRef.current
    ) return;
    activeTrackingRunRef.current = session.runId;
    const annotationId = session.annotationId;
    const selectedDetection = session.selectedDetection;
    const selectedFrame = session.selectedFrame;
    const controller = new AbortController();
    const seedFrame = videoFrame(selectedFrame);
    const range = { startFrame: seedFrame, endFrame: frameBoundary(currentClip.endFrame) };
    const runAnnotations = annotationsRef.current;

    if (!canRunRangeSidecarAction(range)) {
      setTrackingSession(null);
      return () => controller.abort();
    }

    void (async () => {
      setMessage(null);
      try {
        const selected = runAnnotations.find((annotation) => annotation.id === annotationId);
        if (!selected || selected.type !== 'highlight') throw new Error(t('clip.trackingNoSeed'));
        const selectedSeed = selected.keyframes.find((keyframe) => keyframe.frame === seedFrame);
        const seed = bboxToHighlight(selectedDetection, session.radius);
        const seedAnchor = { x: seed.cx, y: seed.cy + seed.radius * 0.35 };

        const convertKeyframes = (keyframes: TrackingKeyframe[]): HighlightKeyframe[] => {
          let converted = convertTrackingKeyframes(keyframes.map((keyframe) => ({
            tMs: keyframe.tMs,
            bbox: { x: keyframe.x, y: keyframe.y, w: keyframe.w, h: keyframe.h },
            visible: keyframe.visible,
          })), 'highlight', video.fps, video.frameCount, {
            highlightRadius: session.radius,
          }).filter((keyframe) => keyframe.frame >= range.startFrame && keyframe.frame < range.endFrame) as HighlightKeyframe[];
          if (selectedSeed?.provenance) {
            converted = converted.map((keyframe) => keyframe.frame === seedFrame
              ? { ...keyframe, provenance: selectedSeed.provenance }
              : keyframe);
          }
          return converted;
        };

        const annotationsWithTrackedFrames = (tracked: HighlightKeyframe[]): ClipAnnotation[] => {
          const mergedPrimary = mergeTrackedKeyframesIntoAnnotation(selected, tracked, {
            mergeMode: 'forward',
            currentFrame: seedFrame,
            clipEndFrame: frameBoundary(currentClip.endFrame),
          });
          return runAnnotations.map((annotation) => {
            if (annotation.id === selected.id) return mergedPrimary;
            if (annotation.trackingAnchorId !== selected.id || annotation.coordMode !== 'image') return annotation;
            const followerSeed = interpolateAnnotation(annotation, seedFrame, frameBoundary(currentClip.endFrame));
            if (!followerSeed) return annotation;
            const base = geometryFromInterpolated(followerSeed);
            const followerKeyframes = tracked.map((highlight) => {
              const anchorY = highlight.cy + highlight.radius * 0.35;
              return {
                frame: highlight.frame,
                provenance: highlight.provenance,
                ...(highlight.visible === false ? { visible: false } : {}),
                ...translateGeometry(annotation.type, base, highlight.cx - seedAnchor.x, anchorY - seedAnchor.y),
              } as ClipKeyframe;
            });
            return mergeTrackedKeyframesIntoAnnotation(annotation, followerKeyframes, {
              mergeMode: 'forward',
              currentFrame: seedFrame,
              clipEndFrame: frameBoundary(currentClip.endFrame),
            });
          });
        };

        const liveKeyframes: TrackingKeyframe[] = [];
        const result = await requestTrackingStream({
          videoRef,
          videoPath,
          startMs: Number(frameToMs(seedFrame, video.fps)),
          endMs: Number(sidecarSampleEndMs(range, video.fps)),
          seedFrameMs: Number(frameToMs(seedFrame, video.fps)),
          seedBbox: selectedDetection,
          fps: video.fps,
          stopOnLoss: true,
        }, (keyframe) => {
          liveKeyframes.push(keyframe);
          const converted = convertKeyframes(liveKeyframes);
          activeTrackingFrameRef.current = converted.at(-1)?.frame ?? activeTrackingFrameRef.current;
          replaceAnnotations(annotationsWithTrackedFrames(converted));
        }, sidecar.baseUrl, controller.signal);

        let tracked = convertKeyframes(result.keyframes);

        const lastTracked = tracked.at(-1);
        let lossFrame: number | null = null;
        if (result.stoppedAtMs != null && lastTracked) {
          const reportedLossFrame = timestampMsToNearestFrame(result.stoppedAtMs, video.fps, video.frameCount);
          lossFrame = Math.min(
            currentClip.endFrame - 1,
            Math.max(selectedFrame + 1, lastTracked.frame + 1, reportedLossFrame),
          );
          if (lossFrame > lastTracked.frame) {
            tracked = [...tracked, {
              ...lastTracked,
              frame: videoFrame(lossFrame),
              provenance: 'lost',
              visible: false,
            }];
          }
        }

        const next = annotationsWithTrackedFrames(tracked);
        commitAnnotations(next, true, runAnnotations);
        setMessage(t('clip.trackedFrames', { count: formatNumber(result.keyframes.length) }));

        if (lossFrame != null && lossFrame < currentClip.endFrame) {
          seekFrame(lossFrame);
          setTrackingSession({
            ...session,
            phase: 'choosing',
            hasStarted: true,
            selectedDetection: null,
            selectedCandidateIndex: null,
            selectedFrame: null,
          });
        } else {
          const finalFrame = lastTracked?.frame ?? selectedFrame;
          seekFrame(finalFrame);
          setTrackingSession(null);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setMessage((error as TrackingError)?.message || (error instanceof Error ? error.message : String(error)));
        setTrackingSession({
          ...session,
          phase: 'choosing',
          hasStarted: true,
          selectedDetection: null,
          selectedCandidateIndex: null,
          selectedFrame: null,
        });
      }
    })();

    return () => controller.abort();
  }, [commitAnnotations, currentClip.endFrame, formatNumber, replaceAnnotations, seekFrame, sidecar.baseUrl, t, trackingSession, video.fps, video.frameCount, videoPath, videoRef]);

  const computeHomography = useCallback(async () => {
    if (!videoRef && !videoPath) {
      setMessage(t('clip.videoNotRegistered'));
      return;
    }
    const range = { startFrame: videoFrame(currentClip.startFrame), endFrame: frameBoundary(currentClip.endFrame) };
    if (!canRunRangeSidecarAction(range)) {
      setMessage(t('clip.homographyMinimum'));
      return;
    }
    setComputingHomography(true);
    setMessage(null);
    try {
      const startMs = Number(frameToMs(range.startFrame, video.fps));
      const endMs = Number(sidecarSampleEndMs(range, video.fps));
      const result = await requestHomography({
        videoRef,
        videoPath,
        startMs,
        endMs,
        fps: 5,
        skipInterval: CLIP_HOMOGRAPHY_SKIP_INTERVAL,
      }, sidecar.baseUrl);
      setHomographyFrames(result.frames);
      if (projectDir) await writeHomographyCache(projectDir, video.id, startMs, endMs, result.frames);
      setMessage(t('clip.homographyLoaded', { count: formatNumber(result.frames.length) }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setComputingHomography(false);
    }
  }, [currentClip.endFrame, currentClip.startFrame, formatNumber, projectDir, sidecar.baseUrl, t, video.fps, video.id, videoPath, videoRef]);

  const deleteHomography = useCallback(async () => {
    const range = { startFrame: videoFrame(currentClip.startFrame), endFrame: frameBoundary(currentClip.endFrame) };
    const startMs = Number(frameToMs(range.startFrame, video.fps));
    const endMs = Number(sidecarSampleEndMs(range, video.fps));
    if (projectDir) {
      await deleteOverlappingHomographyCache(projectDir, video.id, startMs, endMs);
    }
    setHomographyFrames(null);
    setShowHomography(false);
    setDrawCoordMode('image');
    setMessage(t('clip.homographyDeleted'));
  }, [currentClip.endFrame, currentClip.startFrame, projectDir, t, video.fps, video.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editingPinId) return;
      if (isTextInput(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        seekFrame(currentFrame + (event.key === 'ArrowLeft' ? -1 : 1));
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      if (event.key.toLowerCase() === 'k' && selectedAnnotationId) {
        event.preventDefault();
        upsertKeyframe(selectedAnnotationId);
        return;
      }
      if (event.key === 'Enter' && tool === 'poly') {
        event.preventDefault();
        finishPoly(!event.shiftKey && polyPoints.length >= 3);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setPointerDraft(null);
        setPolyPoints([]);
        setPolyCursor(null);
        setArrowStart(null);
        setArrowCursor(null);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (event.shiftKey) deleteSelectedObject();
        else deleteSelectedKeyframe();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [currentFrame, deleteSelectedKeyframe, deleteSelectedObject, editingPinId, finishPoly, polyPoints.length, redo, seekFrame, selectedAnnotationId, togglePlayback, tool, undo, upsertKeyframe]);

  const selectedCurrentKeyframe = selectedAnnotation
    ? getCurrentKeyframe(selectedAnnotation, videoFrame(currentFrame))
    : null;
  const selectedVisibilityKeyframe = selectedAnnotation
    ? getCurrentVisibilityKeyframe(selectedAnnotation, videoFrame(currentFrame))
    : null;
  const selectedInterpolatedGeometry = selectedAnnotation
    ? interpolateAnnotation(
        selectedAnnotation,
        videoFrame(currentFrame),
        frameBoundary(currentClip.endFrame),
      )
    : null;
  const selectedShadowRadius = selectedAnnotation?.type === 'shadow'
    && selectedInterpolatedGeometry
    && 'r' in selectedInterpolatedGeometry
    ? Number(selectedInterpolatedGeometry.r)
    : null;
  const selectedShadowSpread = selectedAnnotation?.type === 'shadow'
    && selectedInterpolatedGeometry
    && 'spreadDeg' in selectedInterpolatedGeometry
    ? Number(selectedInterpolatedGeometry.spreadDeg)
    : null;
  const selectedTrackingState = selectedAnnotation
    ? getFrameTrackingState(selectedAnnotation, videoFrame(currentFrame), frameBoundary(currentClip.endFrame))
    : null;
  const timelineClip = useMemo(
    () => ({ ...currentClip, annotations }),
    [annotations, currentClip],
  );
  const selectTimelineAnnotation = useCallback((
    annotationId: string,
    additive = false,
    subtractive = false,
  ) => {
    selectAnnotationFromUi(
      annotationId,
      selectionModeFromModifiers(additive, subtractive),
    );
    setTool('select');
  }, [selectAnnotationFromUi]);
  const selectTimelinePin = useCallback((pinId: string, frame: number) => {
    setSelectedPinId(pinId);
    seekFrame(frame);
  }, [seekFrame]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-black"
      data-testid="clip-editor"
      data-playback-paused-pin-id={playbackPausedPinId ?? undefined}
    >
      <div className="workspace-bar overflow-x-auto">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            className="shrink-0 border-r border-border px-3 text-xs"
            aria-pressed={tool === entry.id}
            onClick={() => {
              setTool(entry.id);
              setPointerDraft(null);
              setPolyPoints([]);
              setPolyCursor(null);
              setArrowStart(null);
              setArrowCursor(null);
            }}
          >
            {t(`tool.${entry.id}`)}
          </button>
        ))}
        <label className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs text-muted">
          {t('annotation.stroke')}
          <input aria-label={t('annotation.strokeColor')} type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>
        <label className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs text-muted">
          {t('annotation.width')}
          <input
            aria-label={t('annotation.width')}
            className="clip-stroke-width-input"
            type="number"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={(event) => setStrokeWidth(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
          />
        </label>
        {activeToolSupportsPitch && currentHomography && (
          <button
            className="border-0 border-r border-solid border-border px-3 text-xs"
            onClick={() => setDrawCoordMode((mode) => mode === 'pitch' ? 'image' : 'pitch')}
          >
            {t('clip.drawMode', { mode: t(drawCoordMode === 'pitch' ? 'clip.coordPitch' : 'clip.coordImage') })}
          </button>
        )}
      </div>

      <ClipEditorShell
        viewer={(
          <>
          <div
            ref={viewerSurfaceRef}
            data-testid="clip-viewer-surface"
            className="relative min-h-0 flex-1 overflow-hidden bg-black"
          >
              <video
                ref={videoElementRef}
                data-testid="clip-source-video"
                src={videoUrl}
                className="absolute inset-0 h-full w-full object-contain"
                playsInline
                preload="auto"
                onLoadedMetadata={(event) => {
                  const element = event.currentTarget;
                  setVideoSize({ width: element.videoWidth || video.width, height: element.videoHeight || video.height });
                  synchronizeMediaToClipStart(element);
                }}
                onPause={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
              />
              <div
                data-testid="clip-overlay-frame"
                className="absolute"
                style={{
                  left: mediaRect.x,
                  top: mediaRect.y,
                  width: mediaRect.width,
                  height: mediaRect.height,
                }}
              >
                <canvas
                  ref={canvasRef}
                  data-testid="clip-stage"
                  className="absolute inset-0 h-full w-full touch-none"
                onPointerDown={(event) => {
                  if (playbackPausedPin) {
                    event.preventDefault();
                    void resumePlaybackFromPin();
                    return;
                  }
                  if (trackingSession || event.button !== 0) return;
                  const point = pointFromClient(event.clientX, event.clientY);
                  if (!point) return;
                  const selectionMode = selectionModeFromModifiers(
                    event.shiftKey,
                    event.metaKey || event.ctrlKey,
                  );
                  if (isPlaying) {
                    if (tool === 'select') {
                      const hit = findSelectionHit(point, selectionMode);
                      selectAnnotationFromUi(hit?.id ?? null, selectionMode);
                    }
                    return;
                  }
                  if (tool === 'arrow') {
                    const nextPoint = findHighlightHit(point) ?? point;
                    if (arrowStart) finishArrow(nextPoint);
                    else {
                      setArrowStart(nextPoint);
                      setArrowCursor(nextPoint);
                    }
                    return;
                  }
                  if (tool === 'poly') {
                    const highlight = findHighlightHit(point);
                    const nextPoint = highlight ?? point;
                    const nearVertexIndex = nearestPolyVertexIndex(polyPoints, point);
                    if (nearVertexIndex >= 0 && polyPoints.length >= 2) {
                      finishPoly(nearVertexIndex === 0 && polyPoints.length >= 3);
                    } else {
                      setPolyPoints((points) => {
                        const previous = points.at(-1);
                        return previous && isDuplicatePolyPoint(previous, nextPoint)
                          ? points
                          : [...points, nextPoint];
                      });
                      setPolyCursor({ raw: point, snapped: nextPoint });
                    }
                    return;
                  }
                  if (tool === 'select') {
                    const overlay = transformOverlayRef.current;
                    const transformHandle = overlay
                      ? hitShapeTransformHandle(overlay, point, transformHandleRadius * 1.8)
                      : null;
                    if (
                      transformHandle
                      && selectedAnnotation
                      && (selectedAnnotation.type === 'box' || selectedAnnotation.type === 'circle')
                    ) {
                      if (selectedAnnotation.coordMode === 'pitch' && !currentHomographyInverse) return;
                      const value = interpolateAnnotation(
                        selectedAnnotation,
                        videoFrame(currentFrame),
                        frameBoundary(currentClip.endFrame),
                      );
                      if (!value) return;
                      const baseGeometry = geometryFromInterpolated(value);
                      const shape = orientedClipShapeFromGeometry(
                        selectedAnnotation.type,
                        baseGeometry,
                      );
                      if (!shape) return;
                      const pitchPoint = selectedAnnotation.coordMode === 'pitch'
                        ? projectImagePointToPitchPoint(
                            currentHomographyInverse,
                            point.x,
                            point.y,
                          )
                        : null;
                      const nativePoint = pitchPoint
                        ? { x: pitchPoint.u, y: pitchPoint.v }
                        : point;
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setPointerDraft({
                        mode: 'transform',
                        start: point,
                        current: point,
                        annotationId: selectedAnnotation.id,
                        baseGeometry,
                        transformHandle: transformHandle.id,
                        rotationOffset: transformHandle.id === 'rotate'
                          ? rotationPointerOffset(shape, nativePoint)
                          : undefined,
                        startClient: { x: event.clientX, y: event.clientY },
                        hasMoved: false,
                      });
                      return;
                    }
                    const hit = findSelectionHit(point, selectionMode);
                    if (!hit) {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setPointerDraft({
                        mode: 'select',
                        start: point,
                        current: point,
                        startClient: { x: event.clientX, y: event.clientY },
                        hasMoved: false,
                        selectionMode,
                      });
                      return;
                    }
                    selectAnnotationFromUi(hit.id, selectionMode);
                    if (selectionMode !== 'replace') return;
                    const annotation = annotations.find((candidate) => candidate.id === hit.id);
                    if (!annotation) return;
                    const value = interpolateAnnotation(annotation, videoFrame(currentFrame), frameBoundary(currentClip.endFrame));
                    if (!value) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setPointerDraft({
                      mode: 'move',
                      start: point,
                      current: point,
                      annotationId: annotation.id,
                      baseGeometry: geometryFromInterpolated(value),
                      startClient: { x: event.clientX, y: event.clientY },
                      hasMoved: false,
                    });
                    return;
                  }
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setPointerDraft({ mode: 'draw', start: point, current: point });
                }}
                onPointerMove={(event) => {
                  const point = pointFromClient(event.clientX, event.clientY);
                  if (!point) return;
                  if (tool === 'arrow' && arrowStart && !trackingSession && !isPlaying) {
                    setArrowCursor(findHighlightHit(point) ?? point);
                    return;
                  }
                  if (tool === 'poly' && !trackingSession && !isPlaying) {
                    setPolyCursor({ raw: point, snapped: findHighlightHit(point) ?? point });
                    return;
                  }
                  if (!pointerDraft) {
                    const overlay = transformOverlayRef.current;
                    const handle = overlay
                      ? hitShapeTransformHandle(overlay, point, transformHandleRadius * 1.8)
                      : null;
                    event.currentTarget.style.cursor = handle?.cursor ?? (tool === 'select' ? 'default' : 'crosshair');
                    return;
                  }
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  setPointerDraft((draft) => {
                    if (!draft) return null;
                    if (draft.mode === 'draw' || !draft.startClient) return { ...draft, current: point };
                    const hasMoved = draft.hasMoved
                      || Math.hypot(
                        event.clientX - draft.startClient.x,
                        event.clientY - draft.startClient.y,
                      ) >= 4;
                    return hasMoved ? { ...draft, current: point, hasMoved: true } : draft;
                  });
                }}
                onPointerLeave={() => {
                  if (tool === 'poly') setPolyCursor(null);
                  if (tool === 'arrow') setArrowCursor(null);
                  if (canvasRef.current && !pointerDraft) {
                    canvasRef.current.style.cursor = tool === 'select' ? 'default' : 'crosshair';
                  }
                }}
                onDoubleClick={(event) => {
                  if (tool !== 'poly' || trackingSession || isPlaying) return;
                  event.preventDefault();
                  finishPoly(false);
                }}
                onContextMenu={(event) => {
                  if (tool !== 'poly' && tool !== 'arrow') return;
                  event.preventDefault();
                  setPolyPoints([]);
                  setPolyCursor(null);
                  setArrowStart(null);
                  setArrowCursor(null);
                }}
                onPointerUp={(event) => {
                  if (!pointerDraft) return;
                  const end = pointFromClient(event.clientX, event.clientY);
                  if (!end) {
                    setPointerDraft(null);
                    return;
                  }
                  if (pointerDraft.mode === 'select') {
                    const hasMoved = pointerDraft.hasMoved || (
                      pointerDraft.startClient
                      && Math.hypot(
                        event.clientX - pointerDraft.startClient.x,
                        event.clientY - pointerDraft.startClient.y,
                      ) >= 4
                    );
                    if (hasMoved) {
                      const bounds = selectionBounds(pointerDraft.start, end);
                      const hits = drawablesRef.current
                        .filter((drawable) => annotationsRef.current.some(
                          (annotation) => annotation.id === drawable.id,
                        ))
                        .filter((drawable) => boundsIntersect(drawableBounds(drawable), bounds))
                        .map((drawable) => drawable.id);
                      selectAnnotationsFromUi(
                        hits,
                        pointerDraft.selectionMode ?? 'replace',
                      );
                    } else if ((pointerDraft.selectionMode ?? 'replace') === 'replace') {
                      selectAnnotationsFromUi([], 'replace');
                    }
                  } else if (
                    pointerDraft.mode === 'move'
                    || pointerDraft.mode === 'transform'
                  ) {
                    const hasMoved = pointerDraft.hasMoved || (
                      pointerDraft.startClient
                      && Math.hypot(
                        event.clientX - pointerDraft.startClient.x,
                        event.clientY - pointerDraft.startClient.y,
                      ) >= 4
                    );
                    if (!hasMoved) {
                      setPointerDraft(null);
                      return;
                    }
                    const annotation = annotations.find((candidate) => candidate.id === pointerDraft.annotationId);
                    if (annotation && pointerDraft.baseGeometry) {
                      let geometry: Record<string, unknown> | null = null;
                      if (pointerDraft.mode === 'transform' && pointerDraft.transformHandle) {
                        if (annotation.coordMode !== 'pitch' || currentHomographyInverse) {
                          const shape = orientedClipShapeFromGeometry(
                            annotation.type,
                            pointerDraft.baseGeometry,
                          );
                          const pitchEnd = annotation.coordMode === 'pitch'
                            ? projectImagePointToPitchPoint(
                                currentHomographyInverse,
                                end.x,
                                end.y,
                              )
                            : null;
                          const nativeEnd = pitchEnd
                            ? { x: pitchEnd.u, y: pitchEnd.v }
                            : end;
                          if (shape) {
                            geometry = clipGeometryFromOrientedShape(
                              transformOrientedClipShape(
                                shape,
                                pointerDraft.transformHandle,
                                nativeEnd,
                                {
                                  minWidth: annotation.coordMode === 'pitch' ? 0.1 : 2,
                                  minHeight: annotation.coordMode === 'pitch' ? 0.1 : 2,
                                  rotationOffset: pointerDraft.rotationOffset,
                                },
                              ),
                            );
                          }
                        }
                      } else {
                        let dx = end.x - pointerDraft.start.x;
                        let dy = end.y - pointerDraft.start.y;
                        if (annotation.coordMode === 'pitch' && currentHomographyInverse) {
                          const startPitch = projectImagePointToPitchPoint(
                            currentHomographyInverse,
                            pointerDraft.start.x,
                            pointerDraft.start.y,
                          );
                          const endPitch = projectImagePointToPitchPoint(
                            currentHomographyInverse,
                            end.x,
                            end.y,
                          );
                          dx = endPitch.u - startPitch.u;
                          dy = endPitch.v - startPitch.v;
                        }
                        geometry = translateGeometry(
                          annotation.type,
                          pointerDraft.baseGeometry,
                          dx,
                          dy,
                        );
                      }
                      if (!geometry) {
                        setPointerDraft(null);
                        return;
                      }
                      const provenance: ClipKeyframeProvenance = annotation.source === 'manual' ? 'manual' : 'correction';
                      const keyframes = annotation.keyframes.filter((keyframe) => keyframe.frame !== currentFrame);
                      keyframes.push({ frame: videoFrame(currentFrame), provenance, ...geometry } as ClipKeyframe);
                      keyframes.sort((left, right) => left.frame - right.frame);
                      const next = annotations.map((candidate) => candidate.id === annotation.id
                        ? {
                            ...candidate,
                            keyframes,
                            visibilityKeyframes: candidate.visibilityKeyframes?.filter((keyframe) => keyframe.frame !== currentFrame),
                          }
                        : candidate);
                      commitAnnotations(next);
                      setSelectedKeyframe({
                        annotationId: annotation.id,
                        kind: 'position',
                        index: keyframes.findIndex((keyframe) => keyframe.frame === currentFrame),
                        frame: currentFrame,
                      });
                    }
                  } else if (tool !== 'select' && tool !== 'poly') {
                    let geometry = geometryFromDrag(tool, pointerDraft.start, end);
                    const usePitch = drawCoordMode === 'pitch' && activeToolSupportsPitch && !!currentHomographyInverse;
                    if (usePitch) geometry = convertImageGeometryToPitchGeometry(tool, geometry, currentHomographyInverse);
                    const annotation = createAnnotation(tool, currentFrame, geometry, color, strokeWidth, usePitch ? 'pitch' : 'image', defaultFontSize);
                    commitAnnotations([...annotations, annotation]);
                    selectOnlyAnnotation(annotation.id);
                    setSelectedKeyframe({ annotationId: annotation.id, kind: 'position', index: 0, frame: currentFrame });
                    setTool('select');
                  }
                  setPointerDraft(null);
                }}
                onPointerCancel={() => setPointerDraft(null)}
                />
                {trackingSession?.phase === 'choosing' && provisionalPlayers?.detections.map((detection, index) => {
                  const preview = bboxToHighlight(detection, trackingSession.radius);
                  return (
                    <button
                      key={`${provisionalPlayers.frame}-${index}`}
                      type="button"
                      aria-label={t('clip.playerCandidate', { number: formatNumber(index + 1) })}
                      data-testid={`tracking-candidate-${index}`}
                      className="absolute z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                      style={{
                        left: `${(preview.cx / videoSize.width) * 100}%`,
                        top: `${(preview.cy / videoSize.height) * 100}%`,
                      }}
                      onClick={() => chooseTrackingCandidate(index)}
                    />
                  );
                })}
              </div>
          </div>

          </>
        )}
        inspector={(
          <>
          <PinList
            currentFrame={currentFrame}
            hasPinAtCurrentFrame={!!pinAtCurrentFrame}
            selectedPin={selectedPin}
            pinLabelDraft={pinLabelDraft}
            canCreate={!!projectDir}
            hasDeletedPin={!!deletedPin}
            onOpenCurrent={createOrOpenPinAtCurrentFrame}
            onPinLabelChange={setPinLabelDraft}
            onSaveLabel={savePinLabel}
            onGoToPin={goToPin}
            onDelete={deleteSelectedPin}
            onUndoDelete={undoDeletePin}
          />
          <hr className="my-3 border-border" />
          <AnnotationInspector
            annotation={selectedAnnotation}
            selectedAnnotations={selectedAnnotations}
            trackingState={selectedTrackingState}
            hasPositionKeyframe={!!selectedCurrentKeyframe}
            hasVisibilityKeyframe={!!selectedVisibilityKeyframe}
            trackingPhase={trackingSession?.phase ?? 'idle'}
            trackingHasCandidate={!!trackingSession?.selectedDetection}
            trackingHasStarted={trackingSession?.hasStarted ?? false}
            detectingPlayers={detectingPlayers}
            canTrack={!!(videoRef || videoPath)}
            onAddKeyframe={() => {
              if (selectedAnnotation) upsertKeyframe(selectedAnnotation.id);
            }}
            onDeleteKeyframe={deleteSelectedKeyframe}
            onBeginTracking={beginTracking}
            onStartTracking={startTracking}
            onStopTracking={stopTracking}
            onRenameHighlight={renameSelectedHighlight}
            onDisplayHighlightName={setSelectedHighlightDisplayName}
            onHighlightNameFontSize={setSelectedHighlightNameFontSize}
            onUpdateSelectedStyles={updateSelectedAnnotationStyles}
            shadowRadius={selectedShadowRadius}
            shadowSpread={selectedShadowSpread}
            onUpdateShadowGeometry={updateSelectedShadowGeometry}
            defaultFontSize={defaultFontSize}
            selectedObjectCount={selectedAnnotationIds.length}
            canMergeObjects={objectMergeInspection.canMerge}
            onMergeObjects={mergeSelectedObjects}
            onDeleteObject={deleteSelectedObject}
          />
          <hr className="my-3 border-border" />
          <div className="space-y-2">
            <button
              className="w-full"
              onClick={() => void computeHomography()}
              disabled={computingHomography || (!videoRef && !videoPath)}
            >
              {computingHomography ? t('clip.computingHomography') : homographyFrames ? t('clip.recomputeHomography') : t('clip.computeHomography')}
            </button>
            {computingHomography && (
              <progress
                className="h-1.5 w-full accent-sky-400"
                aria-label={t('clip.homographyProgress')}
              />
            )}
            <div className="grid grid-cols-2 gap-1">
              <button
                data-testid="clip-toggle-homography"
                disabled={!homographyFrames?.length}
                aria-pressed={showHomography}
                onClick={() => setShowHomography((visible) => !visible)}
              >
                {showHomography ? t('annotation.hideHomography') : t('annotation.showHomography')}
              </button>
              <button
                data-testid="clip-delete-homography"
                disabled={!homographyFrames?.length || computingHomography}
                onClick={() => void deleteHomography()}
              >
                {t('annotation.deleteHomography')}
              </button>
            </div>
          </div>
          {message && <p className="mt-3 text-secondary" role="status">{message}</p>}
          <div className="mt-3 flex items-center justify-between text-muted">
            <span>{saveStatus === 'saving' ? t('clip.saving') : saveStatus === 'saved' ? t('clip.saved') : saveStatus === 'error' ? t('clip.saveFailed') : ''}</span>
            <span title={sidecar.connected ? sidecar.capabilities.join(', ') : t('clip.sidecarOffline')}>
              {t('clip.sidecar', { status: sidecar.connected ? '●' : '○' })}
            </span>
          </div>
          </>
        )}
        timeline={(
          <TimelineStrip
            clip={timelineClip}
            currentFrame={currentFrame}
            selectedAnnotationIds={selectedAnnotationIds}
            selectedPinId={selectedPinId}
            revealRequest={timelineRevealRequest}
            selectedKeyframe={selectedKeyframe}
            isPlaying={isPlaying}
            onSkipBack={() => seekFrame(currentFrame - Math.round(video.fps * 2))}
            onPrevious={() => seekFrame(currentFrame - 1)}
            onTogglePlayback={togglePlayback}
            onNext={() => seekFrame(currentFrame + 1)}
            onSkipForward={() => seekFrame(currentFrame + Math.round(video.fps * 2))}
            onSeek={seekFrame}
            onSelectAnnotation={selectTimelineAnnotation}
            onSelectPin={selectTimelinePin}
            onSelectKeyframe={setSelectedKeyframe}
            onMoveKeyframe={moveTimelineKeyframe}
          />
        )}
      />
      {editingPin && projectDir && (
        <PinAnnotator
          projectDir={projectDir}
          clip={{ ...currentClip, annotations }}
          pin={editingPin}
          video={video}
          sourceVideoRef={videoElementRef}
          videoRef={videoRef}
          onClipUpdate={acceptPinClipUpdate}
          onImportDocument={importPinDocument}
          onClose={closePinAnnotator}
        />
      )}
    </div>
  );
}
