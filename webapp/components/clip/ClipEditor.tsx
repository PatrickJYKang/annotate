"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect as KRect, Ellipse as KEllipse, Arrow as KArrow, Text as KText, Line as KLine, Circle as KCircle, Image as KImage } from "react-konva";
import type { Clip, ClipAnnotation, ClipAnnotationType, ClipKeyframe, BoxKeyframe, CircleKeyframe, ArrowKeyframe, TextKeyframe, HighlightKeyframe } from "../../lib/types/clip";
import {
  interpolateKeyframes,
  type InterpolatedKeyframe,
  type InterpolatedBox,
  type InterpolatedCircle,
  type InterpolatedArrow,
  type InterpolatedText,
  type InterpolatedPoly,
  type InterpolatedHighlight,
} from "../../lib/clip/interpolation";
import { hexToRgba, contrastStrokeForHex, dashFromStrokePattern, makeId } from "../../lib/annotate/shapeRendering";
import type { StrokePattern } from "../../lib/annotate/shapeRendering";
import { writeClip } from "../../lib/fs/clipStorage";
import { findOverlappingCache, writeHomographyCache, type HomographyFrame } from "../../lib/fs/homographyCache";
import { useSidecar } from "../../lib/state/SidecarContext";
import { requestTracking, requestHomography, requestManualTrackHomography, type TrackingError } from "../../lib/clip/sidecarClient";
import { convertTrackingKeyframes } from "../../lib/clip/bboxConvert";
import { applyHomography, applyHomographyInv, computeHomographyFromCorrespondences, invert3, rectPlaneToImagePoints, ellipsePlaneToImagePoints } from "../../lib/annotate/homography";
import { OcclusionCache, fetchOcclusionMask, compositeForeground, roundToFrame } from "../../lib/clip/occlusionCompositor";
import {
  getSidecarVideoLocator,
  hasSidecarVideoSource,
  isTrackableAnnotationType,
} from "../../lib/clip/videoLocator";
import ExportModal from "./ExportModal";
import TimelineStrip from "./TimelineStrip";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ClipTool = 'select' | 'box' | 'circle' | 'arrow' | 'text' | 'highlight';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface ClipEditorProps {
  clip: Clip;
  videoUrl: string;
  videoFps: number;
  projectDir?: FileSystemDirectoryHandle;
  videoRef?: string;
  videoPath?: string;
  tool?: ClipTool;
  defaultColor?: string;
  defaultStrokeWidth?: number;
  onClipUpdate?: (clip: Clip) => void;
  onSaveStatus?: (status: SaveStatus) => void;
}

const PITCH_MIN = 3;
const PITCH_MAX = 317;
const PITCH_CENTER = (PITCH_MIN + PITCH_MAX) / 2;

type ManualPitchKeypoint = {
  id: string;
  label: string;
  tooltip: string;
  x: number;
  y: number;
};

const FIELD_SPAN = PITCH_MAX - PITCH_MIN;
const PENALTY_DEPTH = FIELD_SPAN * (16.5 / 105);
const SIX_YARD_DEPTH = FIELD_SPAN * (5.5 / 105);
const PENALTY_HALF_WIDTH = FIELD_SPAN * ((40.32 / 2) / 68);
const SIX_YARD_HALF_WIDTH = FIELD_SPAN * ((18.32 / 2) / 68);
const PENALTY_SPOT_OFFSET = FIELD_SPAN * (11 / 105);
const ARC_RADIUS = FIELD_SPAN * (9.15 / 105);
const ARC_DX = PENALTY_DEPTH - PENALTY_SPOT_OFFSET;
const ARC_DY = Math.sqrt(Math.max(0, ARC_RADIUS * ARC_RADIUS - ARC_DX * ARC_DX));

const LEFT_PENALTY_X = PITCH_MIN + PENALTY_DEPTH;
const RIGHT_PENALTY_X = PITCH_MAX - PENALTY_DEPTH;
const LEFT_SIX_X = PITCH_MIN + SIX_YARD_DEPTH;
const RIGHT_SIX_X = PITCH_MAX - SIX_YARD_DEPTH;

const PENALTY_TOP_Y = PITCH_CENTER - PENALTY_HALF_WIDTH;
const PENALTY_BOTTOM_Y = PITCH_CENTER + PENALTY_HALF_WIDTH;
const SIX_TOP_Y = PITCH_CENTER - SIX_YARD_HALF_WIDTH;
const SIX_BOTTOM_Y = PITCH_CENTER + SIX_YARD_HALF_WIDTH;

const LEFT_PENALTY_SPOT_X = PITCH_MIN + PENALTY_SPOT_OFFSET;
const RIGHT_PENALTY_SPOT_X = PITCH_MAX - PENALTY_SPOT_OFFSET;

