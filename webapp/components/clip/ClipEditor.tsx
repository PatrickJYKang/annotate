"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect as KRect, Ellipse as KEllipse, Arrow as KArrow, Text as KText, Line as KLine, Circle as KCircle, Image as KImage, Shape as KShape, Transformer } from "react-konva";
import type { Clip, ClipAnnotation, ClipAnnotationType, ClipKeyframe, BoxKeyframe, CircleKeyframe, ShadowKeyframe, ArrowKeyframe, LobKeyframe, TextKeyframe, HighlightKeyframe } from "../../lib/types/clip";
import type { ProjectManifestV1 } from "../../lib/types/project";
import {
  interpolateAnnotationAtTime,
  type InterpolatedKeyframe,
  type InterpolatedBox,
  type InterpolatedCircle,
  type InterpolatedShadow,
  type InterpolatedArrow,
  type InterpolatedLob,
  type InterpolatedText,
  type InterpolatedPoly,
  type InterpolatedHighlight,
} from "../../lib/clip/interpolation";
import { hexToRgba, contrastStrokeForHex, dashFromStrokePattern, makeId } from "../../lib/annotate/shapeRendering";
import type { StrokePattern } from "../../lib/annotate/shapeRendering";
import {
  buildDefaultLobControlPoint,
  buildShadowSectorPoints,
  DEFAULT_SHADOW_RADIUS,
  DEFAULT_SHADOW_SPREAD_DEG,
  getBoundsForFlatPoints,
} from "../../lib/annotate/tacticalGeometry";
import { readPrimaryAnnotationDocumentForStill } from "../../lib/fs/annotationStorage";
import { writeClip } from "../../lib/fs/clipStorage";
import { findOverlappingCache, writeHomographyCache, type HomographyFrame } from "../../lib/fs/homographyCache";
import { useSidecar } from "../../lib/state/SidecarContext";
import { requestTracking, requestHomography, type TrackingError } from "../../lib/clip/sidecarClient";
import { convertTrackingKeyframes } from "../../lib/clip/bboxConvert";
import {
  getClipRelativeMsForStill,
  listStillsWithinClipBounds,
} from "../../lib/clip/stillRelationship";
import {
  applyHomography,
  ellipsePlaneToImagePoints,
  invert3,
  rectPlaneToImagePoints,
} from "../../lib/annotate/homography";
import { OcclusionCache, fetchOcclusionMask, compositeForeground, roundToFrame } from "../../lib/clip/occlusionCompositor";
import { applyStillImportToClip, importStillDocumentToClip } from "../../lib/clip/stillImport";
import {
  annotationTypeSupportsPitchCoords,
  convertImageGeometryToPitchGeometry,
  getProjectedPitchShapeBounds,
  projectPitchKeyframeToImageShape,
} from "../../lib/clip/pitchProjection";
import { resolveUsableHomographyAtTime } from "../../lib/clip/homographyInterpolation";
import {
  createDebouncedAsyncScheduler,
  deleteSelectedClipAnnotation,
  mergeTrackedKeyframesIntoAnnotation,
  recordClipAnnotationHistoryChange,
  redoClipAnnotationHistory,
  undoClipAnnotationHistory,
} from "../../lib/clip/editorState";
import {
  getSidecarVideoLocator,
  hasSidecarVideoSource,
  isTrackableAnnotationType,
} from "../../lib/clip/videoLocator";
import {
  countCorrectionKeyframes,
  getCurrentKeyframeAtTime,
  getFrameTrackingState,
  getKeyframeProvenance,
  getHiddenSpans,
  getNextCorrectionKeyframe,
} from "../../lib/clip/trackingState";
import ExportModal from "./ExportModal";
import TimelineStrip from "./TimelineStrip";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ClipTool = 'select' | 'box' | 'circle' | 'shadow' | 'arrow' | 'lob' | 'poly' | 'text' | 'highlight';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface ClipEditorProps {
  clip: Clip;
  videoUrl: string;
  videoFps: number;
  projectDir?: FileSystemDirectoryHandle;
  manifest?: ProjectManifestV1 | null;
  videoRef?: string;
  videoPath?: string;
  tool?: ClipTool;
  defaultColor?: string;
  defaultStrokeWidth?: number;
  onClipUpdate?: (clip: Clip) => void;
  onSaveStatus?: (status: SaveStatus) => void;
}

const PITCH_LENGTH_M = 105;
const PITCH_WIDTH_M = 68;
const PITCH_CENTER_X_M = PITCH_LENGTH_M / 2;
const CENTER_CIRCLE_RADIUS_M = 9.15;
const ANALYSIS_LOOP_OPTIONS_MS = [1000, 2000, 4000] as const;
const SHORT_SHUTTLE_MS = 250;
const LONG_SHUTTLE_MS = 1000;

function getTrackingAccentColor(state: "manual" | "tracked" | "correction" | "lost"): string {
  if (state === "tracked") return "#60a5fa";
  if (state === "correction") return "#f59e0b";
  if (state === "lost") return "#f87171";
  return "#e5e7eb";
}

function getTrackingStatusText(args: {
  hasCurrentKeyframe: boolean;
  frameState: "manual" | "tracked" | "correction" | "lost";
  currentProvenance: "manual" | "tracked" | "lost" | "correction" | null;
  isVisible: boolean;
}): string {
  const { hasCurrentKeyframe, frameState, currentProvenance, isVisible } = args;
  if (!isVisible || frameState === "lost") return "Tracker lost object here";
  if (hasCurrentKeyframe && currentProvenance === "correction") return "Current frame is a correction point";
  if (hasCurrentKeyframe && currentProvenance === "tracked") return "Current frame is a tracked keyframe";
  if (hasCurrentKeyframe && currentProvenance === "manual") return "Current frame is a manual keyframe";
  if (frameState === "correction") return "Current span follows a correction";
  if (frameState === "tracked") return "Current span is tracked";
  return "Current span is manual";
}

function drawLobPathWithArrowhead(
  ctx: CanvasRenderingContext2D | any,
  shape: any,
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  strokeWidth: number,
) {
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  ctx.strokeShape(shape);

  const tx = end.x - control.x;
  const ty = end.y - control.y;
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len;
  const uy = ty / len;
  const px = -uy;
  const py = ux;
  const headLength = Math.max(10, strokeWidth * 2.2);
  const headWidth = Math.max(8, strokeWidth * 1.6);
  const baseX = end.x - ux * headLength;
  const baseY = end.y - uy * headLength;

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(baseX + px * headWidth * 0.5, baseY + py * headWidth * 0.5);
  ctx.lineTo(baseX - px * headWidth * 0.5, baseY - py * headWidth * 0.5);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
}

function isFillCapableAnnotation(type: ClipAnnotationType, closed?: boolean): boolean {
  return type === 'box' || type === 'circle' || type === 'highlight' || type === 'shadow' || (type === 'poly' && closed !== false);
}

function getDefaultStrokeWidthForAnnotation(type: ClipAnnotationType): number {
  if (type === 'text') return 1;
  if (type === 'shadow') return 3;
  return 6;
}

function isTrackingAnchorFollowerType(type: ClipAnnotationType): boolean {
  return type === 'arrow' || type === 'lob' || type === 'poly';
}

function translateFollowerGeometry(
  props: InterpolatedKeyframe,
  dx: number,
  dy: number,
): Record<string, any> | null {
  switch (props.type) {
    case 'arrow':
      return {
        x1: props.x1 + dx,
        y1: props.y1 + dy,
        x2: props.x2 + dx,
        y2: props.y2 + dy,
      };
    case 'lob':
      return {
        x1: props.x1 + dx,
        y1: props.y1 + dy,
        cx: props.cx + dx,
        cy: props.cy + dy,
        x2: props.x2 + dx,
        y2: props.y2 + dy,
      };
    case 'poly':
      return {
        points: props.points.map(([x, y]) => [x + dx, y + dy] as [number, number]),
      };
    default:
      return null;
  }
}