const MANUAL_PITCH_KEYPOINTS: ManualPitchKeypoint[] = [
  // Pitch outer corners
  { id: 'tl', label: 'TL', tooltip: 'Top-left pitch corner', x: PITCH_MIN, y: PITCH_MIN },
  { id: 'tr', label: 'TR', tooltip: 'Top-right pitch corner', x: PITCH_MAX, y: PITCH_MIN },
  { id: 'br', label: 'BR', tooltip: 'Bottom-right pitch corner', x: PITCH_MAX, y: PITCH_MAX },
  { id: 'bl', label: 'BL', tooltip: 'Bottom-left pitch corner', x: PITCH_MIN, y: PITCH_MAX },

  // Center line + center spot
  { id: 'cl_t', label: 'CL-T', tooltip: 'Center line at top touchline', x: PITCH_CENTER, y: PITCH_MIN },
  { id: 'cl_b', label: 'CL-B', tooltip: 'Center line at bottom touchline', x: PITCH_CENTER, y: PITCH_MAX },
  { id: 'c_sp', label: 'C-SP', tooltip: 'Center spot', x: PITCH_CENTER, y: PITCH_CENTER },

  // Left penalty area box (4 corners)
  { id: 'lpa_tl', label: 'LPA-TL', tooltip: 'Left penalty area top-left corner', x: PITCH_MIN, y: PENALTY_TOP_Y },
  { id: 'lpa_tr', label: 'LPA-TR', tooltip: 'Left penalty area top-right corner', x: LEFT_PENALTY_X, y: PENALTY_TOP_Y },
  { id: 'lpa_br', label: 'LPA-BR', tooltip: 'Left penalty area bottom-right corner', x: LEFT_PENALTY_X, y: PENALTY_BOTTOM_Y },
  { id: 'lpa_bl', label: 'LPA-BL', tooltip: 'Left penalty area bottom-left corner', x: PITCH_MIN, y: PENALTY_BOTTOM_Y },

  // Right penalty area box (4 corners)
  { id: 'rpa_tl', label: 'RPA-TL', tooltip: 'Right penalty area top-left corner', x: RIGHT_PENALTY_X, y: PENALTY_TOP_Y },
  { id: 'rpa_tr', label: 'RPA-TR', tooltip: 'Right penalty area top-right corner', x: PITCH_MAX, y: PENALTY_TOP_Y },
  { id: 'rpa_br', label: 'RPA-BR', tooltip: 'Right penalty area bottom-right corner', x: PITCH_MAX, y: PENALTY_BOTTOM_Y },
  { id: 'rpa_bl', label: 'RPA-BL', tooltip: 'Right penalty area bottom-left corner', x: RIGHT_PENALTY_X, y: PENALTY_BOTTOM_Y },

  // Left six-yard box (4 corners)
  { id: 'lsb_tl', label: 'LSB-TL', tooltip: 'Left six-yard box top-left corner', x: PITCH_MIN, y: SIX_TOP_Y },
  { id: 'lsb_tr', label: 'LSB-TR', tooltip: 'Left six-yard box top-right corner', x: LEFT_SIX_X, y: SIX_TOP_Y },
  { id: 'lsb_br', label: 'LSB-BR', tooltip: 'Left six-yard box bottom-right corner', x: LEFT_SIX_X, y: SIX_BOTTOM_Y },
  { id: 'lsb_bl', label: 'LSB-BL', tooltip: 'Left six-yard box bottom-left corner', x: PITCH_MIN, y: SIX_BOTTOM_Y },

  // Right six-yard box (4 corners)
  { id: 'rsb_tl', label: 'RSB-TL', tooltip: 'Right six-yard box top-left corner', x: RIGHT_SIX_X, y: SIX_TOP_Y },
  { id: 'rsb_tr', label: 'RSB-TR', tooltip: 'Right six-yard box top-right corner', x: PITCH_MAX, y: SIX_TOP_Y },
  { id: 'rsb_br', label: 'RSB-BR', tooltip: 'Right six-yard box bottom-right corner', x: PITCH_MAX, y: SIX_BOTTOM_Y },
  { id: 'rsb_bl', label: 'RSB-BL', tooltip: 'Right six-yard box bottom-left corner', x: RIGHT_SIX_X, y: SIX_BOTTOM_Y },

  // Penalty spots
  { id: 'l_ps', label: 'L-PS', tooltip: 'Left penalty spot', x: LEFT_PENALTY_SPOT_X, y: PITCH_CENTER },
  { id: 'r_ps', label: 'R-PS', tooltip: 'Right penalty spot', x: RIGHT_PENALTY_SPOT_X, y: PITCH_CENTER },

  // Penalty arcs (sampled as top/apex/bottom for each side)
  { id: 'l_arc_t', label: 'L-ARC-T', tooltip: 'Left penalty arc top point', x: LEFT_PENALTY_X, y: PITCH_CENTER - ARC_DY },
  { id: 'l_arc_a', label: 'L-ARC-A', tooltip: 'Left penalty arc apex (toward center)', x: LEFT_PENALTY_SPOT_X + ARC_RADIUS, y: PITCH_CENTER },
  { id: 'l_arc_b', label: 'L-ARC-B', tooltip: 'Left penalty arc bottom point', x: LEFT_PENALTY_X, y: PITCH_CENTER + ARC_DY },
  { id: 'r_arc_t', label: 'R-ARC-T', tooltip: 'Right penalty arc top point', x: RIGHT_PENALTY_X, y: PITCH_CENTER - ARC_DY },
  { id: 'r_arc_a', label: 'R-ARC-A', tooltip: 'Right penalty arc apex (toward center)', x: RIGHT_PENALTY_SPOT_X - ARC_RADIUS, y: PITCH_CENTER },
  { id: 'r_arc_b', label: 'R-ARC-B', tooltip: 'Right penalty arc bottom point', x: RIGHT_PENALTY_X, y: PITCH_CENTER + ARC_DY },
];

function isUsableHomographyFrame(frame: HomographyFrame): boolean {
  return (
    frame.method !== 'failed'
    && Array.isArray(frame.matrix)
    && frame.matrix.length === 9
    && frame.matrix.every(Number.isFinite)
  );
}

function determinant3(m: number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

function normalizeHomography(m: number[]): number[] | null {
  if (m.length !== 9 || !m.every(Number.isFinite)) return null;
  const s = Math.abs(m[8]) > 1e-9 ? m[8] : 1;
  const out = m.map(v => v / s);
  if (!out.every(Number.isFinite)) return null;
  if (Math.abs(determinant3(out)) < 1e-9) return null;
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClipEditor({
  clip,
  videoUrl,
  videoFps,
  projectDir,
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const arrowStartRef = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<any>(null);

  // Temp shape for preview during drawing (not a real annotation yet)
  type TempShape =
    | { type: 'box'; x: number; y: number; w: number; h: number }
    | { type: 'circle'; cx: number; cy: number; rx: number; ry: number }
    | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number }
    | null;
  const [tempShape, setTempShape] = useState<TempShape>(null);

  // --- Defaults ---
  const tool = toolProp || 'select';
  const defaultColor = defaultColorProp || '#ff0000';
  const defaultStrokeWidth = defaultStrokeWidthProp || 3;

  // --- State ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTMs, setCurrentTMs] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 450 });
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 1920, h: 1080 });
  const [annotations, setAnnotations] = useState<ClipAnnotation[]>(clip.annotations);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // --- Homography state ---
  const [homographyFrames, setHomographyFrames] = useState<HomographyFrame[] | null>(null);
  const [isComputingHomography, setIsComputingHomography] = useState(false);
  const [showHomographyOverlay, setShowHomographyOverlay] = useState(false);
  const [drawCoordMode, setDrawCoordMode] = useState<'image' | 'pitch'>('image');
  const [isManualHomographyMode, setIsManualHomographyMode] = useState(false);
  const [manualKeypointImageById, setManualKeypointImageById] = useState<Record<string, { x: number; y: number }>>({});
  const [manualKeypointOrder, setManualKeypointOrder] = useState<string[]>([]);
  const [selectedManualPitchKeyId, setSelectedManualPitchKeyId] = useState<string>(MANUAL_PITCH_KEYPOINTS[0].id);
  const currentHomographyInvRef = useRef<number[] | null>(null);

  // --- Occlusion state ---
  const [occlusionEnabled, setOcclusionEnabled] = useState(false);
  const [foregroundCutout, setForegroundCutout] = useState<HTMLCanvasElement | null>(null);
  const occlusionGenRef = useRef(0);
  const occlusionCacheRef = useRef(new OcclusionCache());

  // --- Export state ---
  const [showExportModal, setShowExportModal] = useState(false);

  // Sync annotations from clip prop if it changes externally
  useEffect(() => { setAnnotations(clip.annotations); }, [clip.annotations]);

  // Load homography cache on mount
  useEffect(() => {
    if (!projectDir) return;
    (async () => {
      const cached = await findOverlappingCache(projectDir, clip.startMs, clip.endMs);
      if (cached) setHomographyFrames(cached);
    })();
  }, [projectDir, clip.startMs, clip.endMs]);

  const clipDurationMs = clip.endMs - clip.startMs;

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
    v.currentTime = clip.startMs / 1000;
  }, [clip.startMs]);

  const onSeeked = useCallback(() => {
    setVideoReady(true);
  }, []);

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

      // Auto-pause at end
      if (clamped >= clipDurationMs && !v.paused) {
        v.pause();
        setIsPlaying(false);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [clip.startMs, clipDurationMs]);

  // --- Play / Pause ---
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // If at end, reset to start
      const tMs = v.currentTime * 1000 - clip.startMs;
      if (tMs >= clipDurationMs - 1) {
        v.currentTime = clip.startMs / 1000;
      }
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, [clip.startMs, clipDurationMs]);

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

  const scheduleSave = useCallback(() => {
    if (!projectDir) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const toSave: Clip = { ...clip, annotations: annotationsRef.current };
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
    }, 800);
  }, [projectDir, clip, onClipUpdate, onSaveStatus]);

  // Trigger save on annotation changes
  const prevAnnotationsRef = useRef(annotations);
  useEffect(() => {
    if (annotations !== prevAnnotationsRef.current) {
      prevAnnotationsRef.current = annotations;
      scheduleSave();
    }
  }, [annotations, scheduleSave]);

  // Cleanup save timer
  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // --- Annotation mutation helpers ---

  // Insert or update keyframe at tMs for an annotation
  const upsertKeyframe = useCallback((annId: string, tMs: number, props: Record<string, any>) => {
    const frameTolerance = 1000 / videoFps;
    setAnnotations(prev => prev.map(ann => {
      if (ann.id !== annId) return ann;
      const kfs = [...ann.keyframes];
      const existIdx = kfs.findIndex(k => Math.abs(k.tMs - tMs) < frameTolerance);
      if (existIdx >= 0) {
        kfs[existIdx] = { ...kfs[existIdx], ...props, tMs };
      } else {
        kfs.push({ ...props, tMs } as ClipKeyframe);
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
    const Hinv = currentHomographyInvRef.current;
    const usePitchCoords = drawCoordMode === 'pitch' && !!Hinv;
    const toPitchPoint = (x: number, y: number) => {
      if (!Hinv) return { u: x, v: y };
      return applyHomographyInv(Hinv, x, y);
    };

    let keyframeGeometry: Record<string, any> = geometry;
    if (usePitchCoords) {
      switch (type) {
        case 'box': {
          const x = Number(geometry.x ?? 0);
          const y = Number(geometry.y ?? 0);
          const w = Number(geometry.w ?? 0);
          const h = Number(geometry.h ?? 0);
          const corners = [
            toPitchPoint(x, y),
            toPitchPoint(x + w, y),
            toPitchPoint(x + w, y + h),
            toPitchPoint(x, y + h),
          ];
          const us = corners.map(p => p.u);
          const vs = corners.map(p => p.v);
          const minU = Math.min(...us);
          const maxU = Math.max(...us);
          const minV = Math.min(...vs);
          const maxV = Math.max(...vs);
          keyframeGeometry = { x: minU, y: minV, w: maxU - minU, h: maxV - minV };
          break;
        }
        case 'circle': {
          const cx = Number(geometry.cx ?? 0);
          const cy = Number(geometry.cy ?? 0);
          const rx = Number(geometry.rx ?? 0);
          const ry = Number(geometry.ry ?? 0);
          const c = toPitchPoint(cx, cy);
          const px = toPitchPoint(cx + rx, cy);
          const py = toPitchPoint(cx, cy + ry);
          keyframeGeometry = {
            cx: c.u,
            cy: c.v,
            rx: Math.hypot(px.u - c.u, px.v - c.v),
            ry: Math.hypot(py.u - c.u, py.v - c.v),
          };
          break;
        }
        case 'highlight': {
          const cx = Number(geometry.cx ?? 0);
          const cy = Number(geometry.cy ?? 0);
          const radius = Number(geometry.radius ?? 0);
          const c = toPitchPoint(cx, cy);
          const p = toPitchPoint(cx + radius, cy);
          keyframeGeometry = {
            cx: c.u,
            cy: c.v,
            radius: Math.hypot(p.u - c.u, p.v - c.v),
          };
          break;
        }
        case 'arrow': {
          const p1 = toPitchPoint(Number(geometry.x1 ?? 0), Number(geometry.y1 ?? 0));
          const p2 = toPitchPoint(Number(geometry.x2 ?? 0), Number(geometry.y2 ?? 0));
          keyframeGeometry = { x1: p1.u, y1: p1.v, x2: p2.u, y2: p2.v };
          break;
        }
        case 'text': {
          const p = toPitchPoint(Number(geometry.x ?? 0), Number(geometry.y ?? 0));
          keyframeGeometry = { x: p.u, y: p.v };
          break;
        }
      }
    }

    const ann: ClipAnnotation = {
      id: makeId(),
      type,
      coordMode: usePitchCoords ? 'pitch' : 'image',
      source: 'manual',
      style: { stroke: defaultColor, strokeWidth: defaultStrokeWidth },
      keyframes: [{ tMs: currentTMsRef.current, ...keyframeGeometry } as ClipKeyframe],
    };
    setAnnotations(prev => [...prev, ann]);
    setSelectedAnnotationId(ann.id);
    return ann.id;
  }, [defaultColor, defaultStrokeWidth, drawCoordMode]);

  // Delete selected annotation
  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId) return;
    setAnnotations(prev => prev.filter(a => a.id !== selectedAnnotationId));
    setSelectedAnnotationId(null);
  }, [selectedAnnotationId]);

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
      }
      return;
    }

    const token = ++occlusionGenRef.current;
    setForegroundCutout(null);

    (async () => {
      try {
        const { mask } = await fetchOcclusionMask(videoLocator, absMs);
        if (token !== occlusionGenRef.current) { mask.close(); return; }
        cache.set(frameKey, mask);
        const v = videoRef.current;
        if (v && v.videoWidth > 0) {
          const cutout = compositeForeground(v, mask, videoSize.w, videoSize.h);
          if (token !== occlusionGenRef.current) return;
          setForegroundCutout(cutout);
        }
      } catch (err) {
        if (token !== occlusionGenRef.current) return;
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
  const prevSelectedRef = useRef(selectedAnnotationId);
  useEffect(() => {
    if (selectedAnnotationId !== prevSelectedRef.current) {
      prevSelectedRef.current = selectedAnnotationId;
      setRetrackRangeEndMs(null);
    }
  }, [selectedAnnotationId]);

  // Helper: determine if selected annotation is a corrected/auto tracked annotation
  const selectedAnn = useMemo(() => {
    if (!selectedAnnotationId) return null;
    return annotations.find(a => a.id === selectedAnnotationId) || null;
  }, [selectedAnnotationId, annotations]);

  const canTrackSelection = !!selectedAnn && isTrackableAnnotationType(selectedAnn.type);
  const trackButtonEnabled = canTrack && canTrackSelection;
  const trackButtonTitle = !hasTrackingCapability
    ? 'Tracking unavailable: sidecar not connected or tracking model missing'
    : !hasVideoSource
      ? 'Tracking unavailable: no registered video source'
      : !selectedAnn
        ? 'Select an annotation to track'
        : !isTrackableAnnotationType(selectedAnn.type)
          ? 'Tracking supports box, circle, or highlight annotations'
          : 'Track selected annotation across clip';

  const showRetrackButton = canTrack && selectedAnn &&
    (selectedAnn.source === 'auto' || selectedAnn.source === 'corrected') &&
    isTrackableAnnotationType(selectedAnn.type);

  // Helper: extract seed bbox from interpolated annotation
  const extractSeedBbox = useCallback((interp: InterpolatedKeyframe): { x: number; y: number; w: number; h: number } | null => {
    switch (interp.type) {
      case 'box': {
        const b = interp as InterpolatedBox;
        return { x: b.x, y: b.y, w: b.w, h: b.h };
      }
      case 'circle': {
        const c = interp as InterpolatedCircle;
        return { x: c.cx - c.rx, y: c.cy - c.ry, w: c.rx * 2, h: c.ry * 2 };
      }
      case 'highlight': {
        const h = interp as InterpolatedHighlight;
        const r = h.radius;
        return { x: h.cx - r, y: h.cy - r * 0.35, w: r * 2, h: r * 0.7 };
      }
      default:
        return null;
    }
  }, []);

  // Shared tracking helper: call /track, convert keyframes, update annotation
  const doTrack = useCallback(async (
    ann: ClipAnnotation,
    seedBbox: { x: number; y: number; w: number; h: number },
    seedFrameMs: number,
    trackStartMs: number,
    trackEndMs: number,
    mergeMode: 'replace' | 'forward' | 'range',
    rangeEndMs?: number,
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

      setAnnotations(prev => prev.map(a => {
        if (a.id !== ann.id) return a;

        let merged: ClipKeyframe[];
        if (mergeMode === 'replace') {
          merged = newKeyframes;
        } else if (mergeMode === 'forward') {
          // Keep keyframes <= currentTMs, replace those after
          const tMs = currentTMsRef.current;
          const kept = a.keyframes.filter(k => k.tMs <= tMs);
          merged = [...kept, ...newKeyframes.filter(k => k.tMs > tMs)];
        } else {
          // range: keep before rangeStart and after rangeEnd, replace middle
          const rangeStart = currentTMsRef.current;
          const rangeEnd = rangeEndMs ?? clipDurationMs;
          const before = a.keyframes.filter(k => k.tMs < rangeStart);
          const after = a.keyframes.filter(k => k.tMs > rangeEnd);
          const middle = newKeyframes.filter(k => k.tMs >= rangeStart && k.tMs <= rangeEnd);
          merged = [...before, ...middle, ...after];
        }

        merged.sort((x, y) => x.tMs - y.tMs);
        const source = mergeMode === 'replace' ? 'auto' as const : 'corrected' as const;
        return { ...a, keyframes: merged, source };
      }));
      setRetrackRangeEndMs(null);
    } catch (e: any) {
      const msg = (e as TrackingError)?.message || e?.message || 'Tracking failed';
      setTrackError(msg);
      setUndoSnapshot(null); // Clear snapshot on failure
    } finally {
      setIsTracking(false);
    }
  }, [hasVideoSource, videoLocator, videoFps, clip.startMs, clipDurationMs, sidecar.baseUrl]);

  // Full track: replace all keyframes
  const handleTrack = useCallback(async () => {
    if (!selectedAnn) return;
    const ann = selectedAnn;
    if (!isTrackableAnnotationType(ann.type)) {
      setTrackError('Tracking supports box, circle, or highlight annotations');
      return;
    }

    const interp = interpolateKeyframes(ann.keyframes, currentTMsRef.current, ann.type, videoFps);
    if (!interp) { setTrackError('No visible annotation at current time'); return; }

    const seedBbox = extractSeedBbox(interp);
    if (!seedBbox) { setTrackError('Tracking only works with box, circle, or highlight annotations'); return; }

    await doTrack(ann, seedBbox, clip.startMs + currentTMsRef.current, clip.startMs, clip.endMs, 'replace');
  }, [selectedAnn, videoFps, clip.startMs, clip.endMs, extractSeedBbox, doTrack]);

  // Re-track from here: keep keyframes <= currentTMs, re-track forward
  const handleRetrackFromHere = useCallback(async () => {
    if (!hasVideoSource || !selectedAnn) return;
    const ann = selectedAnn;
    const tMs = currentTMsRef.current;

    const interp = interpolateKeyframes(ann.keyframes, tMs, ann.type, videoFps);
    if (!interp) { setTrackError('No visible annotation at current time'); return; }

    const seedBbox = extractSeedBbox(interp);
    if (!seedBbox) { setTrackError('Cannot extract bbox for re-tracking'); return; }

    const seedAbsMs = clip.startMs + tMs;
    await doTrack(ann, seedBbox, seedAbsMs, seedAbsMs, clip.endMs, 'forward');
  }, [hasVideoSource, selectedAnn, videoFps, clip.startMs, clip.endMs, extractSeedBbox, doTrack]);

  // Re-track range: re-track between currentTMs and retrackRangeEndMs
  const handleRetrackRange = useCallback(async () => {
    if (!hasVideoSource || !selectedAnn || retrackRangeEndMs == null) return;
    const ann = selectedAnn;
    const tMs = currentTMsRef.current;

    const interp = interpolateKeyframes(ann.keyframes, tMs, ann.type, videoFps);
    if (!interp) { setTrackError('No visible annotation at current time'); return; }

    const seedBbox = extractSeedBbox(interp);
    if (!seedBbox) { setTrackError('Cannot extract bbox for re-tracking'); return; }

    const rangeStartMs = Math.min(tMs, retrackRangeEndMs);
    const rangeEndMs = Math.max(tMs, retrackRangeEndMs);
    const seedAbsMs = clip.startMs + tMs;
    const trackStart = clip.startMs + rangeStartMs;
    const trackEnd = clip.startMs + rangeEndMs;
    await doTrack(ann, seedBbox, seedAbsMs, trackStart, trackEnd, 'range', rangeEndMs);
  }, [hasVideoSource, selectedAnn, retrackRangeEndMs, videoFps, clip.startMs, extractSeedBbox, doTrack]);

  // Undo: revert to snapshot
  const handleUndo = useCallback(() => {
    if (!undoSnapshot) return;
    setAnnotations(prev => prev.map(a => {
      if (a.id !== undoSnapshot.annId) return a;
      return { ...a, keyframes: undoSnapshot.keyframes, source: undoSnapshot.source };
    }));
    setUndoSnapshot(null);
    setTrackError(null);
  }, [undoSnapshot]);

  // --- Homography ---
  const hasHomographyCapability = sidecar.connected && sidecar.capabilities.includes('homography');
  const canComputeHomography = hasHomographyCapability && hasVideoSource;

  const manualKeypointCount = manualKeypointOrder.length;

  const startManualHomography = useCallback(() => {
    setIsDrawing(false);
    drawStartRef.current = null;
    arrowStartRef.current = null;
    setTempShape(null);
    setSelectedAnnotationId(null);
    setTrackError(null);
    setIsManualHomographyMode(true);
    setManualKeypointImageById({});
    setManualKeypointOrder([]);
    setSelectedManualPitchKeyId(MANUAL_PITCH_KEYPOINTS[0].id);
  }, []);

  const cancelManualHomography = useCallback(() => {
    setIsManualHomographyMode(false);
    setManualKeypointImageById({});
    setManualKeypointOrder([]);
  }, []);

  const applyManualHomography = useCallback(async () => {
    const correspondences = MANUAL_PITCH_KEYPOINTS
      .filter(k => !!manualKeypointImageById[k.id])
      .map(k => ({
        pitch: { x: k.x, y: k.y },
        image: manualKeypointImageById[k.id]!,
      }));

    if (correspondences.length < 4) {
      setTrackError('Manual H needs at least 4 labeled keypoints');
      return;
    }

    const H = computeHomographyFromCorrespondences(
      correspondences.map(c => c.pitch),
      correspondences.map(c => c.image),
    );
    if (!H) {
      setTrackError('Manual H failed: could not solve from selected keypoints');
      return;
    }

    const normalized = normalizeHomography(H);
    if (!normalized) {
      setTrackError('Manual H failed: solved matrix is invalid');
      return;
    }

    const absMs = clip.startMs + currentTMsRef.current;
    const toleranceMs = Math.max(1, 1000 / Math.max(1, videoFps));
    const nextFrames = [...(homographyFrames || [])];
    const replaceIdx = nextFrames.findIndex(f => Math.abs(f.tMs - absMs) <= toleranceMs);
    const nextFrame: HomographyFrame = { tMs: absMs, matrix: normalized, method: 'manual_keypoints' };
    if (replaceIdx >= 0) {
      nextFrames[replaceIdx] = nextFrame;
    } else {
      nextFrames.push(nextFrame);
      nextFrames.sort((a, b) => a.tMs - b.tMs);
    }

    setHomographyFrames(nextFrames);
    setDrawCoordMode('pitch');
    setShowHomographyOverlay(true);
    setTrackError(null);
    setIsManualHomographyMode(false);
    setManualKeypointImageById({});
    setManualKeypointOrder([]);

    if (projectDir) {
      writeHomographyCache(projectDir, clip.startMs, clip.endMs, nextFrames).catch(() => {});
    }

    // Immediately propagate this seed across the clip so H evolves while playback advances.
    if (!hasVideoSource) {
      setTrackError('Saved seed keyframe, but dynamic tracking was skipped: no registered video source');
      return;
    }

    setIsComputingHomography(true);
    try {
      const result = await requestManualTrackHomography({
        videoRef: videoLocator.videoRef,
        videoPath: videoLocator.videoPath,
        startMs: clip.startMs,
        endMs: clip.endMs,
        seedMs: absMs,
        seedMatrix: normalized,
        fps: 5,
      }, sidecar.baseUrl);

      const trackedFrames: HomographyFrame[] = result.frames.map(f => ({
        tMs: f.tMs,
        matrix: f.matrix,
        method: f.method,
      }));

      setHomographyFrames(trackedFrames);
      const usableCount = trackedFrames.filter(f => f.method !== 'failed').length;
      const dynamicCount = trackedFrames.filter(
        f => f.method !== 'failed' && f.method !== 'manual_held' && f.method !== 'manual_keypoints',
      ).length;
      if (usableCount > 0) {
        setDrawCoordMode('pitch');
        setTrackError(
          dynamicCount > 0
            ? null
            : 'Manual tracking completed but produced mostly held/static homographies; try a seed frame with clearer line keypoints',
        );
      } else {
        setDrawCoordMode('image');
        setTrackError('Manual seed tracking finished but no usable frames were found');
      }

      if (projectDir) {
        writeHomographyCache(projectDir, clip.startMs, clip.endMs, trackedFrames).catch(() => {});
      }
    } catch (e: any) {
      setTrackError(`Saved seed keyframe, but tracking failed: ${e?.message || 'unknown error'}`);
    } finally {
      setIsComputingHomography(false);
    }
  }, [
    manualKeypointImageById,
    clip.startMs,
    clip.endMs,
    projectDir,
    videoFps,
    homographyFrames,
    hasVideoSource,
    videoLocator,
    sidecar.baseUrl,
  ]);

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
      setIsManualHomographyMode(false);
      setManualKeypointImageById({});
      setManualKeypointOrder([]);

      const usableCount = frames.filter(f => f.method !== 'failed').length;
      if (usableCount > 0) {
        setDrawCoordMode('pitch');
        setTrackError(null);
      } else {
        setDrawCoordMode('image');
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
    if (!homographyFrames || homographyFrames.length === 0) return null;
    const absMs = clip.startMs + currentTMs;
    const usable = homographyFrames.filter(isUsableHomographyFrame);
    if (usable.length === 0) return null;

    let best = usable[0];
    let bestDiff = Math.abs(best.tMs - absMs);
    for (const f of usable) {
      const diff = Math.abs(f.tMs - absMs);
      if (diff < bestDiff) {
        best = f;
        bestDiff = diff;
      }
    }
    return normalizeHomography(best.matrix) || best.matrix;
  }, [homographyFrames, clip.startMs, currentTMs]);

  const currentHomographyInv = useMemo(
    () => (currentHomography ? invert3(currentHomography) : null),
    [currentHomography],
  );

  useEffect(() => {
    currentHomographyInvRef.current = currentHomographyInv;
  }, [currentHomographyInv]);

  const handleTrackHomographyFromSeed = useCallback(async () => {
    if (!hasVideoSource) {
      setTrackError('Tracking unavailable: no registered video source');
      return;
    }
    if (!currentHomography) {
      setTrackError('Manual seed homography is required at the current frame');
      return;
    }

    setIsComputingHomography(true);
    try {
      const result = await requestManualTrackHomography({
        videoRef: videoLocator.videoRef,
        videoPath: videoLocator.videoPath,
        startMs: clip.startMs,
        endMs: clip.endMs,
        seedMs: clip.startMs + currentTMs,
        seedMatrix: currentHomography,
        fps: 5,
      }, sidecar.baseUrl);

      const frames: HomographyFrame[] = result.frames.map(f => ({
        tMs: f.tMs,
        matrix: f.matrix,
        method: f.method,
      }));
      setHomographyFrames(frames);
      setIsManualHomographyMode(false);
      setManualKeypointImageById({});
      setManualKeypointOrder([]);

      const usableCount = frames.filter(f => f.method !== 'failed').length;
      const dynamicCount = frames.filter(
        f => f.method !== 'failed' && f.method !== 'manual_held' && f.method !== 'manual_keypoints',
      ).length;
      if (usableCount > 0) {
        setDrawCoordMode('pitch');
        setTrackError(
          dynamicCount > 0
            ? null
            : 'Tracking completed but produced mostly held/static homographies; try a seed frame with clearer line keypoints',
        );
        setShowHomographyOverlay(true);
      } else {
        setDrawCoordMode('image');
        setTrackError('Manual seed tracking finished but no usable frames were found');
      }

      if (projectDir) {
        writeHomographyCache(projectDir, clip.startMs, clip.endMs, frames).catch(() => {});
      }
    } catch (e: any) {
      setTrackError(e?.message || 'Manual seed homography tracking failed');
    } finally {
      setIsComputingHomography(false);
    }
  }, [hasVideoSource, currentHomography, videoLocator, clip.startMs, clip.endMs, currentTMs, sidecar.baseUrl, projectDir]);

  const homographyOverlayLines = useMemo(() => {
    if (!showHomographyOverlay || !currentHomography) return [] as { points: number[]; dashed: boolean }[];

    const H = currentHomography;
    const MIN = 3;
    const MAX = 317;
    const CENTER = (MIN + MAX) / 2;
    const CIRCLE_R = 36;
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
    addSegment(MIN, MIN, MAX, MIN, false);
    addSegment(MAX, MIN, MAX, MAX, false);
    addSegment(MAX, MAX, MIN, MAX, false);
    addSegment(MIN, MAX, MIN, MIN, false);

    // Midline
    addSegment(CENTER, MIN, CENTER, MAX, false);

    // Light internal guide grid
    const splits = [0.25, 0.5, 0.75];
    for (const t of splits) {
      const x = MIN + (MAX - MIN) * t;
      const y = MIN + (MAX - MIN) * t;
      addSegment(x, MIN, x, MAX, true, 24);
      addSegment(MIN, y, MAX, y, true, 24);
    }

    // Center circle (approx)
    const circlePts: number[] = [];
    const circleSteps = 64;
    for (let i = 0; i <= circleSteps; i++) {
      const a = (i / circleSteps) * Math.PI * 2;
      const u = CENTER + CIRCLE_R * Math.cos(a);
      const v = CENTER + CIRCLE_R * Math.sin(a);
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
      if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedAnnotation();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if (e.key === 'Escape') {
        setRetrackRangeEndMs(null);
        setSelectedAnnotationId(null);
        setIsManualHomographyMode(false);
        setManualKeypointImageById({});
        setManualKeypointOrder([]);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        // Force immediate save
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
  }, [togglePlay, stepFrame, deleteSelectedAnnotation, handleUndo, projectDir, clip, onClipUpdate, onSaveStatus]);

  // --- Interpolate annotations ---
  const interpolated = useMemo(() => {
    const results: { ann: ClipAnnotation; props: InterpolatedKeyframe }[] = [];
    for (const ann of annotations) {
      const p = interpolateKeyframes(ann.keyframes, currentTMs, ann.type, videoFps);
      if (p) results.push({ ann, props: p });
    }
    return results;
  }, [annotations, currentTMs, videoFps]);

  // --- Format time ---
  const formatTime = useCallback((ms: number) => {
    const total = Math.max(0, Math.floor(ms));
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const f = Math.floor(((total % 1000) / 1000) * videoFps);
    return `${m}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }, [videoFps]);

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
    setTempShape(null);
  }, []);

  // Clear temp state when tool changes
  useEffect(() => {
    cancelDrawing();
  }, [tool, cancelDrawing]);

  // --- Shape click → select ---
  const onShapeClick = useCallback((annId: string, e: any) => {
    if (tool !== 'select') return;
    e.cancelBubble = true;
    setSelectedAnnotationId(annId === selectedAnnotationId ? null : annId);
  }, [tool, selectedAnnotationId]);

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
      case 'arrow': {
        // Arrow rendered at x=0,y=0 — pos is pure drag delta
        const a = props as InterpolatedArrow;
        const dx = pos.x / scale;
        const dy = pos.y / scale;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        upsertKeyframe(ann.id, tMs, { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy });
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
        // Poly rendered at x=0,y=0 — pos is pure drag delta
        const p = props as InterpolatedPoly;
        const dx = pos.x / scale;
        const dy = pos.y / scale;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        const moved = p.points.map(([px, py]) => [px + dx, py + dy] as [number, number]);
        upsertKeyframe(ann.id, tMs, { points: moved });
        break;
      }
    }
  }, [tool, scale, upsertKeyframe]);

  // --- Stage mouse handlers (matching stills Editor behavior) ---

  const onStageMouseDown = useCallback((e: any) => {
    const evt = e?.evt as MouseEvent | undefined;
    // Right-click cancels drawing
    if (evt?.button === 2) {
      evt.preventDefault();
      if (isManualHomographyMode) {
        let clearId: string | null = null;
        if (manualKeypointImageById[selectedManualPitchKeyId]) {
          clearId = selectedManualPitchKeyId;
        } else if (manualKeypointOrder.length > 0) {
          clearId = manualKeypointOrder[manualKeypointOrder.length - 1];
        }
        if (!clearId) {
          setIsManualHomographyMode(false);
          setManualKeypointImageById({});
          setManualKeypointOrder([]);
          return;
        }
        setManualKeypointImageById(prev => {
          const next = { ...prev };
          delete next[clearId!];
          return next;
        });
        setManualKeypointOrder(prev => prev.filter(id => id !== clearId));
        return;
      }
      if (isDrawing || arrowStartRef.current) {
        cancelDrawing();
      } else {
        setSelectedAnnotationId(null);
      }
      return;
    }

    const p = getPointerImagePos(e);
    if (!p) return;
    const isStage = e.target === e.target.getStage();

    if (isManualHomographyMode) return;

    if (tool === 'select') {
      if (isStage) setSelectedAnnotationId(null);
      return;
    }
    // Box/Circle: start drag-draw
    if (tool === 'box' || tool === 'circle') {
      if (!isStage) return;
      setIsDrawing(true);
      drawStartRef.current = p;
    }
  }, [tool, getPointerImagePos, isDrawing, cancelDrawing, isManualHomographyMode, manualKeypointImageById, selectedManualPitchKeyId, manualKeypointOrder]);

  const onStageMouseMove = useCallback((e: any) => {
    if (isManualHomographyMode) return;
    if (!isDrawing || !drawStartRef.current) {
      // Arrow temp preview: if arrow start is set, show temp line to cursor
      if (tool === 'arrow' && arrowStartRef.current) {
        const p = getPointerImagePos(e);
        if (p) {
          const s = arrowStartRef.current;
          setTempShape({ type: 'arrow', x1: s.x, y1: s.y, x2: p.x, y2: p.y });
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
    }
  }, [isDrawing, tool, getPointerImagePos, isManualHomographyMode]);

  const onStageMouseUp = useCallback((e: any) => {
    if (isManualHomographyMode) return;
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
      }
    }
    setIsDrawing(false);
    drawStartRef.current = null;
    setTempShape(null);
  }, [isDrawing, tool, getPointerImagePos, createAnnotation, isManualHomographyMode]);

  const onStageClick = useCallback((e: any) => {
    const p = getPointerImagePos(e);
    if (!p) return;
    const isStage = e.target === e.target.getStage();

    if (isManualHomographyMode) {
      if (!isStage) return;
      const keyId = selectedManualPitchKeyId;
      if (!keyId) return;
      setManualKeypointImageById(prev => ({ ...prev, [keyId]: p }));
      setManualKeypointOrder(prev => (prev.includes(keyId) ? prev : [...prev, keyId]));
      const assignedIds = new Set<string>([...Object.keys(manualKeypointImageById), keyId]);
      const nextUnassigned = MANUAL_PITCH_KEYPOINTS.find(k => !assignedIds.has(k.id));
      if (nextUnassigned) setSelectedManualPitchKeyId(nextUnassigned.id);
      return;
    }

    // Arrow: click-click pattern
    if (tool === 'arrow') {
      if (!isStage) return;
      if (!arrowStartRef.current) {
        // First click: set start
        arrowStartRef.current = p;
      } else {
        // Second click: finalize
        const s = arrowStartRef.current;
        if (Math.hypot(p.x - s.x, p.y - s.y) >= 3) {
          createAnnotation('arrow', { x1: s.x, y1: s.y, x2: p.x, y2: p.y });
        }
        arrowStartRef.current = null;
        setTempShape(null);
      }
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
      const Hinv = currentHomographyInvRef.current;
      const usePitchCoords = drawCoordMode === 'pitch' && !!Hinv;
      const tp = usePitchCoords && Hinv ? applyHomographyInv(Hinv, p.x, p.y) : { u: p.x, v: p.y };
      const ann: ClipAnnotation = {
        id: makeId(),
        type: 'text',
        coordMode: usePitchCoords ? 'pitch' : 'image',
        source: 'manual',
        text: 'Text',
        style: { stroke: defaultColor, strokeWidth: defaultStrokeWidth, fontSize: 48 },
        keyframes: [{ tMs: currentTMsRef.current, x: tp.u, y: tp.v } as ClipKeyframe],
      };
      setAnnotations(prev => [...prev, ann]);
      setSelectedAnnotationId(ann.id);
      return;
    }
  }, [tool, getPointerImagePos, createAnnotation, drawCoordMode, defaultColor, defaultStrokeWidth, isManualHomographyMode, selectedManualPitchKeyId, manualKeypointImageById]);

  // --- Render annotations as Konva shapes ---
  const isSelectMode = tool === 'select';
  const isPaused = !isPlaying;
  const canInteract = isSelectMode && isPaused;

  const renderAnnotation = useCallback((ann: ClipAnnotation, props: InterpolatedKeyframe, idx: number) => {
    const style = ann.style || {};
    const stroke = style.stroke || '#ff0000';
    const strokeWidth = style.strokeWidth || 3;
    const fillColor = style.fill && style.fill !== 'transparent'
      ? hexToRgba(style.fill, style.fillOpacity ?? 0.3)
      : 'transparent';
    const dash = dashFromStrokePattern(style.strokePattern as StrokePattern | undefined, strokeWidth);
    const isSelected = ann.id === selectedAnnotationId;
    const selStroke = isSelected ? '#ffffff' : undefined;
    const selStrokeW = isSelected ? 1 : 0;

    // --- Pitch-space rendering: transform through homography ---
    if (ann.coordMode === 'pitch' && currentHomography) {
      const H = currentHomography;
      let imgPoints: number[] = [];

      switch (props.type) {
        case 'box': {
          const b = props as InterpolatedBox;
          imgPoints = rectPlaneToImagePoints(H, b.x + b.w / 2, b.y + b.h / 2, b.w, b.h);
          break;
        }
        case 'circle': {
          const c = props as InterpolatedCircle;
          imgPoints = ellipsePlaneToImagePoints(H, c.cx, c.cy, c.rx, c.ry);
          break;
        }
        case 'highlight': {
          const h = props as InterpolatedHighlight;
          imgPoints = ellipsePlaneToImagePoints(H, h.cx, h.cy, h.radius, h.radius * 0.35);
          break;
        }
        case 'arrow': {
          const a = props as InterpolatedArrow;
          const p1 = applyHomography(H, a.x1, a.y1);
          const p2 = applyHomography(H, a.x2, a.y2);
          return (
            <KArrow
              key={ann.id}
              x={0} y={0}
              points={[p1.x * scale, p1.y * scale, p2.x * scale, p2.y * scale]}
              stroke={stroke} strokeWidth={strokeWidth} fill={stroke}
              pointerLength={10} pointerWidth={10} dash={dash}
              lineCap="round" lineJoin="round"
              listening={false} draggable={false}
              shadowColor={selStroke} shadowBlur={isSelected ? 6 : 0} shadowEnabled={isSelected}
              hitStrokeWidth={16}
            />
          );
        }
        case 'text': {
          const t = props as InterpolatedText;
          const tp = applyHomography(H, t.x, t.y);
          return (
            <KText
              key={ann.id}
              x={tp.x * scale} y={tp.y * scale}
              text={ann.text || ''} fontSize={(style.fontSize || 48) * scale}
              fontFamily={style.fontFamily || 'Inter, system-ui, sans-serif'}
              fill={stroke} listening={false} draggable={false}
              shadowColor={selStroke} shadowBlur={isSelected ? 6 : 0} shadowEnabled={isSelected}
            />
          );
        }
        case 'poly': {
          const p = props as InterpolatedPoly;
          imgPoints = p.points.flatMap(([u, v]) => {
            const pt = applyHomography(H, u, v);
            return [pt.x, pt.y];
          });
          break;
        }
        default:
          return null;
      }

      // Render transformed polygon
      if (imgPoints.length >= 4) {
        const scaled = imgPoints.map((v, i) => v * scale);
        return (
          <KLine
            key={ann.id}
            x={0} y={0}
            points={scaled}
            stroke={stroke} strokeWidth={strokeWidth} fill={fillColor}
            closed={true} dash={dash} lineCap="round" lineJoin="round"
            listening={canInteract} draggable={false}
            onClick={(e: any) => onShapeClick(ann.id, e)}
            shadowColor={selStroke} shadowBlur={isSelected ? 6 : 0} shadowEnabled={isSelected}
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
            strokeWidth={strokeWidth}
            fill={fillColor}
            dash={dash}
            listening={canInteract}
            draggable={canInteract}
            onClick={(e: any) => onShapeClick(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            shadowColor={selStroke}
            shadowBlur={isSelected ? 6 : 0}
            shadowEnabled={isSelected}
            hitStrokeWidth={12}
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
            strokeWidth={strokeWidth}
            fill={fillColor}
            dash={dash}
            listening={canInteract}
            draggable={canInteract}
            onClick={(e: any) => onShapeClick(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            shadowColor={selStroke}
            shadowBlur={isSelected ? 6 : 0}
            shadowEnabled={isSelected}
            hitStrokeWidth={12}
          />
        );
      }
      case 'arrow': {
        const a = props as InterpolatedArrow;
        return (
          <KArrow
            key={ann.id}
            x={0}
            y={0}
            points={[a.x1 * scale, a.y1 * scale, a.x2 * scale, a.y2 * scale]}
            stroke={stroke}
            strokeWidth={strokeWidth}
            fill={stroke}
            pointerLength={10}
            pointerWidth={10}
            dash={dash}
            lineCap="round"
            lineJoin="round"
            listening={canInteract}
            draggable={canInteract}
            onClick={(e: any) => onShapeClick(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            shadowColor={selStroke}
            shadowBlur={isSelected ? 6 : 0}
            shadowEnabled={isSelected}
            hitStrokeWidth={16}
          />
        );
      }
      case 'text': {
        const t = props as InterpolatedText;
        const fontSize = (style.fontSize || 48) * scale;
        const fontFamily = style.fontFamily || 'Inter, system-ui, sans-serif';
        const highlight = style.textHighlight ?? false;
        const textColor = stroke;
        const outlineColor = contrastStrokeForHex(stroke);
        return (
          <KText
            key={ann.id}
            x={t.x * scale}
            y={t.y * scale}
            text={ann.text || ''}
            fontSize={fontSize}
            fontFamily={fontFamily}
            fill={textColor}
            strokeEnabled={highlight}
            stroke={highlight ? outlineColor : undefined}
            strokeWidth={highlight ? 1 : 0}
            listening={canInteract}
            draggable={canInteract}
            onClick={(e: any) => onShapeClick(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            shadowColor={selStroke}
            shadowBlur={isSelected ? 6 : 0}
            shadowEnabled={isSelected}
            hitStrokeWidth={12}
          />
        );
      }
      case 'poly': {
        const p = props as InterpolatedPoly;
        const flatPoints = p.points.flatMap(([x, y]) => [x * scale, y * scale]);
        return (
          <KLine
            key={ann.id}
            x={0}
            y={0}
            points={flatPoints}
            stroke={stroke}
            strokeWidth={strokeWidth}
            fill={fillColor}
            closed={true}
            dash={dash}
            lineCap="round"
            lineJoin="round"
            listening={canInteract}
            draggable={canInteract}
            onClick={(e: any) => onShapeClick(ann.id, e)}
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
            strokeWidth={strokeWidth}
            fill={fillColor}
            dash={dash}
            listening={canInteract}
            draggable={canInteract}
            onClick={(e: any) => onShapeClick(ann.id, e)}
            onDragEnd={(e: any) => onShapeDragEnd(ann, props, e)}
            shadowColor={selStroke}
            shadowBlur={isSelected ? 6 : 0}
            shadowEnabled={isSelected}
            hitStrokeWidth={12}
          />
        );
      }
      default:
        return null;
    }
  }, [scale, canInteract, selectedAnnotationId, currentHomography, onShapeClick, onShapeDragEnd]);

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
      .map(ann => ({ ann, props: interpolateKeyframes(ann.keyframes, tMs, ann.type) }))
      .filter(({ props }) => props !== null) as { ann: ClipAnnotation; props: InterpolatedKeyframe }[];

    for (const { ann, props } of interps) {
      const style = ann.style || {};
      const stroke = style.stroke || '#ff0000';
      const strokeWidth = style.strokeWidth || 3;
      const fillColor = style.fill && style.fill !== 'transparent'
        ? hexToRgba(style.fill, style.fillOpacity ?? 0.3)
        : 'transparent';

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
        case 'arrow': {
          const a = props as InterpolatedArrow;
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
        case 'text': {
          const t = props as InterpolatedText;
          const fontSize = style.fontSize || 48;
          const fontFamily = style.fontFamily || 'Inter, system-ui, sans-serif';
          ctx.font = `${fontSize}px ${fontFamily}`;
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
          const p = props as InterpolatedPoly;
          if (p.points.length < 2) break;
          ctx.beginPath();
          ctx.moveTo(p.points[0][0], p.points[0][1]);
          for (let j = 1; j < p.points.length; j++) {
            ctx.lineTo(p.points[j][0], p.points[j][1]);
          }
          ctx.closePath();
          if (fillColor !== 'transparent') ctx.fill();
          ctx.stroke();
          break;
        }
      }
    }
  }, [annotations]);

  // --- Progress bar ---
  const progressFrac = clipDurationMs > 0 ? currentTMs / clipDurationMs : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Video + Konva overlay */}
      <div ref={hostRef} className="flex-1 min-h-0 relative bg-black">
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={onLoadedMetadata}
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
        {videoReady && (
          <Stage
            ref={stageRef}
            width={stageW}
            height={stageH}
            style={{
              position: 'absolute',
              left: offsetX,
              top: offsetY,
              pointerEvents: 'auto',
            }}
            onMouseDown={onStageMouseDown}
            onMouseMove={onStageMouseMove}
            onMouseUp={onStageMouseUp}
            onClick={onStageClick}
            onContextMenu={(e: any) => e.evt?.preventDefault()}
          >
            <Layer>
              {isManualHomographyMode && MANUAL_PITCH_KEYPOINTS.filter(k => !!manualKeypointImageById[k.id]).map((k) => {
                const pt = manualKeypointImageById[k.id]!;
                return (
                <React.Fragment key={`manual-h-pt-${k.id}`}>
                  <KCircle
                    x={pt.x * scale}
                    y={pt.y * scale}
                    radius={6}
                    fill={k.id === selectedManualPitchKeyId ? "#f97316" : "#f59e0b"}
                    stroke="#111827"
                    strokeWidth={1.5}
                    listening={false}
                  />
                  <KText
                    x={pt.x * scale + 8}
                    y={pt.y * scale - 10}
                    text={k.label}
                    fontSize={14}
                    fill="#f59e0b"
                    listening={false}
                  />
                </React.Fragment>
              );})}
              {interpolated.map(({ ann, props }, i) => renderAnnotation(ann, props, i))}
              {/* Temp shape preview during drawing */}
              {tempShape?.type === 'box' && (
                <KRect
                  x={tempShape.x * scale}
                  y={tempShape.y * scale}
                  width={tempShape.w * scale}
                  height={tempShape.h * scale}
                  stroke={defaultColor}
                  strokeWidth={defaultStrokeWidth}
                  dash={[6, 3]}
                  listening={false}
                />
              )}
              {tempShape?.type === 'circle' && (
                <KEllipse
                  x={tempShape.cx * scale}
                  y={tempShape.cy * scale}
                  radiusX={tempShape.rx * scale}
                  radiusY={tempShape.ry * scale}
                  stroke={defaultColor}
                  strokeWidth={defaultStrokeWidth}
                  dash={[6, 3]}
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
                  strokeWidth={defaultStrokeWidth}
                  fill={defaultColor}
                  pointerLength={10}
                  pointerWidth={10}
                  dash={[6, 3]}
                  listening={false}
                />
              )}
            </Layer>
            {showHomographyOverlay && homographyOverlayLines.length > 0 && (
              <Layer listening={false}>
                {homographyOverlayLines.map((line, idx) => (
                  <KLine
                    key={`homography-overlay-${idx}`}
                    points={line.points}
                    stroke="#22d3ee"
                    strokeWidth={1.5}
                    dash={line.dashed ? [6, 4] : undefined}
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
          </Stage>
        )}
      </div>

      {/* Timeline strip */}
      <TimelineStrip
        durationMs={clipDurationMs}
        currentTMs={currentTMs}
        annotations={annotations}
        selectedAnnotationId={selectedAnnotationId}
        retrackRangeEndMs={retrackRangeEndMs}
        onSeek={seekToMs}
        onSelectAnnotation={setSelectedAnnotationId}
        onSeekToKeyframe={(annId, tMs) => {
          setSelectedAnnotationId(annId);
          seekToMs(tMs);
        }}
        onShiftClick={setRetrackRangeEndMs}
      />

      {/* Transport bar */}
      <div className="shrink-0 bg-surface border-t border-border">
        {/* Controls */}
        <div className="flex items-center gap-2 px-3 py-1.5">
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

          {/* Re-track range */}
          {showRetrackButton && retrackRangeEndMs != null && !isPlaying && (
            <button
              onClick={handleRetrackRange}
              disabled={isTracking}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Re-track within the selected range (Shift-click timeline to set range)"
            >
              Re-track range
            </button>
          )}

          {/* Undo re-track */}
          {undoSnapshot && (
            <button
              onClick={handleUndo}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer"
              title="Undo last re-track (Ctrl+Z)"
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
          <button
            onClick={isManualHomographyMode ? cancelManualHomography : startManualHomography}
            disabled={isPlaying}
            className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title={isManualHomographyMode
              ? 'Select a pitch keypoint label, then click its image location. Right-click clears selected keypoint.'
              : 'Manual H keyframe from labeled pitch keypoints at current frame'}
          >
            {isManualHomographyMode
              ? `Cancel Manual H (${manualKeypointCount} kp)`
              : 'Manual H KF'}
          </button>
          {isManualHomographyMode && (
            <div className="flex items-center gap-1">
              {MANUAL_PITCH_KEYPOINTS.map(k => (
                <button
                  key={`kp-btn-${k.id}`}
                  onClick={() => setSelectedManualPitchKeyId(k.id)}
                  className="px-2 py-0.5 text-xs border-0 cursor-pointer"
                  title={`${k.label}: ${k.tooltip}${manualKeypointImageById[k.id] ? ' (set)' : ''}`}
                  style={{
                    opacity: selectedManualPitchKeyId === k.id ? 1 : 0.7,
                    color: manualKeypointImageById[k.id] ? '#34d399' : undefined,
                  }}
                >
                  {k.label}
                </button>
              ))}
            </div>
          )}
          {isManualHomographyMode && (
            <button
              onClick={applyManualHomography}
              disabled={manualKeypointCount < 4}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={manualKeypointCount >= 4
                ? 'Save manual homography keyframe from labeled keypoints'
                : 'Set at least 4 keypoints first'}
            >
              Save H KF
            </button>
          )}
          {homographyFrames && (
            <button
              onClick={handleTrackHomographyFromSeed}
              disabled={!hasVideoSource || !currentHomography || isComputingHomography}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={currentHomography
                ? 'Track homography from current seed using keypoints + line color gating'
                : 'No seed homography at current frame'}
            >
              {isComputingHomography ? 'Tracking H...' : 'Track H'}
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
              disabled={!currentHomographyInv}
              className="px-3 py-0.5 text-sm border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={currentHomographyInv
                ? `Drawing in ${drawCoordMode === 'pitch' ? 'pitch/3D' : 'image/2D'} coordinates`
                : 'No usable homography at current frame'}
            >
              {drawCoordMode === 'pitch' ? 'Draw: 3D' : 'Draw: 2D'}
            </button>
          )}

          {/* Occlusion toggle */}
          {canSegment && (
            <button
              onClick={() => setOcclusionEnabled(prev => !prev)}
              className={`px-3 py-0.5 text-sm border-0 cursor-pointer ${occlusionEnabled ? 'text-green-400' : ''}`}
              title={occlusionEnabled
                ? 'Disable foreground occlusion (people rendered above annotations)'
                : 'Enable foreground occlusion (people rendered above annotations)'}
            >
              {occlusionEnabled ? 'Occ ✓' : 'Occ'}
            </button>
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