function getHighlightImageAnchor(
  annotation: ClipAnnotation,
  props: InterpolatedKeyframe,
  homography: number[] | null,
): { x: number; y: number } | null {
  if (props.type !== 'highlight') return null;
  const highlight = props as InterpolatedHighlight;
  if (annotation.coordMode === 'pitch') {
    if (!homography) return null;
    const point = applyHomography(homography, highlight.cx, highlight.cy);
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }
  return { x: highlight.cx, y: highlight.cy + (highlight.radius * 0.35) };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClipEditor({
  clip,
  videoUrl,
  videoFps,
  projectDir,
  manifest = null,
  videoRef: sidecarVideoRef,
  videoPath,
  tool: toolProp,
  defaultColor: defaultColorProp,
  defaultStrokeWidth: defaultStrokeWidthProp,
  onClipUpdate,
  onSaveStatus,
}: ClipEditorProps) {
  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const currentTMsRef = useRef<number>(0);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const shadowAnchorRef = useRef<string | null>(null);
  const arrowStartRef = useRef<{ x: number; y: number; refId?: string | null } | null>(null);
  const lobStartRef = useRef<{ x: number; y: number; refId?: string | null } | null>(null);
  const polyTempRef = useRef<{ points: { x: number; y: number; refId?: string | null }[] } | null>(null);
  const polyNearIndexRef = useRef<number>(-1);
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const selectedNodeRef = useRef<any>(null);

  // Temp shape for preview during drawing (not a real annotation yet)
  type TempShape =
    | { type: 'box'; x: number; y: number; w: number; h: number }
    | { type: 'circle'; cx: number; cy: number; rx: number; ry: number }
    | { type: 'shadow'; x: number; y: number; r: number; rotation: number; spreadDeg: number }
    | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number }
    | { type: 'lob'; x1: number; y1: number; cx: number; cy: number; x2: number; y2: number }
    | { type: 'poly'; points: [number, number][]; closed: boolean }
    | null;
  const [tempShape, setTempShape] = useState<TempShape>(null);

  // --- Defaults ---
  const tool = toolProp || 'select';
  const defaultColor = defaultColorProp || '#000000';
  const defaultStrokeWidth = defaultStrokeWidthProp || 6;
  const defaultFill = defaultColor;
  const defaultFillOpacity = 0.3;
  const defaultFontSize = 48;
  const defaultTextHighlight = false;

  // --- State ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTMs, setCurrentTMs] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [analysisLoopDurationMs, setAnalysisLoopDurationMs] = useState<number>(2000);
  const [analysisLoopRange, setAnalysisLoopRange] = useState<{ startMs: number; endMs: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 450 });
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 1920, h: 1080 });
  const [annotations, setAnnotations] = useState<ClipAnnotation[]>(clip.annotations);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const selCandidateRef = useRef<{ x: number; y: number } | null>(null);
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // --- Homography state ---
  const [homographyFrames, setHomographyFrames] = useState<HomographyFrame[] | null>(null);
  const [isComputingHomography, setIsComputingHomography] = useState(false);
  const [showHomographyOverlay, setShowHomographyOverlay] = useState(false);
  const [drawCoordMode, setDrawCoordMode] = useState<'image' | 'pitch'>('pitch');
  const currentHomographyInvRef = useRef<number[] | null>(null);

  // --- Occlusion state ---
  const [occlusionEnabled, setOcclusionEnabled] = useState(false);
  const [foregroundCutout, setForegroundCutout] = useState<HTMLCanvasElement | null>(null);
  const [occlusionStatus, setOcclusionStatus] = useState<string | null>(null);
  const occlusionGenRef = useRef(0);
  const occlusionCacheRef = useRef(new OcclusionCache());

  // --- Export state ---
  const [showExportModal, setShowExportModal] = useState(false);
  const [isImportingStillId, setIsImportingStillId] = useState<string | null>(null);
  const [stillImportMessage, setStillImportMessage] = useState<string | null>(null);
  const annotationHistoryPastRef = useRef<ClipAnnotation[][]>([]);
  const annotationHistoryFutureRef = useRef<ClipAnnotation[][]>([]);
  const lastAnnotationHistoryStateRef = useRef<ClipAnnotation[]>(clip.annotations);
  const activeClipIdRef = useRef(clip.id);

  // Sync annotations from clip prop if it changes externally
  useEffect(() => {
    if (clip.id !== activeClipIdRef.current) {
      activeClipIdRef.current = clip.id;
      saveSchedulerRef.current?.cancel();
      annotationHistoryPastRef.current = [];
      annotationHistoryFutureRef.current = [];
      setAnalysisLoopRange(null);
      setSelectedAnnotationId(null);
      setSelectedAnnotationIds([]);
      setIsSelecting(false);
      selStartRef.current = null;
      selCandidateRef.current = null;
      setSelRect(null);
    }
    lastAnnotationHistoryStateRef.current = clip.annotations;
    setAnnotations(clip.annotations);
  }, [clip.id, clip.annotations]);

  // Load homography cache on mount
  useEffect(() => {
    if (!projectDir) return;
    (async () => {
      const cached = await findOverlappingCache(projectDir, clip.startMs, clip.endMs);
      if (cached) setHomographyFrames(cached);
    })();
  }, [projectDir, clip.startMs, clip.endMs]);

  const clipDurationMs = clip.endMs - clip.startMs;
  const inBoundsStills = useMemo(() => {
    if (!manifest) return [] as ProjectManifestV1['stills'];
    return listStillsWithinClipBounds(manifest.stills || [], clip);
  }, [manifest, clip]);

  // --- Build current clip object ---
  const currentClip = useMemo((): Clip => ({
    ...clip,
    annotations,
  }), [clip, annotations]);

  // --- Container sizing ---
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onResize = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(1, Math.floor(rect.width)), h: Math.max(1, Math.floor(rect.height)) });
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Compute scale to fit video in container ---
  const { stageW, stageH, scale, offsetX, offsetY } = useMemo(() => {
    const vw = videoSize.w || 1;
    const vh = videoSize.h || 1;
    const cw = size.w || 1;
    const ch = size.h || 1;
    const s = Math.min(cw / vw, ch / vh);
    const sw = Math.round(vw * s);
    const sh = Math.round(vh * s);
    const ox = Math.round((cw - sw) / 2);
    const oy = Math.round((ch - sh) / 2);
    return { stageW: sw, stageH: sh, scale: s, offsetX: ox, offsetY: oy };
  }, [size, videoSize]);

  // --- Video loaded ---
  const onLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideoSize({ w: v.videoWidth, h: v.videoHeight });
    setVideoReady(v.readyState >= 1);
    v.currentTime = clip.startMs / 1000;
  }, [clip.startMs]);

  const onSeeked = useCallback(() => {
    setVideoReady(true);
  }, []);

  const onVideoCanRender = useCallback(() => {
    setVideoReady(true);
  }, []);

  useEffect(() => {
    setVideoReady(false);
  }, [clip.id, videoUrl]);

  const buildAnalysisLoopRange = useCallback((centerMs: number, durationMs: number) => {
    if (clipDurationMs <= 0) return { startMs: 0, endMs: 0 };
    const loopDuration = Math.max(250, Math.min(durationMs, clipDurationMs));
    const halfDuration = loopDuration / 2;
    let startMs = Math.max(0, centerMs - halfDuration);
    let endMs = Math.min(clipDurationMs, centerMs + halfDuration);
    const actualDuration = endMs - startMs;

    if (actualDuration < loopDuration) {
      if (startMs <= 0) {
        endMs = Math.min(clipDurationMs, loopDuration);
      } else if (endMs >= clipDurationMs) {
        startMs = Math.max(0, clipDurationMs - loopDuration);
      }
    }

    return { startMs, endMs };
  }, [clipDurationMs]);

  // --- Playback sync loop ---
  useEffect(() => {
    const tick = () => {
      const v = videoRef.current;
      if (!v) { rafRef.current = requestAnimationFrame(tick); return; }

      const videoMs = v.currentTime * 1000;
      const tMs = videoMs - clip.startMs;
      const clamped = Math.max(0, Math.min(tMs, clipDurationMs));

      currentTMsRef.current = clamped;
      setCurrentTMs(clamped);

      if (analysisLoopRange && !v.paused) {
        if (clamped >= analysisLoopRange.endMs - 1) {
          const loopTarget = Math.max(0, Math.min(analysisLoopRange.startMs, clipDurationMs));
          v.currentTime = (clip.startMs + loopTarget) / 1000;
          currentTMsRef.current = loopTarget;
          setCurrentTMs(loopTarget);
        }
      } else if (clamped >= clipDurationMs && !v.paused) {
        // Auto-pause at end
        v.pause();
        setIsPlaying(false);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [analysisLoopRange, clip.startMs, clipDurationMs]);

  // --- Play / Pause ---
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const tMs = Math.max(0, Math.min(v.currentTime * 1000 - clip.startMs, clipDurationMs));
      if (analysisLoopRange) {
        const outsideLoop = tMs < analysisLoopRange.startMs || tMs >= analysisLoopRange.endMs - 1;
        if (outsideLoop) {
          v.currentTime = (clip.startMs + analysisLoopRange.startMs) / 1000;
        }
      } else if (tMs >= clipDurationMs - 1) {
        // If at end, reset to start
        v.currentTime = clip.startMs / 1000;
      }
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, [analysisLoopRange, clip.startMs, clipDurationMs]);

  // --- Frame step ---
  const stepFrame = useCallback((direction: 1 | -1) => {
    const v = videoRef.current;
    if (!v || !v.paused) return;
    const frameSec = 1 / videoFps;
    const newTime = v.currentTime + direction * frameSec;
    const minTime = clip.startMs / 1000;
    const maxTime = clip.endMs / 1000;
    v.currentTime = Math.max(minTime, Math.min(newTime, maxTime));
  }, [videoFps, clip.startMs, clip.endMs]);

  const shuttleByMs = useCallback((deltaMs: number) => {
    const v = videoRef.current;
    if (!v) return;
    const nextTMs = currentTMsRef.current + deltaMs;
    const clamped = Math.max(0, Math.min(nextTMs, clipDurationMs));
    v.currentTime = (clip.startMs + clamped) / 1000;
  }, [clip.startMs, clipDurationMs]);

  // --- Seek to clip-relative ms ---
  const seekToMs = useCallback((tMs: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(tMs, clipDurationMs));
    v.currentTime = (clip.startMs + clamped) / 1000;
  }, [clip.startMs, clipDurationMs]);

  // --- Auto-save (debounced 800ms) ---
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const saveSchedulerRef = useRef<ReturnType<typeof createDebouncedAsyncScheduler<Clip>> | null>(null);

  useEffect(() => {
    if (!projectDir) {
      saveSchedulerRef.current?.cancel();
      saveSchedulerRef.current = null;
      return;
    }

    const scheduler = createDebouncedAsyncScheduler<Clip>(800, async (toSave) => {
      setSaveStatus('saving');
      onSaveStatus?.('saving');
      try {
        await writeClip(projectDir, toSave);
        setSaveStatus('saved');
        onSaveStatus?.('saved');
        onClipUpdate?.(toSave);
      } catch {
        setSaveStatus('error');
        onSaveStatus?.('error');
      }
    });

    saveSchedulerRef.current?.cancel();
    saveSchedulerRef.current = scheduler;
    return () => scheduler.cancel();
  }, [projectDir, onClipUpdate, onSaveStatus]);

  const scheduleSave = useCallback(() => {
    if (!projectDir || !saveSchedulerRef.current) return;
    saveSchedulerRef.current.schedule({ ...clip, annotations: annotationsRef.current });
  }, [projectDir, clip]);

  // Trigger save on annotation changes
  const prevAnnotationsRef = useRef(annotations);
  useEffect(() => {
    if (annotations !== prevAnnotationsRef.current) {
      prevAnnotationsRef.current = annotations;
      scheduleSave();
    }
  }, [annotations, scheduleSave]);

  useEffect(() => {
    const previous = lastAnnotationHistoryStateRef.current;
    if (annotations === previous) return;
    const history = recordClipAnnotationHistoryChange(
      previous,
      annotations,
      annotationHistoryPastRef.current,
    );
    annotationHistoryPastRef.current = history.past;
    annotationHistoryFutureRef.current = history.future;
    lastAnnotationHistoryStateRef.current = annotations;
  }, [annotations]);

  // Cleanup save timer
  useEffect(() => {
    return () => {
      saveSchedulerRef.current?.cancel();
    };
  }, []);

  // --- Annotation mutation helpers ---

  // Insert or update keyframe at tMs for an annotation
  const upsertKeyframe = useCallback((annId: string, tMs: number, props: Record<string, any>) => {
    const frameTolerance = 1000 / videoFps;
    setAnnotations(prev => prev.map(ann => {
      if (ann.id !== annId) return ann;
      const kfs = [...ann.keyframes];
      const nextProvenance = ann.source === 'auto' || ann.source === 'corrected' ? 'correction' : 'manual';
      const existIdx = kfs.findIndex(k => Math.abs(k.tMs - tMs) < frameTolerance);
      if (existIdx >= 0) {
        kfs[existIdx] = { ...kfs[existIdx], ...props, tMs, provenance: nextProvenance };
      } else {
        kfs.push({ ...props, tMs, provenance: nextProvenance } as ClipKeyframe);
        kfs.sort((a, b) => a.tMs - b.tMs);
      }
      const source = ann.source === 'auto' ? 'corrected' as const : ann.source;
      return { ...ann, keyframes: kfs, source };
    }));
  }, [videoFps]);

  // Delete keyframe at index for an annotation (must keep at least 1)
  const deleteKeyframe = useCallback((annId: string, kfIndex: number) => {
    setAnnotations(prev => prev.map(ann => {
      if (ann.id !== annId) return ann;
      if (ann.keyframes.length <= 1) return ann; // can't delete last
      const kfs = ann.keyframes.filter((_, i) => i !== kfIndex);
      return { ...ann, keyframes: kfs };
    }));
  }, []);

  // Create a new annotation with a single keyframe at currentTMs
  const createAnnotation = useCallback((type: ClipAnnotationType, geometry: Record<string, any>) => {
    const usePitchCoords =
      drawCoordMode === 'pitch'
      && annotationTypeSupportsPitchCoords(type)
      && !!currentHomographyInvRef.current;
    const keyframeGeometry = usePitchCoords
      ? convertImageGeometryToPitchGeometry(type, geometry, currentHomographyInvRef.current)
      : geometry;

    let style: ClipAnnotation['style'];
    if (type === 'shadow') {
      style = {
        stroke: defaultColor,
        strokeWidth: Math.max(2, Math.min(defaultStrokeWidth, 4)),
        strokePattern: 'solid',
        fill: defaultFill,
        fillOpacity: Math.max(defaultFillOpacity, 0.22),
      };
    } else if (type === 'text') {
      style = {
        stroke: defaultColor,
        strokeWidth: 1,
        strokePattern: 'solid',
        fontSize: defaultFontSize,
        fontFamily: 'Inter, system-ui, sans-serif',
        textHighlight: defaultTextHighlight,
      };
    } else if (isFillCapableAnnotation(type)) {
      style = {
        stroke: defaultColor,
        strokeWidth: defaultStrokeWidth,
        strokePattern: 'solid',
        fill: defaultFill,
        fillOpacity: defaultFillOpacity,
      };
    } else {
      style = {
        stroke: defaultColor,
        strokeWidth: defaultStrokeWidth,
        strokePattern: 'solid',
      };
    }

    const ann: ClipAnnotation = {
      id: makeId(),
      type,
      coordMode: usePitchCoords ? 'pitch' : 'image',
      source: 'manual',
      style,
      keyframes: [{ tMs: currentTMsRef.current, provenance: 'manual', ...keyframeGeometry } as ClipKeyframe],
    };
    setAnnotations(prev => [...prev, ann]);
    setSelectedAnnotationIds([]);
    setSelectedAnnotationId(ann.id);
    return ann.id;
  }, [
    defaultColor,
    defaultStrokeWidth,
    defaultFill,
    defaultFillOpacity,
    defaultFontSize,
    defaultTextHighlight,
    drawCoordMode,
  ]);

  // Delete selected annotation
  const deleteSelectedAnnotation = useCallback(() => {
    if (selectedAnnotationIds.length > 0) {
      const idsToDelete = new Set(selectedAnnotationIds);
      setAnnotations(annotationsRef.current.filter((annotation) => !idsToDelete.has(annotation.id)));
      setSelectedAnnotationIds([]);
      setSelectedAnnotationId(null);
      return;
    }
    const result = deleteSelectedClipAnnotation(annotationsRef.current, selectedAnnotationId);
    setAnnotations(result.annotations);
    setSelectedAnnotationId(result.selectedAnnotationId);
    setSelectedAnnotationIds([]);
  }, [selectedAnnotationId, selectedAnnotationIds]);

  // --- Sidecar (tracking) ---
  const sidecar = useSidecar();
  const videoLocator = useMemo(
    () => getSidecarVideoLocator(sidecarVideoRef, videoPath),
    [sidecarVideoRef, videoPath],
  );
  const hasVideoSource = hasSidecarVideoSource(videoLocator);
  const hasTrackingCapability = sidecar.connected && sidecar.capabilities.includes('tracking');
  const canTrack = hasTrackingCapability && hasVideoSource;
  const [isTracking, setIsTracking] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const retrySidecar = sidecar.retry;

  // Promptly refresh sidecar status when the editor mounts.
  useEffect(() => {
    retrySidecar();
  }, [retrySidecar]);

  // Undo snapshot: stores previous keyframes before a re-track operation
  const [undoSnapshot, setUndoSnapshot] = useState<{
    annId: string;
    keyframes: ClipKeyframe[];
    source: ClipAnnotation['source'];
  } | null>(null);

  // Re-track range endpoint (clip-relative ms), set via shift-click on timeline
  const [retrackRangeEndMs, setRetrackRangeEndMs] = useState<number | null>(null);

  // --- Occlusion (segmentation) ---
  const canSegment = sidecar.connected && sidecar.capabilities.includes('segmentation') && hasVideoSource;

  useEffect(() => {
    if (!occlusionEnabled || isPlaying || !hasVideoSource || !canSegment) {
      occlusionGenRef.current++;
      setForegroundCutout(null);
      if (!canSegment) {
        setOcclusionStatus(null);
      } else if (!occlusionEnabled) {
        setOcclusionStatus('Occlusion off');
      } else if (isPlaying) {
        setOcclusionStatus('Paused-frame only');
      } else {
        setOcclusionStatus('Waiting for paused frame');
      }
      return;
    }

    const absMs = clip.startMs + currentTMs;
    const frameKey = roundToFrame(absMs, videoFps);
    const cache = occlusionCacheRef.current;

    // Check cache first
    const cached = cache.get(frameKey);
    if (cached) {
      const v = videoRef.current;
      if (v && v.videoWidth > 0) {
        const cutout = compositeForeground(v, cached, videoSize.w, videoSize.h);
        setForegroundCutout(cutout);
        setOcclusionStatus('Foreground mask ready');
      }
      return;
    }

    const token = ++occlusionGenRef.current;
    setForegroundCutout(null);
    setOcclusionStatus('Loading paused-frame mask…');

    (async () => {
      try {
        const { mask, personCount } = await fetchOcclusionMask(videoLocator, absMs);
        if (token !== occlusionGenRef.current) { mask.close(); return; }
        cache.set(frameKey, mask);
        const v = videoRef.current;
        if (v && v.videoWidth > 0) {
          const cutout = compositeForeground(v, mask, videoSize.w, videoSize.h);
          if (token !== occlusionGenRef.current) return;
          setForegroundCutout(cutout);
          setOcclusionStatus(personCount > 0 ? 'Foreground mask ready' : 'No players detected on this frame');
        }
      } catch (err) {
        if (token !== occlusionGenRef.current) return;
        setOcclusionStatus('Foreground mask unavailable');
        console.warn('Occlusion fetch failed:', err);
      }
    })();
  }, [occlusionEnabled, isPlaying, currentTMs, hasVideoSource, canSegment, clip.startMs, videoFps, videoSize.w, videoSize.h, videoLocator]);

  // Clear occlusion cache on unmount
  useEffect(() => {
    const cache = occlusionCacheRef.current;
    return () => { cache.clear(); };
  }, []);

  // Clear range when annotation deselection changes
  const selectionSignature = selectedAnnotationIds.length > 0
    ? selectedAnnotationIds.join(',')
    : (selectedAnnotationId || '');
  const prevSelectedRef = useRef(selectionSignature);
  useEffect(() => {
    if (selectionSignature !== prevSelectedRef.current) {
      prevSelectedRef.current = selectionSignature;
      setRetrackRangeEndMs(null);
    }
  }, [selectionSignature]);

  // Helper: determine if selected annotation is a corrected/auto tracked annotation
  const selectedAnn = useMemo(() => {
    if (selectedAnnotationIds.length > 0) return null;
    if (!selectedAnnotationId) return null;
    return annotations.find(a => a.id === selectedAnnotationId) || null;
  }, [selectedAnnotationId, selectedAnnotationIds, annotations]);
  const currentFrameToleranceMs = 1000 / Math.max(1, videoFps);
  const selectedAnnInterpolated = useMemo(() => {
    if (!selectedAnn) return null;
    return interpolateAnnotationAtTime(selectedAnn, currentTMs, videoFps, clipDurationMs);
  }, [selectedAnn, currentTMs, videoFps, clipDurationMs]);
  const selectedKeyframeIndexAtCurrentFrame = useMemo(() => {
    if (!selectedAnn) return -1;
    return selectedAnn.keyframes.findIndex((keyframe) => Math.abs(keyframe.tMs - currentTMs) <= currentFrameToleranceMs);
  }, [selectedAnn, currentTMs, currentFrameToleranceMs]);
  const selectedHasCurrentKeyframe = selectedKeyframeIndexAtCurrentFrame >= 0;
  const selectedCanDeleteCurrentKeyframe = !!selectedAnn && selectedHasCurrentKeyframe && selectedAnn.keyframes.length > 1;
  const selectedCanInsertCurrentKeyframe = !!selectedAnnInterpolated && !selectedHasCurrentKeyframe;
  const selectedCurrentKeyframe = useMemo(() => {
    if (!selectedAnn) return null;
    return getCurrentKeyframeAtTime(selectedAnn, currentTMs, currentFrameToleranceMs);
  }, [selectedAnn, currentTMs, currentFrameToleranceMs]);
  const selectedFrameTrackingState = useMemo(() => {
    if (!selectedAnn) return null;
    return getFrameTrackingState(selectedAnn, currentTMs, currentFrameToleranceMs, clipDurationMs, videoFps);
  }, [selectedAnn, currentTMs, currentFrameToleranceMs, clipDurationMs, videoFps]);
  const selectedCurrentKeyframeProvenance = useMemo(() => {
    if (!selectedAnn || !selectedCurrentKeyframe) return null;
    return getKeyframeProvenance(selectedAnn, selectedCurrentKeyframe);
  }, [selectedAnn, selectedCurrentKeyframe]);
  const selectedLossSpans = useMemo(() => {
    if (!selectedAnn) return [];
    return getHiddenSpans(selectedAnn, clipDurationMs, videoFps);
  }, [selectedAnn, clipDurationMs, videoFps]);
  const selectedCorrectionCount = useMemo(() => {
    if (!selectedAnn) return 0;
    return countCorrectionKeyframes(selectedAnn);
  }, [selectedAnn]);
  const selectedNextCorrectionKeyframe = useMemo(() => {
    if (!selectedAnn) return null;
    return getNextCorrectionKeyframe(selectedAnn, currentTMs, currentFrameToleranceMs);
  }, [selectedAnn, currentTMs, currentFrameToleranceMs]);
  const retrackRangeBounds = useMemo(() => {
    if (retrackRangeEndMs == null) return null;
    return {
      startMs: Math.min(currentTMs, retrackRangeEndMs),
      endMs: Math.max(currentTMs, retrackRangeEndMs),
    };
  }, [currentTMs, retrackRangeEndMs]);
  const hasUsableHomographyAtCurrentFrame = useMemo(
    () => !!resolveUsableHomographyAtTime(homographyFrames, clip.startMs + currentTMs),
    [homographyFrames, clip.startMs, currentTMs],
  );
  const selectedTrackingAccentColor = selectedFrameTrackingState
    ? getTrackingAccentColor(selectedFrameTrackingState)
    : "#60a5fa";
  const selectedTrackingStatusText = selectedAnn
    ? getTrackingStatusText({
        hasCurrentKeyframe: selectedHasCurrentKeyframe,
        frameState: selectedFrameTrackingState ?? "manual",
        currentProvenance: selectedCurrentKeyframeProvenance,
        isVisible: !!selectedAnnInterpolated,
      })
    : "";

  const canTrackSelection = !!selectedAnn
    && isTrackableAnnotationType(selectedAnn.type)
    && (selectedAnn.coordMode === 'image' || hasUsableHomographyAtCurrentFrame);
  const trackButtonEnabled = canTrack && canTrackSelection;
  const trackButtonTitle = !hasTrackingCapability
    ? 'Tracking unavailable: sidecar not connected or tracking model missing'
    : !hasVideoSource
      ? 'Tracking unavailable: no registered video source'
      : !selectedAnn
        ? 'Select an annotation to track'
        : !isTrackableAnnotationType(selectedAnn.type)
          ? 'Tracking supports highlight annotations'
          : selectedAnn.coordMode === 'pitch' && !hasUsableHomographyAtCurrentFrame
            ? 'Tracking needs a usable homography to project this pitch annotation back into image space'
            : 'Track selected highlight until the next keyframe or clip end';

  const showRetrackButton = canTrack && selectedAnn &&
    (selectedAnn.source === 'auto' || selectedAnn.source === 'corrected') &&
    isTrackableAnnotationType(selectedAnn.type);
  const canRetrackRange = showRetrackButton && retrackRangeBounds != null && retrackRangeBounds.startMs !== retrackRangeBounds.endMs;
  const canRetrackToNextCorrection = showRetrackButton && !!selectedNextCorrectionKeyframe;

  // Helper: extract seed bbox from interpolated annotation
  const extractSeedBbox = useCallback((
    ann: ClipAnnotation,
    interp: InterpolatedKeyframe,
  ): { x: number; y: number; w: number; h: number } | null => {
    if (!isTrackableAnnotationType(ann.type)) return null;
    const resolvedHomography = resolveUsableHomographyAtTime(homographyFrames, clip.startMs + currentTMsRef.current);
    let bounds: { x: number; y: number; w: number; h: number } | null = null;
    if (ann.coordMode === 'pitch' && resolvedHomography) {
      const projected = projectPitchKeyframeToImageShape(interp, resolvedHomography);
      if (projected) {
        bounds = getProjectedPitchShapeBounds(projected, defaultFontSize);
      }
    } else if (interp.type === 'highlight') {
      const radius = interp.radius;
      bounds = {
        x: interp.cx - radius,
        y: interp.cy - radius * 0.35,
        w: radius * 2,
        h: radius * 0.7,
      };
    }
    if (!bounds) return null;
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || bounds.w <= 0 || bounds.h <= 0) {
      return null;
    }
    return bounds;
  }, [homographyFrames, clip.startMs, defaultFontSize]);

  const extractKeyframeGeometry = useCallback((interp: InterpolatedKeyframe): Record<string, any> | null => {
    switch (interp.type) {
      case 'box': {
        const b = interp as InterpolatedBox;
        return { x: b.x, y: b.y, w: b.w, h: b.h };
      }
      case 'circle': {
        const c = interp as InterpolatedCircle;
        return { cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry };
      }
      case 'shadow': {
        const s = interp as InterpolatedShadow;
        return { x: s.x, y: s.y, r: s.r, rotation: s.rotation, spreadDeg: s.spreadDeg };
      }
      case 'arrow': {
        const a = interp as InterpolatedArrow;
        return { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 };
      }
      case 'lob': {
        const l = interp as InterpolatedLob;
        return { x1: l.x1, y1: l.y1, cx: l.cx, cy: l.cy, x2: l.x2, y2: l.y2 };
      }
      case 'text': {
        const t = interp as InterpolatedText;
        return { x: t.x, y: t.y };
      }
      case 'poly': {
        const p = interp as InterpolatedPoly;
        return { points: p.points.map(([x, y]) => [x, y] as [number, number]) };
      }
      case 'highlight': {
        const h = interp as InterpolatedHighlight;
        return { cx: h.cx, cy: h.cy, radius: h.radius };
      }
      default:
        return null;
    }
  }, []);

  const resolveAnnotationDisplayStyle = useCallback((ann: ClipAnnotation) => {
    const style = ann.style || {};
    const stroke = style.stroke || defaultColor;
    const strokeWidth = style.strokeWidth ?? getDefaultStrokeWidthForAnnotation(ann.type);
    const dash = dashFromStrokePattern(style.strokePattern as StrokePattern | undefined, strokeWidth);
    const fontSize = style.fontSize || defaultFontSize;
    const fontFamily = style.fontFamily || 'Inter, system-ui, sans-serif';
    const textHighlight = style.textHighlight ?? defaultTextHighlight;
    const fillEnabled = isFillCapableAnnotation(ann.type, ann.closed);
    const fallbackFillOpacity = ann.type === 'shadow' ? 0.22 : defaultFillOpacity;
    const fillColor = fillEnabled
      ? hexToRgba(style.fill && style.fill !== 'transparent' ? style.fill : stroke, style.fillOpacity ?? fallbackFillOpacity)
      : (style.fill && style.fill !== 'transparent'
          ? hexToRgba(style.fill, style.fillOpacity ?? defaultFillOpacity)
          : 'transparent');

    return {
      stroke,
      strokeWidth,
      dash,
      fillColor,
      fontSize,
      fontFamily,
      textHighlight,
      fillOpacity: style.fillOpacity ?? fallbackFillOpacity,
    };
  }, [defaultColor, defaultFillOpacity, defaultFontSize, defaultTextHighlight]);

  const getInterpolatedBounds = useCallback((ann: ClipAnnotation, props: InterpolatedKeyframe, homography: number[] | null = null) => {
    if (ann.coordMode === 'pitch' && homography) {
      const projected = projectPitchKeyframeToImageShape(props, homography);
      if (projected) {
        return getProjectedPitchShapeBounds(projected, resolveAnnotationDisplayStyle(ann).fontSize);
      }
    }
    switch (props.type) {
      case 'box': {
        const b = props as InterpolatedBox;
        return { x: b.x, y: b.y, w: b.w, h: b.h };
      }
      case 'circle': {
        const c = props as InterpolatedCircle;
        return { x: c.cx - c.rx, y: c.cy - c.ry, w: c.rx * 2, h: c.ry * 2 };
      }
      case 'shadow': {
        const s = props as InterpolatedShadow;
        return getBoundsForFlatPoints(buildShadowSectorPoints(s.x, s.y, s.r, s.rotation, s.spreadDeg));
      }
      case 'arrow': {
        const a = props as InterpolatedArrow;
        return getBoundsForFlatPoints([a.x1, a.y1, a.x2, a.y2]);
      }
      case 'lob': {
        const l = props as InterpolatedLob;
        return getBoundsForFlatPoints([l.x1, l.y1, l.cx, l.cy, l.x2, l.y2]);
      }
      case 'text': {
        const t = props as InterpolatedText;
        const fontSize = resolveAnnotationDisplayStyle(ann).fontSize;
        return { x: t.x, y: t.y, w: 100, h: fontSize };
      }
      case 'poly': {
        const p = props as InterpolatedPoly;
        return getBoundsForFlatPoints(p.points.flatMap(([x, y]) => [x, y]));
      }
      case 'highlight': {
        const h = props as InterpolatedHighlight;
        return { x: h.cx - h.radius, y: h.cy - (h.radius * 0.35), w: h.radius * 2, h: h.radius * 0.7 };
      }
      default:
        return { x: 0, y: 0, w: 0, h: 0 };
    }
  }, [resolveAnnotationDisplayStyle]);

  const selectedAnnCanUseTransformer = useMemo(() => {
    if (selectedAnnotationIds.length > 0) return false;
    if (!selectedAnn || !selectedAnnInterpolated) return false;
    if (selectedAnn.coordMode === 'pitch') return false;
    return (
      selectedAnnInterpolated.type === 'box'
      || selectedAnnInterpolated.type === 'circle'
      || selectedAnnInterpolated.type === 'highlight'
      || selectedAnnInterpolated.type === 'text'
    );
  }, [selectedAnn, selectedAnnInterpolated, selectedAnnotationIds]);

  // Shared tracking helper: call /track, convert keyframes, update annotation
  const doTrack = useCallback(async (
    ann: ClipAnnotation,
    seedBbox: { x: number; y: number; w: number; h: number },
    seedFrameMs: number,
    trackStartMs: number,
    trackEndMs: number,
    mergeMode: 'replace' | 'forward' | 'range' | 'to_correction',
    rangeEndMs?: number,
    mergeStartTMs?: number,
  ) => {
    if (!hasVideoSource) return;

    // Save undo snapshot before modifying
    setUndoSnapshot({ annId: ann.id, keyframes: [...ann.keyframes], source: ann.source });
    setIsTracking(true);
    setTrackError(null);

    try {
      const result = await requestTracking({
        videoRef: videoLocator.videoRef,
        videoPath: videoLocator.videoPath,
        startMs: trackStartMs,
        endMs: trackEndMs,
        seedBbox,
        seedFrameMs,
        fps: videoFps,
      }, sidecar.baseUrl);

      // Convert absolute-ms keyframes to clip-relative
      const newKeyframes = convertTrackingKeyframes(
        result.keyframes.map(kf => ({
          tMs: kf.tMs,
          bbox: { x: kf.x, y: kf.y, w: kf.w, h: kf.h },
          visible: kf.visible,
        })),
        ann.type,
        clip.startMs,
      );

      const effectiveMergeStartTMs = mergeStartTMs ?? currentTMsRef.current;
      const seedClipTMs = seedFrameMs - clip.startMs;
      const seedInterpolated = interpolateAnnotationAtTime(ann, seedClipTMs, videoFps, clipDurationMs);
      const seedHomography = resolveUsableHomographyAtTime(homographyFrames, seedFrameMs);
      const seedHighlightAnchor = seedInterpolated
        ? getHighlightImageAnchor(ann, seedInterpolated, seedHomography)
        : null;

      setAnnotations(prev => {
        const mergedAnnotations = prev.map((annotation) => {
          if (annotation.id !== ann.id) return annotation;
          return mergeTrackedKeyframesIntoAnnotation(annotation, newKeyframes, {
            mergeMode,
            currentTMs: effectiveMergeStartTMs,
            rangeEndMs,
            clipDurationMs,
          });
        });

        if (ann.type !== 'highlight' || !seedHighlightAnchor) {
          return mergedAnnotations;
        }

        return mergedAnnotations.map((annotation) => {
          if (annotation.id === ann.id) return annotation;
          if (annotation.trackingAnchorId !== ann.id) return annotation;
          if (!isTrackingAnchorFollowerType(annotation.type)) return annotation;
          if (annotation.coordMode !== 'image') return annotation;

          const baseProps = interpolateAnnotationAtTime(annotation, seedClipTMs, videoFps, clipDurationMs);
          if (!baseProps) return annotation;
          const baseGeometry = translateFollowerGeometry(baseProps, 0, 0);
          if (!baseGeometry) return annotation;

          const linkedKeyframes = newKeyframes.map((keyframe) => {
            const highlightKeyframe = keyframe as HighlightKeyframe;
            const isVisible = highlightKeyframe.visible !== false;
            const anchorY = highlightKeyframe.cy + (highlightKeyframe.radius * 0.35);
            const dx = isVisible ? (highlightKeyframe.cx - seedHighlightAnchor.x) : 0;
            const dy = isVisible ? (anchorY - seedHighlightAnchor.y) : 0;
            const translated = translateFollowerGeometry(baseProps, dx, dy) ?? baseGeometry;
            return {
              tMs: keyframe.tMs,
              provenance: keyframe.provenance,
              ...(isVisible ? {} : { visible: false }),
              ...translated,
            } as ClipKeyframe;
          });

          return mergeTrackedKeyframesIntoAnnotation(annotation, linkedKeyframes, {
            mergeMode,
            currentTMs: effectiveMergeStartTMs,
            rangeEndMs,
            clipDurationMs,
          });
        });
      });
      setRetrackRangeEndMs(null);
    } catch (e: any) {
      const msg = (e as TrackingError)?.message || e?.message || 'Tracking failed';
      setTrackError(msg);
      setUndoSnapshot(null); // Clear snapshot on failure
    } finally {
      setIsTracking(false);
    }
  }, [hasVideoSource, videoLocator, videoFps, clip.startMs, clipDurationMs, sidecar.baseUrl, homographyFrames]);

  // Full track: replace all keyframes
  const handleTrack = useCallback(async () => {
    if (!selectedAnn) return;
    const ann = selectedAnn;
    if (!isTrackableAnnotationType(ann.type)) {
      setTrackError('Tracking supports highlight annotations');
      return;
    }

    if (!selectedCurrentKeyframe) {
      setTrackError('Move to a keyed highlight frame to start tracking');
      return;
    }

    const seedTMs = selectedCurrentKeyframe.tMs;
    const interp = interpolateAnnotationAtTime(ann, seedTMs, videoFps, clipDurationMs);
    if (!interp) { setTrackError('No visible annotation at the selected keyframe'); return; }

    const seedBbox = extractSeedBbox(ann, interp);
    if (!seedBbox) {
      setTrackError(
        ann.coordMode === 'pitch'
          ? 'Need a usable homography at this frame to seed tracking from a pitch annotation'
          : 'Could not derive an image-space seed bbox for tracking',
      );
      return;
    }

    const nextKeyframe = ann.keyframes.find((keyframe) => keyframe.tMs > seedTMs + currentFrameToleranceMs);
    const seedAbsMs = clip.startMs + seedTMs;
    if (nextKeyframe) {
      await doTrack(
        ann,
        seedBbox,
        seedAbsMs,
        seedAbsMs,
        clip.startMs + nextKeyframe.tMs,
        'to_correction',
        nextKeyframe.tMs,
        seedTMs,
      );
      return;
    }

    await doTrack(
      ann,
      seedBbox,
      seedAbsMs,
      seedAbsMs,
      clip.endMs,
      'forward',
      undefined,
      seedTMs,
    );
  }, [
    selectedAnn,
    selectedCurrentKeyframe,
    videoFps,
    clip.startMs,
    clip.endMs,
    clipDurationMs,
    extractSeedBbox,
    doTrack,
    currentFrameToleranceMs,
  ]);

  // Re-track from here: keep keyframes <= currentTMs, re-track forward
  const handleRetrackFromHere = useCallback(async () => {
    if (!hasVideoSource || !selectedAnn) return;
    const ann = selectedAnn;
    const tMs = currentTMsRef.current;

    const interp = interpolateAnnotationAtTime(ann, tMs, videoFps, clipDurationMs);
    if (!interp) { setTrackError('No visible annotation at current time'); return; }

    const seedBbox = extractSeedBbox(ann, interp);
    if (!seedBbox) { setTrackError('Cannot extract an image-space bbox for re-tracking'); return; }

    const seedAbsMs = clip.startMs + tMs;
    await doTrack(ann, seedBbox, seedAbsMs, seedAbsMs, clip.endMs, 'forward', undefined, tMs);
  }, [hasVideoSource, selectedAnn, videoFps, clip.startMs, clip.endMs, extractSeedBbox, doTrack]);

  // Re-track range: re-track between currentTMs and retrackRangeEndMs
  const handleRetrackRange = useCallback(async () => {
    if (!hasVideoSource || !selectedAnn || retrackRangeEndMs == null) return;
    const ann = selectedAnn;
    const tMs = currentTMsRef.current;

    const interp = interpolateAnnotationAtTime(ann, tMs, videoFps, clipDurationMs);
    if (!interp) { setTrackError('No visible annotation at current time'); return; }

    const seedBbox = extractSeedBbox(ann, interp);
    if (!seedBbox) { setTrackError('Cannot extract an image-space bbox for re-tracking'); return; }

    const rangeStartMs = Math.min(tMs, retrackRangeEndMs);
    const rangeEndMs = Math.max(tMs, retrackRangeEndMs);
    const seedAbsMs = clip.startMs + tMs;
    const trackStart = clip.startMs + rangeStartMs;
    const trackEnd = clip.startMs + rangeEndMs;
    await doTrack(ann, seedBbox, seedAbsMs, trackStart, trackEnd, 'range', retrackRangeEndMs, tMs);
  }, [hasVideoSource, selectedAnn, retrackRangeEndMs, videoFps, clip.startMs, extractSeedBbox, doTrack]);

  const handleRetrackToNextCorrection = useCallback(async () => {
    if (!hasVideoSource || !selectedAnn || !selectedNextCorrectionKeyframe) return;
    const ann = selectedAnn;
    const tMs = currentTMsRef.current;
    const boundaryEndMs = selectedNextCorrectionKeyframe.tMs;

    const interp = interpolateAnnotationAtTime(ann, tMs, videoFps, clipDurationMs);
    if (!interp) { setTrackError('No visible annotation at current time'); return; }

    const seedBbox = extractSeedBbox(ann, interp);
    if (!seedBbox) { setTrackError('Cannot extract an image-space bbox for re-tracking'); return; }

    const seedAbsMs = clip.startMs + tMs;
    const trackStart = clip.startMs + Math.min(tMs, boundaryEndMs);
    const trackEnd = clip.startMs + Math.max(tMs, boundaryEndMs);
    await doTrack(ann, seedBbox, seedAbsMs, trackStart, trackEnd, 'to_correction', boundaryEndMs, tMs);
  }, [hasVideoSource, selectedAnn, selectedNextCorrectionKeyframe, videoFps, clip.startMs, extractSeedBbox, doTrack]);

  const handleSetRetrackRangeEnd = useCallback(() => {
    setRetrackRangeEndMs(currentTMsRef.current);
  }, []);

  const handleClearRetrackRange = useCallback(() => {
    setRetrackRangeEndMs(null);
  }, []);

  const handleUndoAnnotations = useCallback(() => {
    const result = undoClipAnnotationHistory({
      past: annotationHistoryPastRef.current,
      future: annotationHistoryFutureRef.current,
      currentAnnotations: annotationsRef.current,
      selectedAnnotationId,
    });
    if (!result.didUndo) return false;
    annotationHistoryPastRef.current = result.past;
    annotationHistoryFutureRef.current = result.future;
    lastAnnotationHistoryStateRef.current = result.annotations;
    setAnnotations(result.annotations);
    setSelectedAnnotationIds([]);
    setSelectedAnnotationId(result.selectedAnnotationId);
    return true;
  }, [selectedAnnotationId]);

  const handleRedoAnnotations = useCallback(() => {
    const result = redoClipAnnotationHistory({
      past: annotationHistoryPastRef.current,
      future: annotationHistoryFutureRef.current,
      currentAnnotations: annotationsRef.current,
      selectedAnnotationId,
    });
    if (!result.didRedo) return false;
    annotationHistoryPastRef.current = result.past;
    annotationHistoryFutureRef.current = result.future;
    lastAnnotationHistoryStateRef.current = result.annotations;
    setAnnotations(result.annotations);
    setSelectedAnnotationIds([]);
    setSelectedAnnotationId(result.selectedAnnotationId);
    return true;
  }, [selectedAnnotationId]);

  // Undo: revert the last tracking pass when a track-specific snapshot exists.
  const handleUndoTracking = useCallback(() => {
    if (!undoSnapshot) return;
    setAnnotations(prev => prev.map(a => {
      if (a.id !== undoSnapshot.annId) return a;
      return { ...a, keyframes: undoSnapshot.keyframes, source: undoSnapshot.source };
    }));
    setUndoSnapshot(null);
    setTrackError(null);
  }, [undoSnapshot]);

  const handleInsertCurrentKeyframe = useCallback(() => {
    if (!selectedAnn || !selectedAnnInterpolated) return;
    const geometry = extractKeyframeGeometry(selectedAnnInterpolated);
    if (!geometry) return;
    upsertKeyframe(selectedAnn.id, currentTMsRef.current, geometry);
  }, [selectedAnn, selectedAnnInterpolated, extractKeyframeGeometry, upsertKeyframe]);

  const handleDeleteCurrentKeyframe = useCallback(() => {
    if (!selectedAnn || selectedKeyframeIndexAtCurrentFrame < 0) return;
    deleteKeyframe(selectedAnn.id, selectedKeyframeIndexAtCurrentFrame);
  }, [selectedAnn, selectedKeyframeIndexAtCurrentFrame, deleteKeyframe]);

  // --- Homography ---
  const hasHomographyCapability = sidecar.connected && sidecar.capabilities.includes('homography');
  const canComputeHomography = hasHomographyCapability && hasVideoSource;

  const handleComputeHomography = useCallback(async () => {
    if (!hasVideoSource) return;
    setIsComputingHomography(true);
    try {
      const result = await requestHomography({
        videoRef: videoLocator.videoRef,
        videoPath: videoLocator.videoPath,
        startMs: clip.startMs,
        endMs: clip.endMs,
        fps: 5,
      }, sidecar.baseUrl);

      const frames: HomographyFrame[] = result.frames.map(f => ({
        tMs: f.tMs,
        matrix: f.matrix,
        method: f.method,
      }));
      setHomographyFrames(frames);

      const usableCount = frames.filter(f => f.method !== 'failed').length;
      if (usableCount > 0) {
        setDrawCoordMode('pitch');
        setTrackError(null);
      } else {
        setDrawCoordMode('pitch');
        setTrackError('Homography finished but no usable frames were found');
      }

      // Write to cache
      if (projectDir) {
        writeHomographyCache(projectDir, clip.startMs, clip.endMs, frames).catch(() => {});
      }
    } catch (e: any) {
      setTrackError(e?.message || 'Homography computation failed');
    } finally {
      setIsComputingHomography(false);
    }
  }, [hasVideoSource, videoLocator, clip.startMs, clip.endMs, sidecar.baseUrl, projectDir]);

  // Look up the homography matrix for the current frame time
  const currentHomography = useMemo((): number[] | null => {
    return resolveUsableHomographyAtTime(homographyFrames, clip.startMs + currentTMs);
  }, [homographyFrames, clip.startMs, currentTMs]);

  const currentHomographyInv = useMemo(
    () => (currentHomography ? invert3(currentHomography) : null),
    [currentHomography],
  );

  useEffect(() => {
    currentHomographyInvRef.current = currentHomographyInv;
  }, [currentHomographyInv]);

  const activeToolSupportsPitchCoords = useMemo(() => (
    tool !== 'select' && annotationTypeSupportsPitchCoords(tool as ClipAnnotationType)
  ), [tool]);

  const effectiveDrawCoordMode = useMemo(() => (
    drawCoordMode === 'pitch' && activeToolSupportsPitchCoords && !!currentHomographyInv
      ? 'pitch'
      : 'image'
  ), [drawCoordMode, activeToolSupportsPitchCoords, currentHomographyInv]);

  const tempPitchPreview = useMemo((): { type: 'box' | 'circle'; points: number[] } | null => {
    if (!tempShape || !currentHomography || !currentHomographyInv || effectiveDrawCoordMode !== 'pitch') {
      return null;
    }

    if (tempShape.type === 'box') {
      const pitchGeometry = convertImageGeometryToPitchGeometry('box', {
        x: tempShape.x,
        y: tempShape.y,
        w: tempShape.w,
        h: tempShape.h,
      }, currentHomographyInv);
      const x = Number(pitchGeometry.x ?? 0);
      const y = Number(pitchGeometry.y ?? 0);
      const w = Number(pitchGeometry.w ?? 0);
      const h = Number(pitchGeometry.h ?? 0);
      return {
        type: 'box',
        points: rectPlaneToImagePoints(currentHomography, x + (w / 2), y + (h / 2), w, h),
      };
    }

    if (tempShape.type === 'circle') {
      const pitchGeometry = convertImageGeometryToPitchGeometry('circle', {
        cx: tempShape.cx,
        cy: tempShape.cy,
        rx: tempShape.rx,
        ry: tempShape.ry,
      }, currentHomographyInv);
      const cx = Number(pitchGeometry.cx ?? 0);
      const cy = Number(pitchGeometry.cy ?? 0);
      const rx = Number(pitchGeometry.rx ?? 0);
      const ry = Number(pitchGeometry.ry ?? 0);
      return {
        type: 'circle',
        points: ellipsePlaneToImagePoints(currentHomography, cx, cy, rx, ry),
      };
    }

    return null;
  }, [currentHomography, currentHomographyInv, effectiveDrawCoordMode, tempShape]);

  const drawCoordModeStatus = useMemo(() => {
    if (drawCoordMode !== 'pitch') return null;
    if (!activeToolSupportsPitchCoords) return 'Current tool uses image coordinates';
    if (!currentHomographyInv) return 'No usable H at this frame; new shapes will fall back to image';
    return 'New shapes will use pitch coordinates';
  }, [drawCoordMode, activeToolSupportsPitchCoords, currentHomographyInv]);

  const resolveHighlightReference = useCallback((
    refId: string | null | undefined,
    tMs: number,
    homographyOverride: number[] | null = currentHomography,
  ): { id: string; x: number; y: number; rx: number; ry: number } | null => {
    if (!refId) return null;
    const annotation = annotationsRef.current.find((candidate) => candidate.id === refId);
    if (!annotation || annotation.type !== 'highlight') return null;
    const interpolatedKeyframe = interpolateAnnotationAtTime(annotation, tMs, videoFps, clipDurationMs);
    if (!interpolatedKeyframe || interpolatedKeyframe.type !== 'highlight') return null;

    if (annotation.coordMode === 'pitch') {
      if (!homographyOverride) return null;
      const projected = projectPitchKeyframeToImageShape(interpolatedKeyframe, homographyOverride);
      if (!projected || projected.kind !== 'polygon') return null;
      const bounds = getProjectedPitchShapeBounds(projected, defaultFontSize);
      return {
        id: annotation.id,
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
        rx: bounds.w / 2,
        ry: bounds.h / 2,
      };
    }

    return {
      id: annotation.id,
      x: interpolatedKeyframe.cx,
      y: interpolatedKeyframe.cy,
      rx: interpolatedKeyframe.radius,
      ry: interpolatedKeyframe.radius * 0.35,
    };
  }, [clipDurationMs, currentHomography, defaultFontSize, videoFps]);

  const pushOutFromHighlightEdge = useCallback((
    highlight: { x: number; y: number; rx: number; ry: number },
    toward: { x: number; y: number },
  ) => {
    const vx = toward.x - highlight.x;
    const vy = toward.y - highlight.y;
    const denom = (vx * vx) / ((highlight.rx * highlight.rx) || 1e-6) + (vy * vy) / ((highlight.ry * highlight.ry) || 1e-6);
    if (denom <= 1e-8) return { x: highlight.x, y: highlight.y };
    const t = 1 / Math.sqrt(denom);
    const px = highlight.x + vx * t;
    const py = highlight.y + vy * t;
    const len = Math.hypot(vx, vy) || 1e-6;
    const ux = vx / len;
    const uy = vy / len;
    return { x: px + ux, y: py + uy };
  }, []);

  const resolveShadowDisplayProps = useCallback((
    ann: ClipAnnotation,
    props: InterpolatedShadow,
    tMs: number,
    homographyOverride: number[] | null = currentHomography,
  ) => {
    const ref = Array.isArray(ann.vertexRefs) ? resolveHighlightReference(ann.vertexRefs[0], tMs, homographyOverride) : null;
    return {
      x: ref?.x ?? props.x,
      y: ref?.y ?? props.y,
      r: props.r,
      rotation: props.rotation,
      spreadDeg: props.spreadDeg,
    };
  }, [currentHomography, resolveHighlightReference]);

  const resolveArrowDisplayProps = useCallback((
    ann: ClipAnnotation,
    props: InterpolatedArrow,
    tMs: number,
    homographyOverride: number[] | null = currentHomography,
  ) => {
    const refs = Array.isArray(ann.vertexRefs) ? ann.vertexRefs : [];
    const startRef = resolveHighlightReference(refs[0], tMs, homographyOverride);
    const endRef = resolveHighlightReference(refs[1], tMs, homographyOverride);
    let x1 = startRef?.x ?? props.x1;
    let y1 = startRef?.y ?? props.y1;
    let x2 = endRef?.x ?? props.x2;
    let y2 = endRef?.y ?? props.y2;

    if (startRef) {
      const pushed = pushOutFromHighlightEdge(startRef, endRef ? { x: endRef.x, y: endRef.y } : { x: x2, y: y2 });
      x1 = pushed.x;
      y1 = pushed.y;
    }
    if (endRef) {
      const pushed = pushOutFromHighlightEdge(endRef, startRef ? { x: startRef.x, y: startRef.y } : { x: x1, y: y1 });
      x2 = pushed.x;
      y2 = pushed.y;
    }

    return { x1, y1, x2, y2 };
  }, [currentHomography, pushOutFromHighlightEdge, resolveHighlightReference]);

  const resolveLobDisplayProps = useCallback((
    ann: ClipAnnotation,
    props: InterpolatedLob,
    tMs: number,
    homographyOverride: number[] | null = currentHomography,
  ) => {
    const refs = Array.isArray(ann.vertexRefs) ? ann.vertexRefs : [];
    const startRef = resolveHighlightReference(refs[0], tMs, homographyOverride);
    const endRef = resolveHighlightReference(refs[1], tMs, homographyOverride);
    return {
      start: { x: startRef?.x ?? props.x1, y: startRef?.y ?? props.y1 },
      control: { x: props.cx, y: props.cy },
      end: { x: endRef?.x ?? props.x2, y: endRef?.y ?? props.y2 },
    };
  }, [currentHomography, resolveHighlightReference]);

  const resolvePolyDisplayPoints = useCallback((
    ann: ClipAnnotation,
    props: InterpolatedPoly,
    tMs: number,
    homographyOverride: number[] | null = currentHomography,
  ): [number, number][] => {
    const refs = Array.isArray(ann.vertexRefs) ? ann.vertexRefs : [];
    if (refs.length !== props.points.length) return props.points;
    return props.points.map(([x, y], index) => {
      const ref = resolveHighlightReference(refs[index], tMs, homographyOverride);
      return ref ? [ref.x, ref.y] as [number, number] : [x, y] as [number, number];
    });
  }, [currentHomography, resolveHighlightReference]);

  const findHighlightHit = useCallback((point: { x: number; y: number }) => {
    for (let index = annotationsRef.current.length - 1; index >= 0; index -= 1) {
      const annotation = annotationsRef.current[index];
      if (!annotation || annotation.type !== 'highlight') continue;
      const highlight = resolveHighlightReference(annotation.id, currentTMsRef.current, currentHomography);
      if (!highlight) continue;
      const dx = point.x - highlight.x;
      const dy = point.y - highlight.y;
      const value = (dx * dx) / ((highlight.rx * highlight.rx) || 1e-6) + (dy * dy) / ((highlight.ry * highlight.ry) || 1e-6);
      if (value <= 1) return highlight;
    }
    return null;
  }, [currentHomography, resolveHighlightReference]);

  const updatePolyTempPreview = useCallback((cursorPoint?: { x: number; y: number } | null) => {
    const poly = polyTempRef.current;
    if (!poly || poly.points.length === 0) {
      setTempShape((current) => current?.type === 'poly' ? null : current);
      return;
    }

    let bestIdx = -1;
    let bestDistance = Infinity;
    if (cursorPoint) {
      for (let i = 0; i < poly.points.length; i += 1) {
        const point = poly.points[i]!;
        const distance = Math.hypot(cursorPoint.x - point.x, cursorPoint.y - point.y);
        if (distance <= 10 && distance < bestDistance) {
          bestDistance = distance;
          bestIdx = i;
        }
      }
    }
    polyNearIndexRef.current = bestIdx;
    const nearVertex = !!cursorPoint && bestIdx >= 0 && bestDistance <= 10;
    let previewPoints = poly.points.map((point) => [point.x, point.y] as [number, number]);
    let closed = false;
    if (cursorPoint) {
      if (nearVertex) {
        closed = bestIdx === 0 && poly.points.length >= 3;
      } else {
        previewPoints = previewPoints.concat([[cursorPoint.x, cursorPoint.y]]);
      }
    }
    setTempShape({ type: 'poly', points: previewPoints, closed });
  }, []);

  const finalizePolyPlacement = useCallback((closed: boolean) => {
    const poly = polyTempRef.current;
    if (!poly || poly.points.length < 2) return false;
    const refs = poly.points.map((point) => point.refId || null);
    const annotation: ClipAnnotation = {
      id: makeId(),
      type: 'poly',
      coordMode: 'image',
      source: 'manual',
      vertexRefs: refs.some(Boolean) ? refs : undefined,
      closed,
      style: {
        stroke: defaultColor,
        strokeWidth: defaultStrokeWidth,
        strokePattern: 'solid',
        ...(closed ? { fill: defaultFill, fillOpacity: defaultFillOpacity } : {}),
      },
      keyframes: [{
        tMs: currentTMsRef.current,
        provenance: 'manual',
        points: poly.points.map((point) => [point.x, point.y] as [number, number]),
      } as ClipKeyframe],
    };
    setAnnotations((prev) => [...prev, annotation]);
    setSelectedAnnotationIds([]);
    setSelectedAnnotationId(annotation.id);
    polyTempRef.current = null;
    polyNearIndexRef.current = -1;
    setTempShape(null);
    return true;
  }, [defaultColor, defaultFill, defaultFillOpacity, defaultStrokeWidth]);

  const moveLinkedHighlights = useCallback((refIds: string[], dx: number, dy: number) => {
    const uniqueRefIds = Array.from(new Set(refIds)).filter(Boolean);
    for (const refId of uniqueRefIds) {
      const annotation = annotationsRef.current.find((candidate) => candidate.id === refId);
      if (!annotation || annotation.type !== 'highlight' || annotation.coordMode !== 'image') continue;
      const highlight = resolveHighlightReference(refId, currentTMsRef.current, currentHomography);
      if (!highlight) continue;
      upsertKeyframe(refId, currentTMsRef.current, {
        cx: highlight.x + dx,
        cy: highlight.y + dy,
        radius: highlight.rx,
      });
    }
  }, [currentHomography, resolveHighlightReference, upsertKeyframe]);

  const getResolvedAnnotationBounds = useCallback((ann: ClipAnnotation, props: InterpolatedKeyframe, homography: number[] | null = currentHomography) => {
    if (ann.coordMode === 'pitch' && homography) {
      const projected = projectPitchKeyframeToImageShape(props, homography);
      if (projected) {
        return getProjectedPitchShapeBounds(projected, resolveAnnotationDisplayStyle(ann).fontSize);
      }
    }
    switch (props.type) {
      case 'box': {
        const b = props as InterpolatedBox;
        return { x: b.x, y: b.y, w: b.w, h: b.h };
      }
      case 'circle': {
        const c = props as InterpolatedCircle;
        return { x: c.cx - c.rx, y: c.cy - c.ry, w: c.rx * 2, h: c.ry * 2 };
      }
      case 'shadow': {
        const shadow = resolveShadowDisplayProps(ann, props as InterpolatedShadow, currentTMsRef.current, homography);
        return getBoundsForFlatPoints(buildShadowSectorPoints(shadow.x, shadow.y, shadow.r, shadow.rotation, shadow.spreadDeg));
      }
      case 'arrow': {
        const arrow = resolveArrowDisplayProps(ann, props as InterpolatedArrow, currentTMsRef.current, homography);
        return getBoundsForFlatPoints([arrow.x1, arrow.y1, arrow.x2, arrow.y2]);
      }
      case 'lob': {
        const lob = resolveLobDisplayProps(ann, props as InterpolatedLob, currentTMsRef.current, homography);
        return getBoundsForFlatPoints([lob.start.x, lob.start.y, lob.control.x, lob.control.y, lob.end.x, lob.end.y]);
      }
      case 'text': {
        const t = props as InterpolatedText;
        const fontSize = resolveAnnotationDisplayStyle(ann).fontSize;
        return { x: t.x, y: t.y, w: 100, h: fontSize };
      }
      case 'poly': {
        const points = resolvePolyDisplayPoints(ann, props as InterpolatedPoly, currentTMsRef.current, homography);
        return getBoundsForFlatPoints(points.flatMap(([x, y]) => [x, y]));
      }
      case 'highlight': {
        const h = props as InterpolatedHighlight;
        return { x: h.cx - h.radius, y: h.cy - (h.radius * 0.35), w: h.radius * 2, h: h.radius * 0.7 };
      }
      default:
        return { x: 0, y: 0, w: 0, h: 0 };
    }
  }, [currentHomography, resolveAnnotationDisplayStyle, resolveArrowDisplayProps, resolveLobDisplayProps, resolvePolyDisplayPoints, resolveShadowDisplayProps]);

  const selectedAnnBounds = useMemo(() => {
    if (!selectedAnn || !selectedAnnInterpolated) return null;
    return getResolvedAnnotationBounds(selectedAnn, selectedAnnInterpolated, currentHomography);
  }, [selectedAnn, selectedAnnInterpolated, currentHomography, getResolvedAnnotationBounds]);

  const multiSelectedAnnotationBounds = useMemo(() => {
    if (selectedAnnotationIds.length === 0) return [] as Array<{ id: string; bounds: { x: number; y: number; w: number; h: number } }>;
    const selectedSet = new Set(selectedAnnotationIds);
    return annotations.flatMap((annotation) => {
      if (!selectedSet.has(annotation.id)) return [];
      const interpolatedKeyframe = interpolateAnnotationAtTime(annotation, currentTMs, videoFps, clipDurationMs);
      if (!interpolatedKeyframe) return [];
      return [{
        id: annotation.id,
        bounds: getResolvedAnnotationBounds(annotation, interpolatedKeyframe, currentHomography),
      }];
    });
  }, [annotations, currentHomography, currentTMs, getResolvedAnnotationBounds, selectedAnnotationIds, videoFps]);

  const homographyOverlayLines = useMemo(() => {
    if (!showHomographyOverlay || !currentHomography) return [] as { points: number[]; dashed: boolean }[];

    const H = currentHomography;
    const lines: { points: number[]; dashed: boolean }[] = [];

    const addSegment = (
      u1: number,
      v1: number,
      u2: number,
      v2: number,
      dashed: boolean,
      steps: number = 32,
    ) => {
      const points: number[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const u = u1 + (u2 - u1) * t;
        const v = v1 + (v2 - v1) * t;
        const p = applyHomography(H, u, v);
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          points.push(p.x * scale, p.y * scale);
        }
      }
      if (points.length >= 4) lines.push({ points, dashed });
    };

    // Pitch border
    addSegment(0, 0, PITCH_LENGTH_M, 0, false);
    addSegment(PITCH_LENGTH_M, 0, PITCH_LENGTH_M, PITCH_WIDTH_M, false);
    addSegment(PITCH_LENGTH_M, PITCH_WIDTH_M, 0, PITCH_WIDTH_M, false);
    addSegment(0, PITCH_WIDTH_M, 0, 0, false);

    // Midline
    addSegment(PITCH_CENTER_X_M, 0, PITCH_CENTER_X_M, PITCH_WIDTH_M, false);

    // Light internal guide grid
    const splits = [0.25, 0.5, 0.75];
    for (const t of splits) {
      const x = PITCH_LENGTH_M * t;
      const y = PITCH_WIDTH_M * t;
      addSegment(x, 0, x, PITCH_WIDTH_M, true, 24);
      addSegment(0, y, PITCH_LENGTH_M, y, true, 24);
    }

    // Center circle (approx)
    const circlePts: number[] = [];
    const circleSteps = 64;
    for (let i = 0; i <= circleSteps; i++) {
      const a = (i / circleSteps) * Math.PI * 2;
      const u = PITCH_CENTER_X_M + CENTER_CIRCLE_RADIUS_M * Math.cos(a);
      const v = (PITCH_WIDTH_M / 2) + CENTER_CIRCLE_RADIUS_M * Math.sin(a);
      const p = applyHomography(H, u, v);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        circlePts.push(p.x * scale, p.y * scale);
      }
    }
    if (circlePts.length >= 4) lines.push({ points: circlePts, dashed: true });

    return lines;
  }, [showHomographyOverlay, currentHomography, scale]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setAnalysisLoopRange((previous) => (
          previous ? null : buildAnalysisLoopRange(currentTMsRef.current, analysisLoopDurationMs)
        ));
      }
      if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); shuttleByMs(LONG_SHUTTLE_MS); }
      if (e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); shuttleByMs(-LONG_SHUTTLE_MS); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); shuttleByMs(SHORT_SHUTTLE_MS); }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); shuttleByMs(-SHORT_SHUTTLE_MS); }
      if (!e.shiftKey && !e.altKey && e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
      if (!e.shiftKey && !e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedAnnotation();
      }
      if (e.key === 'Enter' && polyTempRef.current && polyTempRef.current.points.length >= 2) {
        e.preventDefault();
        const points = polyTempRef.current.points;
        const refs = points.map((point) => point.refId || null);
        const closed = !e.shiftKey && points.length >= 3;
        const annotation: ClipAnnotation = {
          id: makeId(),
          type: 'poly',
          coordMode: 'image',
          source: 'manual',
          vertexRefs: refs.some(Boolean) ? refs : undefined,
          closed,
          style: {
            stroke: defaultColor,
            strokeWidth: defaultStrokeWidth,
            strokePattern: 'solid',
            ...(closed ? { fill: defaultFill, fillOpacity: defaultFillOpacity } : {}),
          },
          keyframes: [{
            tMs: currentTMsRef.current,
            provenance: 'manual',
            points: points.map((point) => [point.x, point.y] as [number, number]),
          } as ClipKeyframe],
        };
        setAnnotations((prev) => [...prev, annotation]);
        setSelectedAnnotationIds([]);
        setSelectedAnnotationId(annotation.id);
        polyTempRef.current = null;
        polyNearIndexRef.current = -1;
        setTempShape(null);
      }
      if (
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey)
        || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        handleRedoAnnotations();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (!handleUndoAnnotations()) {
          handleUndoTracking();
        }
      }
      if (e.key === 'Escape') {
        setRetrackRangeEndMs(null);
        setSelectedAnnotationIds([]);
        setSelectedAnnotationId(null);
        setIsSelecting(false);
        selStartRef.current = null;
        selCandidateRef.current = null;
        setSelRect(null);
        setIsDrawing(false);
        drawStartRef.current = null;
        arrowStartRef.current = null;
        lobStartRef.current = null;
        shadowAnchorRef.current = null;
        polyTempRef.current = null;
        polyNearIndexRef.current = -1;
        setTempShape(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        // Force immediate save
        saveSchedulerRef.current?.cancel();
        if (projectDir) {
          const toSave: Clip = { ...clip, annotations: annotationsRef.current };
          setSaveStatus('saving');
          onSaveStatus?.('saving');
          writeClip(projectDir, toSave).then(() => {
            setSaveStatus('saved');
            onSaveStatus?.('saved');
            onClipUpdate?.(toSave);
          }).catch(() => {
            setSaveStatus('error');
            onSaveStatus?.('error');
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [analysisLoopDurationMs, buildAnalysisLoopRange, defaultColor, defaultFill, defaultFillOpacity, defaultStrokeWidth, deleteSelectedAnnotation, togglePlay, shuttleByMs, stepFrame, handleRedoAnnotations, handleUndoAnnotations, handleUndoTracking, projectDir, clip, onClipUpdate, onSaveStatus]);

  // --- Interpolate annotations ---
  const interpolated = useMemo(() => {
    const results: { ann: ClipAnnotation; props: InterpolatedKeyframe }[] = [];
    for (const ann of annotations) {
      const p = interpolateAnnotationAtTime(ann, currentTMs, videoFps, clipDurationMs);
      if (p) results.push({ ann, props: p });
    }
    return results;
  }, [annotations, currentTMs, videoFps]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    if (!selectedAnnCanUseTransformer) {
      selectedNodeRef.current = null;
    }
    if (selectedNodeRef.current) {
      transformer.nodes([selectedNodeRef.current]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedAnnotationId, selectedAnnCanUseTransformer, interpolated, scale]);

  const shadowInterpolated = useMemo(
    () => interpolated.filter(({ props }) => props.type === 'shadow'),
    [interpolated],
  );
  const otherInterpolated = useMemo(
    () => interpolated.filter(({ props }) => props.type === 'box' || props.type === 'circle'),
    [interpolated],
  );
  const lineInterpolated = useMemo(
    () => interpolated.filter(({ props }) => props.type === 'arrow' || props.type === 'lob' || props.type === 'poly'),
    [interpolated],
  );
  const highlightInterpolated = useMemo(
    () => interpolated.filter(({ props }) => props.type === 'highlight'),
    [interpolated],
  );
  const textInterpolated = useMemo(
    () => interpolated.filter(({ props }) => props.type === 'text'),
    [interpolated],
  );

  // --- Format time ---
  const formatTime = useCallback((ms: number) => {
    const total = Math.max(0, Math.floor(ms));
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const f = Math.floor(((total % 1000) / 1000) * videoFps);
    return `${m}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }, [videoFps]);

  const handleImportStill = useCallback(async (stillId: string) => {
    if (!projectDir || !manifest) {
      setStillImportMessage('Still import is unavailable without the project context');
      return;
    }

    const still = inBoundsStills.find((entry) => entry.id === stillId);
    if (!still) {
      setStillImportMessage('That still is no longer inside this clip range');
      return;
    }

    setIsImportingStillId(stillId);
    setStillImportMessage(null);
    try {
      const loaded = await readPrimaryAnnotationDocumentForStill(projectDir, manifest, still);
      const primary = loaded?.document ?? null;
      if (!primary || (primary.shapes?.length ?? 0) === 0) {
        setStillImportMessage('This still has no saved annotations to import');
        return;
      }

      const clipFrameMs = roundToFrame(getClipRelativeMsForStill(clip, still), videoFps);
      const result = importStillDocumentToClip(primary, clipFrameMs);
      if (result.annotations.length === 0) {
        setStillImportMessage('No supported annotation shapes were found to import');
        return;
      }

      const applyResult = applyStillImportToClip(annotations, result.annotations, clipFrameMs);
      setAnnotations(applyResult.annotations);
      setSelectedAnnotationIds([]);
      setSelectedAnnotationId(result.annotations[0]?.id ?? null);
      seekToMs(clipFrameMs);
      const annotationSetLabel = loaded?.entry.label || loaded?.entry.id || 'default';
      const annotationSetSuffix = annotationSetLabel ? ` from "${annotationSetLabel}"` : '';
      setStillImportMessage(
        `${applyResult.existingAtFrameCount > 0 ? `Appended ${applyResult.importedCount} annotations alongside ${applyResult.existingAtFrameCount} existing annotation${applyResult.existingAtFrameCount === 1 ? '' : 's'}` : `Imported ${applyResult.importedCount} annotations`} from ${still.id}${annotationSetSuffix}${result.skipped > 0 ? `; skipped ${result.skipped} unsupported shape${result.skipped === 1 ? '' : 's'}` : ''}`,
      );
    } catch (error: any) {
      setStillImportMessage(error?.message || 'Failed to import still annotations');
    } finally {
      setIsImportingStillId(null);
    }
  }, [projectDir, manifest, inBoundsStills, clip, videoFps, seekToMs, annotations]);

  // --- Pointer position in image coords ---
  const getPointerImagePos = useCallback((e: any): { x: number; y: number } | null => {
    const stage = e?.target?.getStage?.() || stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return { x: pos.x / scale, y: pos.y / scale };
  }, [scale]);

  // Cancel any in-progress drawing
  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    drawStartRef.current = null;
    arrowStartRef.current = null;
    lobStartRef.current = null;
    shadowAnchorRef.current = null;
    polyTempRef.current = null;
    polyNearIndexRef.current = -1;
    setTempShape(null);
  }, []);

  // Clear temp state when tool changes
  useEffect(() => {
    cancelDrawing();
    if (tool !== 'select') {
      setIsSelecting(false);
      selStartRef.current = null;
      selCandidateRef.current = null;
      setSelRect(null);
    }
  }, [tool, cancelDrawing]);

  // --- Shape mouse down → select ---
  const onShapeMouseDown = useCallback((annId: string, e: any) => {
    if (tool !== 'select') return;
    e.cancelBubble = true;
    const evt = e?.evt as MouseEvent | undefined;
    const addKey = !!evt?.shiftKey;
    const subKey = !!(evt?.metaKey || evt?.ctrlKey);
    const base = selectedAnnotationIds.length > 0
      ? selectedAnnotationIds
      : (selectedAnnotationId ? [selectedAnnotationId] : []);

    if (!addKey && !subKey) {
      if (selectedAnnotationId === annId && selectedAnnotationIds.length === 0) return;
      setSelectedAnnotationIds([]);
      setSelectedAnnotationId(annId);
      return;
    }

    const set = new Set(base);
    if (addKey) set.add(annId);
    if (subKey) set.delete(annId);

    const nextOrdered = base.filter((id) => set.has(id));
    if (addKey && !base.includes(annId) && set.has(annId)) nextOrdered.push(annId);

    if (nextOrdered.length === 0) {
      setSelectedAnnotationIds([]);
      setSelectedAnnotationId(null);
      return;
    }
    if (nextOrdered.length === 1) {
      setSelectedAnnotationIds([]);
      setSelectedAnnotationId(nextOrdered[0]);
      return;
    }
    setSelectedAnnotationIds(nextOrdered);
    if (!subKey && set.has(annId)) {
      setSelectedAnnotationId(annId);
    } else if (selectedAnnotationId && set.has(selectedAnnotationId)) {
      setSelectedAnnotationId(selectedAnnotationId);
    } else {
      setSelectedAnnotationId(nextOrdered[nextOrdered.length - 1]);
    }
  }, [tool, selectedAnnotationId, selectedAnnotationIds]);

  // --- Shape drag end → upsert keyframe ---
  const onShapeDragEnd = useCallback((ann: ClipAnnotation, props: InterpolatedKeyframe, e: any) => {
    if (tool !== 'select') return;
    const node = e.target;
    const pos = node.position();
    // Reset node position so React re-render takes over
    node.position({ x: 0, y: 0 });

    const tMs = currentTMsRef.current;
    // For shapes rendered at their own (x,y), pos already includes the
    // initial offset, so pos/scale IS the new coordinate.
    // For shapes rendered at origin (arrow, poly), pos is pure drag delta.
    switch (props.type) {
      case 'box': {
        const b = props as InterpolatedBox;
        const nx = pos.x / scale;
        const ny = pos.y / scale;
        if (Math.abs(nx - b.x) < 0.5 && Math.abs(ny - b.y) < 0.5) return;
        upsertKeyframe(ann.id, tMs, { x: nx, y: ny, w: b.w, h: b.h });
        break;
      }
      case 'circle': {
        const c = props as InterpolatedCircle;
        const nx = pos.x / scale;
        const ny = pos.y / scale;
        if (Math.abs(nx - c.cx) < 0.5 && Math.abs(ny - c.cy) < 0.5) return;
        upsertKeyframe(ann.id, tMs, { cx: nx, cy: ny, rx: c.rx, ry: c.ry });
        break;
      }
      case 'shadow': {
        const s = props as InterpolatedShadow;
        const shadow = resolveShadowDisplayProps(ann, s, tMs);
        const nx = pos.x / scale;
        const ny = pos.y / scale;
        const dx = nx - shadow.x;
        const dy = ny - shadow.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        const refs = (ann.vertexRefs || []).filter(Boolean) as string[];
        if (refs.length > 0) {
          moveLinkedHighlights(refs, dx, dy);
          return;
        }
        upsertKeyframe(ann.id, tMs, { x: nx, y: ny, r: shadow.r, rotation: shadow.rotation, spreadDeg: shadow.spreadDeg });
        break;
      }
      case 'arrow': {
        const a = resolveArrowDisplayProps(ann, props as InterpolatedArrow, tMs);
        const dx = pos.x / scale;
        const dy = pos.y / scale;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        upsertKeyframe(ann.id, tMs, { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy });
        moveLinkedHighlights((ann.vertexRefs || []).filter(Boolean) as string[], dx, dy);
        break;
      }
      case 'lob': {
        const l = resolveLobDisplayProps(ann, props as InterpolatedLob, tMs);
        const dx = pos.x / scale;
        const dy = pos.y / scale;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        upsertKeyframe(ann.id, tMs, {
          x1: l.start.x + dx,
          y1: l.start.y + dy,
          cx: l.control.x + dx,
          cy: l.control.y + dy,
          x2: l.end.x + dx,
          y2: l.end.y + dy,
        });
        moveLinkedHighlights((ann.vertexRefs || []).filter(Boolean) as string[], dx, dy);
        break;
      }
      case 'text': {
        const t = props as InterpolatedText;
        const nx = pos.x / scale;
        const ny = pos.y / scale;
        if (Math.abs(nx - t.x) < 0.5 && Math.abs(ny - t.y) < 0.5) return;
        upsertKeyframe(ann.id, tMs, { x: nx, y: ny });
        break;
      }
      case 'highlight': {
        const h = props as InterpolatedHighlight;
        const nx = pos.x / scale;
        const ny = pos.y / scale;
        if (Math.abs(nx - h.cx) < 0.5 && Math.abs(ny - h.cy) < 0.5) return;
        upsertKeyframe(ann.id, tMs, { cx: nx, cy: ny, radius: h.radius });
        break;
      }
      case 'poly': {
        const p = resolvePolyDisplayPoints(ann, props as InterpolatedPoly, tMs);
        const dx = pos.x / scale;
        const dy = pos.y / scale;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        const moved = p.map(([px, py]) => [px + dx, py + dy] as [number, number]);
        upsertKeyframe(ann.id, tMs, { points: moved });
        moveLinkedHighlights((ann.vertexRefs || []).filter(Boolean) as string[], dx, dy);
        break;
      }
    }
  }, [moveLinkedHighlights, resolveArrowDisplayProps, resolveLobDisplayProps, resolvePolyDisplayPoints, resolveShadowDisplayProps, scale, tool, upsertKeyframe]);

  const onShapeTransformEnd = useCallback((ann: ClipAnnotation, props: InterpolatedKeyframe, e: any) => {
    if (tool !== 'select' || ann.coordMode === 'pitch') return;
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const pos = node.position();

    switch (props.type) {
      case 'box': {
        const box = props as InterpolatedBox;
        const nextW = Math.max(0.5, (box.w * scaleX));
        const nextH = Math.max(0.5, (box.h * scaleY));
        node.scaleX(1);
        node.scaleY(1);
        upsertKeyframe(ann.id, currentTMsRef.current, {
          x: pos.x / scale,
          y: pos.y / scale,
          w: nextW,
          h: nextH,
        });
        break;
      }
      case 'circle': {
        const circle = props as InterpolatedCircle;
        node.scaleX(1);
        node.scaleY(1);
        upsertKeyframe(ann.id, currentTMsRef.current, {
          cx: pos.x / scale,
          cy: pos.y / scale,
          rx: Math.max(0.5, circle.rx * scaleX),
          ry: Math.max(0.5, circle.ry * scaleY),
        });
        break;
      }
      case 'highlight': {
        const highlight = props as InterpolatedHighlight;
        node.scaleX(1);
        node.scaleY(1);
        upsertKeyframe(ann.id, currentTMsRef.current, {
          cx: pos.x / scale,
          cy: pos.y / scale,
          radius: Math.max(0.5, highlight.radius * Math.max(scaleX, scaleY)),
        });
        break;
      }
      case 'text': {
        node.scaleX(1);
        node.scaleY(1);
        upsertKeyframe(ann.id, currentTMsRef.current, {
          x: pos.x / scale,
          y: pos.y / scale,
        });
        break;
      }
      default:
        node.scaleX(1);
        node.scaleY(1);
        break;
    }
  }, [tool, scale, upsertKeyframe]);

  const handleSelectedLobControlDrag = useCallback((pos: { x: number; y: number }) => {
    if (!selectedAnn || !selectedAnnInterpolated || selectedAnnInterpolated.type !== 'lob') return;
    const lob = selectedAnnInterpolated as InterpolatedLob;
    upsertKeyframe(selectedAnn.id, currentTMsRef.current, {
      x1: lob.x1,
      y1: lob.y1,
      cx: pos.x / scale,
      cy: pos.y / scale,
      x2: lob.x2,
      y2: lob.y2,
    });
  }, [selectedAnn, selectedAnnInterpolated, scale, upsertKeyframe]);

  // --- Stage mouse handlers (matching stills Editor behavior) ---

  const onStageMouseDown = useCallback((e: any) => {
    const evt = e?.evt as MouseEvent | undefined;
    // Right-click cancels drawing
    if (evt?.button === 2) {
      evt.preventDefault();
      if (isDrawing || arrowStartRef.current || lobStartRef.current || polyTempRef.current) {
        cancelDrawing();
      } else {
        setSelectedAnnotationIds([]);
        setSelectedAnnotationId(null);
      }
      return;
    }

    const p = getPointerImagePos(e);
    if (!p) return;
    const isStage = e.target === e.target.getStage();

    if (tool === 'select') {
      if (isStage) {
        selCandidateRef.current = p;
      }
      return;
    }
    // Box/Circle/Shadow: start drag-draw
    if (tool === 'box' || tool === 'circle') {
      if (!isStage) return;
      setIsDrawing(true);
      drawStartRef.current = p;
      shadowAnchorRef.current = null;
      return;
    }
    if (tool === 'shadow') {
      const hit = findHighlightHit(p);
      if (!isStage && !hit) return;
      setIsDrawing(true);
      drawStartRef.current = hit ? { x: hit.x, y: hit.y } : p;
      shadowAnchorRef.current = hit?.id || null;
    }
  }, [tool, getPointerImagePos, isDrawing, cancelDrawing, findHighlightHit]);

  const onStageMouseMove = useCallback((e: any) => {
    if (tool === 'select' && (selStartRef.current || selCandidateRef.current)) {
      const p = getPointerImagePos(e);
      if (!p) return;
      const candidate = selStartRef.current || selCandidateRef.current;
      if (!candidate) return;
      const x = Math.min(candidate.x, p.x);
      const y = Math.min(candidate.y, p.y);
      const w = Math.abs(p.x - candidate.x);
      const h = Math.abs(p.y - candidate.y);
      if (Math.max(w, h) > 3) {
        if (!selStartRef.current) {
          selStartRef.current = candidate;
          selCandidateRef.current = null;
        }
        setIsSelecting(true);
        setSelRect({ x, y, w, h });
      }
      return;
    }
    if (!isDrawing || !drawStartRef.current) {
      // Arrow/lob temp preview: if the first point is set, show temp line/curve to cursor
      if (tool === 'arrow' && arrowStartRef.current) {
        const p = getPointerImagePos(e);
        if (p) {
          const s = arrowStartRef.current;
          const hit = findHighlightHit(p);
          const end = hit ? { x: hit.x, y: hit.y } : p;
          setTempShape({ type: 'arrow', x1: s.x, y1: s.y, x2: end.x, y2: end.y });
        }
      } else if (tool === 'lob' && lobStartRef.current) {
        const p = getPointerImagePos(e);
        if (p) {
          const s = lobStartRef.current;
          const hit = findHighlightHit(p);
          const end = hit ? { x: hit.x, y: hit.y } : p;
          const control = buildDefaultLobControlPoint({ x: s.x, y: s.y }, { x: end.x, y: end.y });
          setTempShape({ type: 'lob', x1: s.x, y1: s.y, cx: control.x, cy: control.y, x2: end.x, y2: end.y });
        }
      } else if (tool === 'poly' && polyTempRef.current?.points.length) {
        const p = getPointerImagePos(e);
        if (p) {
          const hit = findHighlightHit(p);
          const cursor = hit ? { x: hit.x, y: hit.y } : p;
          updatePolyTempPreview(cursor);
        }
      }
      return;
    }
    const p = getPointerImagePos(e);
    if (!p) return;
    const s = drawStartRef.current;

    if (tool === 'box') {
      const x = Math.min(s.x, p.x);
      const y = Math.min(s.y, p.y);
      const w = Math.abs(p.x - s.x);
      const h = Math.abs(p.y - s.y);
      setTempShape({ type: 'box', x, y, w, h });
    } else if (tool === 'circle') {
      const rx = Math.abs(p.x - s.x);
      const ry = Math.abs(p.y - s.y);
      setTempShape({ type: 'circle', cx: s.x, cy: s.y, rx, ry });
    } else if (tool === 'shadow') {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dist = Math.hypot(dx, dy);
      const rotation = dist <= 3 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
      setTempShape({
        type: 'shadow',
        x: s.x,
        y: s.y,
        r: dist <= 3 ? DEFAULT_SHADOW_RADIUS : dist,
        rotation,
        spreadDeg: DEFAULT_SHADOW_SPREAD_DEG,
      });
    }
  }, [findHighlightHit, getPointerImagePos, isDrawing, tool, updatePolyTempPreview]);

  const onStageMouseUp = useCallback((e: any) => {
    if (tool === 'select' && (selStartRef.current || selCandidateRef.current)) {
      const p = getPointerImagePos(e);
      const evt = e?.evt as MouseEvent | undefined;
      const start = selStartRef.current || selCandidateRef.current;
      if (!start) return;
      const end = p || start;
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      const dragged = Math.max(w, h) > 3;

      if (dragged) {
        const rect = { x, y, w, h };
        const intersects = (
          left: { x: number; y: number; w: number; h: number },
          right: { x: number; y: number; w: number; h: number },
        ) => (
          left.x < right.x + right.w
          && left.x + left.w > right.x
          && left.y < right.y + right.h
          && left.y + left.h > right.y
        );
        const hits = annotations.filter((annotation) => {
          const interpolatedKeyframe = interpolateAnnotationAtTime(annotation, currentTMsRef.current, videoFps, clipDurationMs);
          if (!interpolatedKeyframe) return false;
          return intersects(getResolvedAnnotationBounds(annotation, interpolatedKeyframe, currentHomography), rect);
        }).map((annotation) => annotation.id);
        const addKey = !!evt?.shiftKey;
        const subKey = !!(evt?.metaKey || evt?.ctrlKey);
        const base = selectedAnnotationIds.length > 0
          ? selectedAnnotationIds
          : (selectedAnnotationId ? [selectedAnnotationId] : []);
        let nextIds: string[];
        if (!addKey && !subKey) {
          nextIds = hits;
        } else if (addKey) {
          const set = new Set(base);
          nextIds = [...base];
          for (const id of hits) {
            if (!set.has(id)) {
              set.add(id);
              nextIds.push(id);
            }
          }
        } else {
          const subtract = new Set(hits);
          nextIds = base.filter((id) => !subtract.has(id));
        }

        if (nextIds.length === 0) {
          setSelectedAnnotationIds([]);
          setSelectedAnnotationId(null);
        } else if (nextIds.length === 1) {
          setSelectedAnnotationIds([]);
          setSelectedAnnotationId(nextIds[0]);
        } else {
          setSelectedAnnotationIds(nextIds);
          setSelectedAnnotationId(nextIds[nextIds.length - 1]);
        }
      } else if (!evt?.shiftKey && !(evt?.metaKey || evt?.ctrlKey)) {
        setSelectedAnnotationIds([]);
        setSelectedAnnotationId(null);
      }

      setIsSelecting(false);
      selStartRef.current = null;
      selCandidateRef.current = null;
      setSelRect(null);
      return;
    }
    const p = getPointerImagePos(e);
    // Box/Circle: finalize
    if (isDrawing && drawStartRef.current && p) {
      const s = drawStartRef.current;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const clicked = Math.max(Math.abs(dx), Math.abs(dy)) <= 3;

      if (tool === 'box') {
        if (clicked) {
          // Click = create default-sized box
          createAnnotation('box', { x: s.x - 40, y: s.y - 24, w: 80, h: 48 });
        } else {
          const x = Math.min(s.x, p.x);
          const y = Math.min(s.y, p.y);
          createAnnotation('box', { x, y, w: Math.abs(dx), h: Math.abs(dy) });
        }
      } else if (tool === 'circle') {
        if (clicked) {
          createAnnotation('circle', { cx: s.x, cy: s.y, rx: 24, ry: 16 });
        } else {
          createAnnotation('circle', { cx: s.x, cy: s.y, rx: Math.abs(dx), ry: Math.abs(dy) });
        }
      } else if (tool === 'shadow') {
        const dist = Math.hypot(dx, dy);
        const annId = createAnnotation('shadow', {
          x: s.x,
          y: s.y,
          r: dist <= 3 ? DEFAULT_SHADOW_RADIUS : dist,
          rotation: dist <= 3 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI,
          spreadDeg: DEFAULT_SHADOW_SPREAD_DEG,
        });
        if (shadowAnchorRef.current) {
          setAnnotations((prev) => prev.map((annotation) => (
            annotation.id === annId
              ? { ...annotation, vertexRefs: [shadowAnchorRef.current] }
              : annotation
          )));
        }
      }
    }
    setIsDrawing(false);
    drawStartRef.current = null;
    shadowAnchorRef.current = null;
    setTempShape(null);
  }, [annotations, currentHomography, createAnnotation, getPointerImagePos, getResolvedAnnotationBounds, isDrawing, selectedAnnotationIds, tool, videoFps]);

  const onStageClick = useCallback((e: any) => {
    const p = getPointerImagePos(e);
    if (!p) return;
    const isStage = e.target === e.target.getStage();

    // Arrow: click-click pattern
    if (tool === 'arrow') {
      const hit = findHighlightHit(p);
      if (!isStage && !hit) return;
      if (!arrowStartRef.current) {
        // First click: set start
        arrowStartRef.current = hit ? { x: hit.x, y: hit.y, refId: hit.id } : p;
      } else {
        // Second click: finalize
        const s = arrowStartRef.current;
        const endHit = findHighlightHit(p);
        const end: { x: number; y: number; refId?: string | null } = endHit
          ? { x: endHit.x, y: endHit.y, refId: endHit.id }
          : { x: p.x, y: p.y };
        if (Math.hypot(end.x - s.x, end.y - s.y) >= 3) {
          const annId = createAnnotation('arrow', { x1: s.x, y1: s.y, x2: end.x, y2: end.y });
          setAnnotations((prev) => prev.map((annotation) => (
            annotation.id === annId
              ? {
                  ...annotation,
                  vertexRefs: [s.refId || null, end.refId || null].some(Boolean)
                    ? [s.refId || null, end.refId || null]
                    : undefined,
                }
              : annotation
          )));
        }
        arrowStartRef.current = null;
        setTempShape(null);
      }
      return;
    }

    if (tool === 'lob') {
      const hit = findHighlightHit(p);
      if (!isStage && !hit) return;
      if (!lobStartRef.current) {
        lobStartRef.current = hit ? { x: hit.x, y: hit.y, refId: hit.id } : p;
      } else {
        const s = lobStartRef.current;
        const endHit = findHighlightHit(p);
        const end: { x: number; y: number; refId?: string | null } = endHit
          ? { x: endHit.x, y: endHit.y, refId: endHit.id }
          : { x: p.x, y: p.y };
        if (Math.hypot(end.x - s.x, end.y - s.y) >= 3) {
          const control = buildDefaultLobControlPoint({ x: s.x, y: s.y }, { x: end.x, y: end.y });
          const annId = createAnnotation('lob', { x1: s.x, y1: s.y, cx: control.x, cy: control.y, x2: end.x, y2: end.y });
          setAnnotations((prev) => prev.map((annotation) => (
            annotation.id === annId
              ? {
                  ...annotation,
                  vertexRefs: [s.refId || null, end.refId || null].some(Boolean)
                    ? [s.refId || null, end.refId || null]
                    : undefined,
                }
              : annotation
          )));
        }
        lobStartRef.current = null;
        setTempShape(null);
      }
      return;
    }

    if (tool === 'poly') {
      const hit = findHighlightHit(p);
      if (!isStage && !hit) return;
      if (!polyTempRef.current) polyTempRef.current = { points: [] };
      const poly = polyTempRef.current;
      let bestIdx = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < poly.points.length; i += 1) {
        const point = poly.points[i]!;
        const distance = Math.hypot(p.x - point.x, p.y - point.y);
        if (distance <= 10 && distance < bestDistance) {
          bestDistance = distance;
          bestIdx = i;
        }
      }
      polyNearIndexRef.current = bestIdx;
      const nearVertex = bestIdx >= 0 && bestDistance <= 10;
      if (nearVertex && poly.points.length >= 2) {
        finalizePolyPlacement(bestIdx === 0 && poly.points.length >= 3);
        return;
      }

      const nextPoint = hit ? { x: hit.x, y: hit.y, refId: hit.id } : { x: p.x, y: p.y };
      const last = poly.points.length > 0 ? poly.points[poly.points.length - 1] : null;
      const sameRef = (last?.refId || null) === (nextPoint.refId || null);
      if (!last || !sameRef || Math.hypot(last.x - nextPoint.x, last.y - nextPoint.y) > 1) {
        poly.points.push(nextPoint);
      }
      updatePolyTempPreview();
      return;
    }

    // Highlight: single click creates default-sized ellipse
    if (tool === 'highlight') {
      if (!isStage) return;
      createAnnotation('highlight', { cx: p.x, cy: p.y, radius: 40 });
      return;
    }

    // Text: single click creates text annotation
    if (tool === 'text') {
      if (!isStage) return;
      const usePitchCoords = drawCoordMode === 'pitch' && !!currentHomographyInvRef.current;
      const geometry = usePitchCoords
        ? convertImageGeometryToPitchGeometry('text', { x: p.x, y: p.y }, currentHomographyInvRef.current)
        : { x: p.x, y: p.y };
      const ann: ClipAnnotation = {
        id: makeId(),
        type: 'text',
        coordMode: usePitchCoords ? 'pitch' : 'image',
        source: 'manual',
        text: 'Text',
        style: {
          stroke: defaultColor,
          strokeWidth: 1,
          strokePattern: 'solid',
          fontSize: defaultFontSize,
          fontFamily: 'Inter, system-ui, sans-serif',
          textHighlight: defaultTextHighlight,
        },
        keyframes: [{ tMs: currentTMsRef.current, x: geometry.x, y: geometry.y, provenance: 'manual' } as ClipKeyframe],
      };
      setAnnotations(prev => [...prev, ann]);
      setSelectedAnnotationIds([]);
      setSelectedAnnotationId(ann.id);
      return;
    }
  }, [tool, getPointerImagePos, createAnnotation, drawCoordMode, defaultColor, defaultFontSize, defaultTextHighlight, findHighlightHit, finalizePolyPlacement, updatePolyTempPreview]);

  const onStageDblClick = useCallback(() => {
    if (tool !== 'poly' || !polyTempRef.current || polyTempRef.current.points.length < 2) return;
    const points = [...polyTempRef.current.points];
    if (points.length >= 2) {
      const last = points[points.length - 1]!;
      const prev = points[points.length - 2]!;
      const sameRef = (last.refId || null) === (prev.refId || null);
      if (sameRef && Math.hypot(last.x - prev.x, last.y - prev.y) <= 1) {
        points.pop();
      }
    }
    if (points.length < 2) return;
    polyTempRef.current = { points };
    finalizePolyPlacement(false);
  }, [finalizePolyPlacement, tool]);

  // --- Render annotations as Konva shapes ---
  const isSelectMode = tool === 'select';
  const isPaused = !isPlaying;
  const canInteract = isSelectMode && isPaused;

  const renderAnnotation = useCallback((ann: ClipAnnotation, props: InterpolatedKeyframe) => {
    const {
      stroke,
      strokeWidth,
      dash,
      fillColor,
      fontSize,
      fontFamily,
      textHighlight,
      fillOpacity,
    } = resolveAnnotationDisplayStyle(ann);
    const scaledStrokeWidth = strokeWidth * scale;
    const scaledDash = dash?.map((segment) => segment * scale);
    const scaledPointerLength = 10 * scale;
    const scaledPointerWidth = 10 * scale;
    const selectedRef = ann.id === selectedAnnotationId && selectedAnnCanUseTransformer
      ? (node: any) => { selectedNodeRef.current = node; }
      : undefined;

    // --- Pitch-space rendering: transform through homography ---
    if (ann.coordMode === 'pitch' && currentHomography) {
      const projected = projectPitchKeyframeToImageShape(props, currentHomography);
      if (!projected) return null;

      if (projected.kind === 'arrow') {
        return (
          <KArrow
            key={ann.id}
            x={0} y={0}
            points={projected.points.map((value) => value * scale)}
            stroke={stroke} strokeWidth={scaledStrokeWidth} fill={stroke}
            pointerLength={scaledPointerLength} pointerWidth={scaledPointerWidth} dash={scaledDash}
            lineCap="round" lineJoin="round"
            listening={false} draggable={false}
            hitStrokeWidth={16}
          />
        );
      }

      if (projected.kind === 'lob') {
        return (
          <KShape
            key={ann.id}
            sceneFunc={(ctx, shape) => {
              const [x1, y1, cx, cy, x2, y2] = projected.points.map((value) => value * scale);
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.quadraticCurveTo(cx, cy, x2, y2);
              ctx.strokeShape(shape);
            }}
            stroke={stroke}
            strokeWidth={scaledStrokeWidth}
            dash={scaledDash}
            lineCap="round"
            lineJoin="round"
            listening={false}
            draggable={false}
            hitStrokeWidth={16}
          />
        );
      }

      if (projected.kind === 'text') {
        return (
          <KText
            key={ann.id}
            x={projected.x * scale} y={projected.y * scale}
            text={ann.text || ''} fontSize={fontSize * scale}
            fontFamily={fontFamily}
            fill={stroke} listening={false} draggable={false}
          />
        );
      }

      if (projected.points.length >= 4) {
        const scaled = projected.points.map((value) => value * scale);
        return (
          <KLine
            key={ann.id}
            x={0} y={0}
            points={scaled}
            stroke={stroke} strokeWidth={scaledStrokeWidth} fill={fillColor}
            closed={ann.closed !== false} dash={scaledDash} lineCap="round" lineJoin="round"
            listening={canInteract} draggable={false}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            hitStrokeWidth={16}
          />
        );
      }
      return null;
    }

    // --- Image-space rendering (default) ---
    switch (props.type) {
      case 'box': {
        const b = props as InterpolatedBox;
        return (
          <KRect
            key={ann.id}
            x={b.x * scale}
            y={b.y * scale}
            width={b.w * scale}
            height={b.h * scale}
            stroke={stroke}
            strokeWidth={scaledStrokeWidth}
            fill={fillColor}
            dash={scaledDash}
            listening={canInteract}
            draggable={canInteract}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            onTransformEnd={(e: any) => onShapeTransformEnd(ann, props, e)}
            hitStrokeWidth={12}
            ref={selectedRef}
          />
        );
      }
      case 'circle': {
        const c = props as InterpolatedCircle;
        return (
          <KEllipse
            key={ann.id}
            x={c.cx * scale}
            y={c.cy * scale}
            radiusX={c.rx * scale}
            radiusY={c.ry * scale}
            stroke={stroke}
            strokeWidth={scaledStrokeWidth}
            fill={fillColor}
            dash={scaledDash}
            listening={canInteract}
            draggable={canInteract}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            onTransformEnd={(e: any) => onShapeTransformEnd(ann, props, e)}
            hitStrokeWidth={12}
            ref={selectedRef}
          />
        );
      }
      case 'shadow': {
        const s = resolveShadowDisplayProps(ann, props as InterpolatedShadow, currentTMsRef.current);
        const localPoints = buildShadowSectorPoints(0, 0, s.r, s.rotation, s.spreadDeg).map((value) => value * scale);
        return (
          <KLine
            key={ann.id}
            x={s.x * scale}
            y={s.y * scale}
            points={localPoints}
            stroke={stroke}
            strokeWidth={scaledStrokeWidth}
            fill={fillColor === 'transparent' ? hexToRgba(stroke, fillOpacity) : fillColor}
            closed
            dash={scaledDash}
            lineCap="round"
            lineJoin="round"
            listening={canInteract}
            draggable={canInteract}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            hitStrokeWidth={16}
          />
        );
      }
      case 'arrow': {
        const a = resolveArrowDisplayProps(ann, props as InterpolatedArrow, currentTMsRef.current);
        return (
          <KArrow
            key={ann.id}
            x={0}
            y={0}
            points={[a.x1 * scale, a.y1 * scale, a.x2 * scale, a.y2 * scale]}
            stroke={stroke}
            strokeWidth={scaledStrokeWidth}
            fill={stroke}
            pointerLength={scaledPointerLength}
            pointerWidth={scaledPointerWidth}
            dash={scaledDash}
            lineCap="round"
            lineJoin="round"
            listening={canInteract}
            draggable={canInteract}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            hitStrokeWidth={16}
          />
        );
      }
      case 'lob': {
        const l = resolveLobDisplayProps(ann, props as InterpolatedLob, currentTMsRef.current);
        return (
          <KShape
            key={ann.id}
            x={0}
            y={0}
            stroke={stroke}
            strokeWidth={scaledStrokeWidth}
            dash={scaledDash}
            fill={stroke}
            lineCap="round"
            lineJoin="round"
            listening={canInteract}
            draggable={canInteract}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            hitStrokeWidth={16}
            sceneFunc={(ctx, shape) => {
              drawLobPathWithArrowhead(
                  ctx,
                  shape,
                  { x: l.start.x * scale, y: l.start.y * scale },
                  { x: l.control.x * scale, y: l.control.y * scale },
                  { x: l.end.x * scale, y: l.end.y * scale },
                  scaledStrokeWidth,
                );
              }}
          />
        );
      }
      case 'text': {
        const t = props as InterpolatedText;
        const scaledFontSize = fontSize * scale;
        const highlight = textHighlight;
        const textColor = stroke;
        const outlineColor = contrastStrokeForHex(stroke);
        const outlineWidth = Math.max(2, Math.round(fontSize * 0.18)) * scale;
        return (
          <KText
            key={ann.id}
            x={t.x * scale}
            y={t.y * scale}
            text={ann.text || ''}
            fontSize={scaledFontSize}
            fontFamily={fontFamily}
            fill={textColor}
            strokeEnabled={highlight}
            stroke={highlight ? outlineColor : undefined}
            strokeWidth={highlight ? outlineWidth : 0}
            listening={canInteract}
            draggable={canInteract}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            shadowEnabled={highlight}
            shadowColor={highlight ? outlineColor : undefined}
            shadowBlur={highlight ? 2 * scale : 0}
            shadowOpacity={highlight ? 1 : 0}
            shadowOffsetX={0}
            shadowOffsetY={0}
            hitStrokeWidth={12}
            onTransformEnd={(e: any) => onShapeTransformEnd(ann, props, e)}
            padding={6 * scale}
            ref={selectedRef}
          />
        );
      }
      case 'poly': {
        const points = resolvePolyDisplayPoints(ann, props as InterpolatedPoly, currentTMsRef.current);
        const flatPoints = points.flatMap(([x, y]) => [x * scale, y * scale]);
        return (
          <KLine
            key={ann.id}
            x={0}
            y={0}
            points={flatPoints}
            stroke={stroke}
            strokeWidth={scaledStrokeWidth}
            fill={fillColor}
            closed={ann.closed !== false}
            dash={scaledDash}
            lineCap="round"
            lineJoin="round"
            listening={canInteract}
            draggable={canInteract}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            hitStrokeWidth={16}
          />
        );
      }
      case 'highlight': {
        const h = props as InterpolatedHighlight;
        return (
          <KEllipse
            key={ann.id}
            x={h.cx * scale}
            y={h.cy * scale}
            radiusX={h.radius * scale}
            radiusY={(h.radius * 0.35) * scale}
            stroke={stroke}
            strokeWidth={scaledStrokeWidth}
            fill={fillColor}
            dash={scaledDash}
            listening={canInteract}
            draggable={canInteract}
            onMouseDown={(e: any) => onShapeMouseDown(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            onTransformEnd={(e: any) => onShapeTransformEnd(ann, props, e)}
            hitStrokeWidth={12}
            ref={selectedRef}
          />
        );
      }
      default:
        return null;
    }
  }, [canInteract, currentHomography, onShapeDragEnd, onShapeMouseDown, onShapeTransformEnd, resolveAnnotationDisplayStyle, resolveArrowDisplayProps, resolveLobDisplayProps, resolvePolyDisplayPoints, resolveShadowDisplayProps, scale, selectedAnnotationId, selectedAnnCanUseTransformer]);

  // --- Export: Canvas 2D annotation renderer ---
  const canExport = sidecar.connected && sidecar.capabilities.includes('export');

  const renderAnnotationsToCanvas = useCallback((
    canvas: HTMLCanvasElement,
    w: number,
    h: number,
    tMs: number,
  ) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const interps = annotations
      .map(ann => ({ ann, props: interpolateAnnotationAtTime(ann, tMs, videoFps, clipDurationMs) }))
      .filter(({ props }) => props !== null) as { ann: ClipAnnotation; props: InterpolatedKeyframe }[];

    for (const { ann, props } of interps) {
      const style = ann.style || {};
      const {
        stroke,
        strokeWidth,
        fillColor,
        fontSize,
        fontFamily,
        textHighlight,
      } = resolveAnnotationDisplayStyle(ann);

      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.fillStyle = fillColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      switch (props.type) {
        case 'box': {
          const b = props as InterpolatedBox;
          if (fillColor !== 'transparent') ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          break;
        }
        case 'circle': {
          const c = props as InterpolatedCircle;
          ctx.beginPath();
          ctx.ellipse(c.cx, c.cy, c.rx, c.ry, 0, 0, Math.PI * 2);
          if (fillColor !== 'transparent') ctx.fill();
          ctx.stroke();
          break;
        }
        case 'shadow': {
          const s = resolveShadowDisplayProps(ann, props as InterpolatedShadow, tMs, currentHomography);
          const points = buildShadowSectorPoints(s.x, s.y, s.r, s.rotation, s.spreadDeg);
          if (points.length < 4) break;
          ctx.beginPath();
          ctx.moveTo(points[0], points[1]);
          for (let i = 2; i < points.length; i += 2) {
            ctx.lineTo(points[i], points[i + 1]);
          }
          ctx.closePath();
          ctx.fillStyle = fillColor === 'transparent' ? hexToRgba(stroke, style.fillOpacity ?? 0.22) : fillColor;
          ctx.fill();
          ctx.stroke();
          break;
        }
        case 'arrow': {
          const a = resolveArrowDisplayProps(ann, props as InterpolatedArrow, tMs, currentHomography);
          ctx.beginPath();
          ctx.moveTo(a.x1, a.y1);
          ctx.lineTo(a.x2, a.y2);
          ctx.stroke();
          // Arrowhead
          const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
          const headLen = 10;
          ctx.beginPath();
          ctx.moveTo(a.x2, a.y2);
          ctx.lineTo(a.x2 - headLen * Math.cos(angle - 0.4), a.y2 - headLen * Math.sin(angle - 0.4));
          ctx.lineTo(a.x2 - headLen * Math.cos(angle + 0.4), a.y2 - headLen * Math.sin(angle + 0.4));
          ctx.closePath();
          ctx.fillStyle = stroke;
          ctx.fill();
          break;
        }
        case 'lob': {
          const l = resolveLobDisplayProps(ann, props as InterpolatedLob, tMs, currentHomography);
          ctx.beginPath();
          ctx.moveTo(l.start.x, l.start.y);
          ctx.quadraticCurveTo(l.control.x, l.control.y, l.end.x, l.end.y);
          ctx.stroke();
          const tx = l.end.x - l.control.x;
          const ty = l.end.y - l.control.y;
          const len = Math.hypot(tx, ty) || 1;
          const ux = tx / len;
          const uy = ty / len;
          const px = -uy;
          const py = ux;
          const headLength = Math.max(10, strokeWidth * 2.2);
          const headWidth = Math.max(8, strokeWidth * 1.6);
          const baseX = l.end.x - ux * headLength;
          const baseY = l.end.y - uy * headLength;
          ctx.beginPath();
          ctx.moveTo(l.end.x, l.end.y);
          ctx.lineTo(baseX + px * headWidth * 0.5, baseY + py * headWidth * 0.5);
          ctx.lineTo(baseX - px * headWidth * 0.5, baseY - py * headWidth * 0.5);
          ctx.closePath();
          ctx.fillStyle = stroke;
          ctx.fill();
          break;
        }
        case 'text': {
          const t = props as InterpolatedText;
          ctx.font = `${fontSize}px ${fontFamily}`;
          if (textHighlight) {
            const outlineColor = contrastStrokeForHex(stroke);
            const outlineWidth = Math.max(2, Math.round(fontSize * 0.18));
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = outlineWidth;
            ctx.strokeText(ann.text || '', t.x, t.y + fontSize);
          }
          ctx.fillStyle = stroke;
          ctx.fillText(ann.text || '', t.x, t.y + fontSize);
          break;
        }
        case 'highlight': {
          const hl = props as InterpolatedHighlight;
          ctx.beginPath();
          ctx.ellipse(hl.cx, hl.cy, hl.radius, hl.radius * 0.35, 0, 0, Math.PI * 2);
          if (fillColor !== 'transparent') ctx.fill();
          ctx.stroke();
          break;
        }
        case 'poly': {
          const points = resolvePolyDisplayPoints(ann, props as InterpolatedPoly, tMs, currentHomography);
          if (points.length < 2) break;
          ctx.beginPath();
          ctx.moveTo(points[0][0], points[0][1]);
          for (let j = 1; j < points.length; j++) {
            ctx.lineTo(points[j][0], points[j][1]);
          }
          if (ann.closed !== false) {
            ctx.closePath();
            if (fillColor !== 'transparent') ctx.fill();
          }
          ctx.stroke();
          break;
        }
      }
    }
  }, [annotations, currentHomography, resolveAnnotationDisplayStyle, resolveArrowDisplayProps, resolveLobDisplayProps, resolvePolyDisplayPoints, resolveShadowDisplayProps]);

  // --- Progress bar ---
  const progressFrac = clipDurationMs > 0 ? currentTMs / clipDurationMs : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Video + Konva overlay */}
      <div ref={hostRef} data-testid="clip-canvas-host" className="flex-1 min-h-0 relative bg-black">
        <video
          ref={videoRef}
          data-testid="clip-video"
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={onLoadedMetadata}
          onLoadedData={onVideoCanRender}
          onCanPlay={onVideoCanRender}
          onSeeked={onSeeked}
          style={{
            position: 'absolute',
            left: offsetX,
            top: offsetY,
            width: stageW,
            height: stageH,
            objectFit: 'fill',
          }}
        />
        {stageW > 0 && stageH > 0 && (
          <div
            data-testid="clip-stage"
            style={{
              position: 'absolute',
              left: offsetX,
              top: offsetY,
              width: stageW,
              height: stageH,
            }}
            >
            <Stage
              ref={stageRef}
              width={stageW}
              height={stageH}
              style={{ pointerEvents: 'auto' }}
              onMouseDown={onStageMouseDown}
              onMouseMove={onStageMouseMove}
              onMouseUp={onStageMouseUp}
              onClick={onStageClick}
              onDblClick={onStageDblClick}
              onContextMenu={(e: any) => e.evt?.preventDefault()}
            >
            <Layer>
              {shadowInterpolated.map(({ ann, props }) => renderAnnotation(ann, props))}
            </Layer>
            <Layer>
              {otherInterpolated.map(({ ann, props }) => renderAnnotation(ann, props))}
            </Layer>
            <Layer>
              {lineInterpolated.map(({ ann, props }) => renderAnnotation(ann, props))}
            </Layer>
            <Layer>
              {highlightInterpolated.map(({ ann, props }) => renderAnnotation(ann, props))}
            </Layer>
            {showHomographyOverlay && homographyOverlayLines.length > 0 && (
              <Layer listening={false}>
                {homographyOverlayLines.map((line, idx) => (
                  <KLine
                    key={`homography-overlay-${idx}`}
                    points={line.points}
                    stroke="#22d3ee"
                    strokeWidth={1.5 * scale}
                    dash={line.dashed ? [6 * scale, 4 * scale] : undefined}
                    opacity={0.9}
                    lineCap="round"
                    lineJoin="round"
                  />
                ))}
              </Layer>
            )}
            {foregroundCutout && (
              <Layer listening={false}>
                <KImage image={foregroundCutout} x={0} y={0} width={stageW} height={stageH} />
              </Layer>
            )}
            <Layer>
              {textInterpolated.map(({ ann, props }) => renderAnnotation(ann, props))}
            </Layer>
            <Layer>
              {/* Temp shape preview during drawing */}
              {tempShape?.type === 'box' && (
                tempPitchPreview?.type === 'box' ? (
                  <KLine
                    points={tempPitchPreview.points.map((value) => value * scale)}
                    stroke={defaultColor}
                    strokeWidth={defaultStrokeWidth * scale}
                    dash={[6 * scale, 3 * scale]}
                    closed
                    listening={false}
                  />
                ) : (
                  <KRect
                    x={tempShape.x * scale}
                    y={tempShape.y * scale}
                    width={tempShape.w * scale}
                    height={tempShape.h * scale}
                    stroke={defaultColor}
                    strokeWidth={defaultStrokeWidth * scale}
                    dash={[6 * scale, 3 * scale]}
                    listening={false}
                  />
                )
              )}
              {tempShape?.type === 'circle' && (
                tempPitchPreview?.type === 'circle' ? (
                  <KLine
                    points={tempPitchPreview.points.map((value) => value * scale)}
                    stroke={defaultColor}
                    strokeWidth={defaultStrokeWidth * scale}
                    dash={[6 * scale, 3 * scale]}
                    closed
                    listening={false}
                  />
                ) : (
                  <KEllipse
                    x={tempShape.cx * scale}
                    y={tempShape.cy * scale}
                    radiusX={tempShape.rx * scale}
                    radiusY={tempShape.ry * scale}
                    stroke={defaultColor}
                    strokeWidth={defaultStrokeWidth * scale}
                    dash={[6 * scale, 3 * scale]}
                    listening={false}
                  />
                )
              )}
              {tempShape?.type === 'shadow' && (
                <KLine
                  x={tempShape.x * scale}
                  y={tempShape.y * scale}
                  points={buildShadowSectorPoints(0, 0, tempShape.r, tempShape.rotation, tempShape.spreadDeg).map((value) => value * scale)}
                  stroke={defaultColor}
                  strokeWidth={defaultStrokeWidth * scale}
                  fill={hexToRgba(defaultColor, 0.18)}
                  closed
                  dash={[6 * scale, 3 * scale]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              )}
              {tempShape?.type === 'arrow' && (
                <KArrow
                  x={0} y={0}
                  points={[
                    tempShape.x1 * scale, tempShape.y1 * scale,
                    tempShape.x2 * scale, tempShape.y2 * scale,
                  ]}
                  stroke={defaultColor}
                  strokeWidth={defaultStrokeWidth * scale}
                  fill={defaultColor}
                  pointerLength={10 * scale}
                  pointerWidth={10 * scale}
                  dash={[6 * scale, 3 * scale]}
                  listening={false}
                />
              )}
              {tempShape?.type === 'lob' && (
                <KShape
                  x={0}
                  y={0}
                  stroke={defaultColor}
                  strokeWidth={defaultStrokeWidth * scale}
                  dash={[6 * scale, 3 * scale]}
                  fill={defaultColor}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                  sceneFunc={(ctx, shape) => {
                    drawLobPathWithArrowhead(
                      ctx,
                      shape,
                      { x: tempShape.x1 * scale, y: tempShape.y1 * scale },
                      { x: tempShape.cx * scale, y: tempShape.cy * scale },
                      { x: tempShape.x2 * scale, y: tempShape.y2 * scale },
                      defaultStrokeWidth * scale,
                    );
                  }}
                />
              )}
              {tempShape?.type === 'poly' && tempShape.points.length >= 2 && (
                <KLine
                  x={0}
                  y={0}
                  points={tempShape.points.flatMap(([x, y]) => [x * scale, y * scale])}
                  stroke={defaultColor}
                  strokeWidth={defaultStrokeWidth * scale}
                  fill={tempShape.closed ? hexToRgba(defaultFill, defaultFillOpacity) : 'transparent'}
                  closed={tempShape.closed}
                  dash={[6 * scale, 3 * scale]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              )}
            </Layer>
              <Layer>
                {multiSelectedAnnotationBounds.map(({ id, bounds }) => (
                  <KRect
                    key={`clip-multi-select-${id}`}
                    x={bounds.x * scale}
                    y={bounds.y * scale}
                    width={Math.max(0, bounds.w * scale)}
                    height={Math.max(0, bounds.h * scale)}
                    stroke="#60a5fa"
                    dash={[4 * scale, 4 * scale]}
                    strokeWidth={1.5 * scale}
                    listening={false}
                  />
                ))}
                {!selectedAnnotationIds.length && selectedAnnBounds && (
                  <KRect
                    x={selectedAnnBounds.x * scale}
                    y={selectedAnnBounds.y * scale}
                    width={Math.max(0, selectedAnnBounds.w * scale)}
                    height={Math.max(0, selectedAnnBounds.h * scale)}
                    stroke={selectedTrackingAccentColor}
                    dash={[4 * scale, 4 * scale]}
                    strokeWidth={1.5 * scale}
                    listening={false}
                  />
                )}
                {selectedAnn && selectedAnnInterpolated?.type === 'lob' && (() => {
                  const lob = selectedAnnInterpolated as InterpolatedLob;
                  return (
                    <>
                      <KLine
                        points={[
                          lob.x1 * scale,
                          lob.y1 * scale,
                          lob.cx * scale,
                          lob.cy * scale,
                          lob.x2 * scale,
                          lob.y2 * scale,
                        ]}
                        stroke={selectedTrackingAccentColor}
                        dash={[4 * scale, 4 * scale]}
                        strokeWidth={1.5 * scale}
                        listening={false}
                      />
                      <KCircle
                        x={lob.cx * scale}
                        y={lob.cy * scale}
                        radius={7 * scale}
                        fill={selectedTrackingAccentColor}
                        stroke="#ffffff"
                        strokeWidth={1.5 * scale}
                        draggable={canInteract}
                        onDragMove={(e: any) => handleSelectedLobControlDrag(e.target.position())}
                      />
                    </>
                  );
                })()}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  anchorSize={10 * scale}
                  enabledAnchors={selectedAnnCanUseTransformer ? undefined : []}
                />
              </Layer>
            </Stage>
            {videoReady && <div data-testid="clip-video-ready" className="sr-only">ready</div>}
            {selectedAnn && (
              <div
                className="absolute left-3 top-3 pointer-events-none"
                style={{
                  backgroundColor: selectedFrameTrackingState === 'lost'
                    ? 'rgba(127, 29, 29, 0.9)'
                    : 'rgba(17, 24, 39, 0.86)',
                  border: `1px solid ${selectedTrackingAccentColor}`,
                  color: '#f8fafc',
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 999,
                }}
              >
                {selectedTrackingStatusText}
              </div>
            )}
          </div>
        )}
        {isSelecting && selRect && (
          <div className="absolute inset-0 pointer-events-none">
            <svg width="100%" height="100%" className="absolute inset-0">
              <rect
                x={selRect.x * scale + offsetX}
                y={selRect.y * scale + offsetY}
                width={selRect.w * scale}
                height={selRect.h * scale}
                fill="rgba(59,130,246,0.15)"
                stroke="#60a5fa"
                strokeDasharray="4,4"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Timeline strip */}
      <TimelineStrip
        durationMs={clipDurationMs}
        currentTMs={currentTMs}
        fps={videoFps}
        currentFrameToleranceMs={currentFrameToleranceMs}
        annotations={annotations}
        selectedAnnotationId={selectedAnnotationId}
        analysisLoopRange={analysisLoopRange}
        retrackRangeEndMs={retrackRangeEndMs}
        onSeek={seekToMs}
        onSelectAnnotation={(annId) => {
          setSelectedAnnotationIds([]);
          setSelectedAnnotationId(annId);
        }}
        onSeekToKeyframe={(annId, tMs) => {
          setSelectedAnnotationIds([]);
          setSelectedAnnotationId(annId);
          seekToMs(tMs);
        }}
        onShiftClick={setRetrackRangeEndMs}
      />

      <div className="shrink-0 bg-surface border-t border-border">
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
          <div className="text-xs uppercase tracking-wide text-muted">Selection</div>
          {selectedAnnotationIds.length > 0 ? (
            <>
              <div className="text-xs font-medium">{selectedAnnotationIds.length} annotations selected</div>
              <div className="text-xs text-muted">Marquee selection matches the still editor: Shift adds, Cmd/Ctrl subtracts.</div>
            </>
          ) : selectedAnn ? (
            <>
              <div className="text-xs font-medium">{selectedAnn.type}</div>
              <div
                className="text-xs px-2 py-0.5 rounded-full border"
                style={{ borderColor: selectedTrackingAccentColor, color: selectedTrackingAccentColor }}
              >
                source: {selectedAnn.source}
              </div>
              <div className="text-xs text-muted">{selectedAnn.coordMode} coords</div>
              <div className="text-xs text-muted">{selectedAnn.keyframes.length} keyframe{selectedAnn.keyframes.length === 1 ? '' : 's'}</div>
              <div className="text-xs text-muted">
                {selectedCorrectionCount} correction point{selectedCorrectionCount === 1 ? '' : 's'} · {selectedLossSpans.length} lost span{selectedLossSpans.length === 1 ? '' : 's'}
              </div>
              {selectedNextCorrectionKeyframe && (
                <div className="text-xs text-muted">
                  next correction {formatTime(selectedNextCorrectionKeyframe.tMs)}
                </div>
              )}
              {retrackRangeBounds && (
                <div className="text-xs text-muted">
                  range {formatTime(retrackRangeBounds.startMs)}-{formatTime(retrackRangeBounds.endMs)}
                </div>
              )}
              <div
                className="text-xs px-2 py-0.5 rounded-full border"
                style={{ borderColor: selectedTrackingAccentColor, color: selectedTrackingAccentColor }}
              >
                {selectedTrackingStatusText}
              </div>
              <button
                onClick={handleInsertCurrentKeyframe}
                disabled={!selectedCanInsertCurrentKeyframe}
                className="px-2 py-1 text-xs border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title={selectedHasCurrentKeyframe
                  ? "A keyframe already exists at the current frame"
                  : "Create a keyframe for the selected annotation at the current frame"}
              >
                KF Here
              </button>
              <button
                onClick={handleDeleteCurrentKeyframe}
                disabled={!selectedCanDeleteCurrentKeyframe}
                className="px-2 py-1 text-xs border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Delete the selected annotation's current-frame keyframe when another keyframe still exists"
              >
                Delete KF
              </button>
            </>
          ) : (
            <div className="text-xs text-muted">No annotation selected. Pause playback and use Select mode to inspect or edit an annotation.</div>
          )}
          <div className="flex-1" />
          <div className="text-xs text-muted">Timeline markers show manual, tracked, correction, and lost states. Range retrack now works with an explicit range endpoint button as well as Shift-click on the timeline.</div>
        </div>
      </div>

      {manifest && (
        <div className="shrink-0 bg-surface border-t border-border">
          <div className="px-3 py-2 flex items-center gap-2">
            <div className="text-xs uppercase tracking-wide text-muted">Stills In Clip</div>
            <div className="text-xs text-muted">
              {inBoundsStills.length} available for import
            </div>
          </div>
          <div className="px-3 pb-3 overflow-x-auto">
            {inBoundsStills.length === 0 ? (
              <div className="text-xs text-muted py-1">No stills exist yet for this clip&apos;s source video.</div>
            ) : (
              <div className="flex items-stretch gap-2 min-w-max">
                {inBoundsStills.map((still) => {
                  const clipStillTMs = roundToFrame(getClipRelativeMsForStill(clip, still), videoFps);
                  const isCurrent = Math.abs(currentTMs - clipStillTMs) <= (1000 / Math.max(1, videoFps));
                  const timingLabel = formatTime(clipStillTMs);
                  return (
                    <div
                      key={still.id}
                      className={`rounded border px-2 py-1.5 min-w-[172px] cursor-pointer ${
                        isCurrent
                          ? 'border-accent bg-selected'
                          : 'border-subtle bg-canvas'
                      }`}
                      onClick={() => seekToMs(clipStillTMs)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          seekToMs(clipStillTMs);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title={`Jump to ${timingLabel}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium whitespace-nowrap">{timingLabel}</div>
                        <div className="text-[10px] uppercase tracking-wide whitespace-nowrap text-accent">
                          In clip
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              handleImportStill(still.id);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            disabled={isImportingStillId === still.id}
                            className="px-2 py-0.5 text-xs border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Import this still onto the matching clip frame"
                            aria-label={`Import ${timingLabel}`}
                          >
                            {isImportingStillId === still.id ? '…' : '↓'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {stillImportMessage && (
              <div className="text-xs text-muted mt-2">{stillImportMessage}</div>
            )}
          </div>
        </div>
      )}

      {/* Transport bar */}
      <div className="shrink-0 bg-surface border-t border-border">
        {/* Controls */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button
            onClick={() => shuttleByMs(-LONG_SHUTTLE_MS)}
            className="px-2 py-0.5 text-sm border-0 cursor-pointer"
            title="Jump back 1 second (Shift+←)"
          >
            -1s
          </button>
          <button
            onClick={() => shuttleByMs(-SHORT_SHUTTLE_MS)}
            className="px-2 py-0.5 text-sm border-0 cursor-pointer"
            title="Jump back 250 ms (Alt+←)"
          >
            -250
          </button>
          <button
            onClick={() => stepFrame(-1)}
            className="px-2 py-0.5 text-sm border-0 cursor-pointer"
            title="Previous frame (←)"
          >
            ⏮
          </button>
          <button
            onClick={togglePlay}
            className="px-3 py-0.5 text-sm border-0 cursor-pointer min-w-[3rem]"
            title="Play/Pause (Space)"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => stepFrame(1)}
            className="px-2 py-0.5 text-sm border-0 cursor-pointer"
            title="Next frame (→)"
          >
            ⏭
          </button>
          <button
            onClick={() => shuttleByMs(SHORT_SHUTTLE_MS)}
            className="px-2 py-0.5 text-sm border-0 cursor-pointer"
            title="Jump forward 250 ms (Alt+→)"
          >
            +250
          </button>
          <button
            onClick={() => shuttleByMs(LONG_SHUTTLE_MS)}
            className="px-2 py-0.5 text-sm border-0 cursor-pointer"
            title="Jump forward 1 second (Shift+→)"
          >
            +1s
          </button>

          <div className="h-4 w-px bg-border mx-1" />

          <label className="text-xs text-muted flex items-center gap-1">
            Loop
            <select
              value={analysisLoopDurationMs}
              onChange={(event) => {
                const nextDuration = Number(event.target.value);
                setAnalysisLoopDurationMs(nextDuration);
                setAnalysisLoopRange((previous) => (
                  previous ? buildAnalysisLoopRange(currentTMsRef.current, nextDuration) : previous
                ));
              }}
              className="bg-transparent text-xs border border-border rounded px-1 py-0.5"
              title="Short local playback loop duration"
            >
              {ANALYSIS_LOOP_OPTIONS_MS.map((durationMs) => (
                <option key={durationMs} value={durationMs}>
                  {durationMs / 1000}s
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setAnalysisLoopRange(buildAnalysisLoopRange(currentTMsRef.current, analysisLoopDurationMs))}
            className="px-3 py-0.5 text-sm border-0 cursor-pointer"
            title="Loop around the current frame (L toggles on/off)"
          >
            {analysisLoopRange ? 'Update Loop' : 'Set Loop'}
          </button>
          {analysisLoopRange && (
            <button
              onClick={() => setAnalysisLoopRange(null)}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer"
              title="Clear the local analysis loop"
            >
              Clear Loop
            </button>
          )}

          {/* Track button */}
          {hasTrackingCapability && (
            <button
              onClick={handleTrack}
              disabled={!trackButtonEnabled || isTracking || isPlaying}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={trackButtonTitle}
            >
              {isTracking ? 'Tracking...' : 'Track'}
            </button>
          )}

          {/* Re-track from here */}
          {showRetrackButton && !isPlaying && (
            <button
              onClick={handleRetrackFromHere}
              disabled={isTracking}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Re-track from current time forward"
            >
              {isTracking ? '...' : 'Re-track →'}
            </button>
          )}

          {showRetrackButton && !isPlaying && (
            <button
              onClick={handleSetRetrackRangeEnd}
              disabled={isTracking}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Store the current playhead as the other end of a re-track range. You can also Shift-click the timeline."
            >
              Mark Range End
            </button>
          )}

          {/* Re-track range */}
          {showRetrackButton && !isPlaying && (
            <button
              onClick={handleRetrackRange}
              disabled={!canRetrackRange || isTracking}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={retrackRangeBounds
                ? `Re-track the selected range (${formatTime(retrackRangeBounds.startMs)}-${formatTime(retrackRangeBounds.endMs)}). Set the other endpoint with Mark Range End or Shift-click on the timeline.`
                : "Set a range end first with Mark Range End or Shift-click on the timeline."}
            >
              Re-track range
            </button>
          )}

          {canRetrackToNextCorrection && !isPlaying && (
            <button
              onClick={handleRetrackToNextCorrection}
              disabled={isTracking}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={`Re-track from the current frame until the next correction point at ${formatTime(selectedNextCorrectionKeyframe!.tMs)}`}
            >
              To Next Correction
            </button>
          )}

          {showRetrackButton && retrackRangeBounds && !isPlaying && (
            <>
              <span
                className="text-xs text-amber-300 font-mono tabular-nums"
                title="Active re-track range"
              >
                Range {formatTime(retrackRangeBounds.startMs)}-{formatTime(retrackRangeBounds.endMs)}
              </span>
              <button
                onClick={handleClearRetrackRange}
                className="px-3 py-0.5 text-sm border-0 cursor-pointer"
                title="Clear the current re-track range"
              >
                Clear Range
              </button>
            </>
          )}

          {/* Undo re-track */}
          {undoSnapshot && (
            <button
              onClick={handleUndoTracking}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer"
              title="Undo last re-track"
            >
              Undo
            </button>
          )}

          {/* Compute homography / status */}
          {hasHomographyCapability && (
            <button
              onClick={handleComputeHomography}
              disabled={!canComputeHomography || isComputingHomography}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={canComputeHomography
                ? 'Compute pitch homography for this clip range'
                : 'Homography unavailable: no registered video source'}
            >
              {isComputingHomography ? 'Computing H...' : homographyFrames ? 'Recompute H' : 'Compute H'}
            </button>
          )}
          {homographyFrames && (
            <button
              onClick={() => setShowHomographyOverlay(prev => !prev)}
              disabled={!currentHomography}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={currentHomography
                ? (showHomographyOverlay ? 'Hide homography pitch overlay' : 'Show where homography sees the pitch')
                : 'No usable homography at current frame'}
            >
              {showHomographyOverlay ? 'Hide H' : 'Show H'}
            </button>
          )}
          {homographyFrames && (
            <span className="text-xs text-muted" title={`${homographyFrames.length} homography frames loaded`}>
              H✓
            </span>
          )}
          {homographyFrames && (
            <button
              onClick={() => setDrawCoordMode(prev => (prev === 'pitch' ? 'image' : 'pitch'))}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer"
              title={
                drawCoordMode === 'pitch'
                  ? 'Prefer pitch coordinates for supported tools when the current frame has a usable homography'
                  : 'Use image coordinates for new annotations'
              }
            >
              {effectiveDrawCoordMode === 'pitch' ? 'Draw: Pitch' : 'Draw: Image'}
            </button>
          )}
          {homographyFrames && drawCoordModeStatus && (
            <span className="text-xs text-muted" title={drawCoordModeStatus}>
              {drawCoordModeStatus}
            </span>
          )}

          {/* Occlusion toggle */}
          {canSegment && (
            <>
              <button
                onClick={() => setOcclusionEnabled(prev => !prev)}
                className={`px-3 py-0.5 text-sm border-0 cursor-pointer ${occlusionEnabled ? 'text-green-400' : ''}`}
                title={occlusionEnabled
                  ? 'Disable paused-frame foreground occlusion (people rendered above annotations when paused)'
                  : 'Enable paused-frame foreground occlusion (people rendered above annotations when paused)'}
              >
                {occlusionEnabled ? 'Occ ✓' : 'Occ'}
              </button>
              {occlusionStatus && (
                <span className="text-xs text-muted" title={occlusionStatus}>
                  {occlusionStatus}
                </span>
              )}
            </>
          )}

          {/* Export */}
          {canExport && (
            <button
              onClick={() => setShowExportModal(true)}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer"
              title="Export clip as MP4 video with annotations"
            >
              Export
            </button>
          )}

          <div className="flex-1" />

          {/* Track error */}
          {trackError && (
            <span className="text-xs text-red-400 mr-2 max-w-[200px] truncate" title={trackError}>
              {trackError}
            </span>
          )}

          {analysisLoopRange && (
            <span className="text-xs text-amber-300 mr-2 font-mono tabular-nums" title="Active local analysis loop">
              Loop {formatTime(analysisLoopRange.startMs)}-{formatTime(analysisLoopRange.endMs)}
            </span>
          )}

          <span className="text-xs text-muted font-mono tabular-nums">
            {formatTime(currentTMs)} / {formatTime(clipDurationMs)}
          </span>

          <span className="text-xs text-muted ml-2">
            {annotations.length} ann · {interpolated.length} visible
          </span>

          {saveStatus !== 'idle' && (
            <span className={`text-xs ml-2 ${saveStatus === 'error' ? 'text-red-400' : 'text-muted'}`}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save error'}
            </span>
          )}

          {/* Sidecar status dot */}
          <span
            className="ml-2 inline-block w-2 h-2 shrink-0"
            style={{
              backgroundColor: sidecar.connected ? '#22c55e' : '#6b7280',
              borderRadius: '50%',
            }}
            title={sidecar.connected
              ? `Sidecar connected (${sidecar.capabilities.join(', ')})`
              : 'Sidecar not connected'}
          />
        </div>
      </div>

      {/* Export modal */}
      {showExportModal && videoRef.current && (
        <ExportModal
          clip={currentClip}
          annotations={annotations}
          videoEl={videoRef.current}
          videoFps={videoFps}
          sidecarBaseUrl={sidecar.baseUrl}
          onClose={() => setShowExportModal(false)}
          renderAnnotationsToCanvas={renderAnnotationsToCanvas}
        />
      )}
    </div>
  );
}
