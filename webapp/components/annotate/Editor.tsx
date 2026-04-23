"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect as KRect, Circle as KCircle, Arrow as KArrow, Text as KText, Image as KImage, Transformer, Line as KLine, Ellipse as KEllipse, Shape as KShape } from "react-konva";
import { useProject } from "../../lib/state/ProjectContext";
import { writeAnnotationDocument } from "../../lib/fs/annotationStorage";
import type { AnnotationsV1 } from "../../lib/export/d7Render";
import { computePersonForegroundCutout } from "../../lib/segmentation/personSegmentation";
import { computeEdgeForegroundCutout } from "../../lib/segmentation/edgeSegmentation";
import { makeId, hexToRgba, contrastStrokeForHex, dashFromStrokePattern } from "../../lib/annotate/shapeRendering";
import type { StrokePattern } from "../../lib/annotate/shapeRendering";
import { consumeManualSaveTick } from "./saveTick";
import {
  buildDefaultLobControlPoint,
  buildShadowSectorPoints,
  DEFAULT_SHADOW_RADIUS,
  DEFAULT_SHADOW_SPREAD_DEG,
  getBoundsForFlatPoints,
  radiansToDegrees,
} from "../../lib/annotate/tacticalGeometry";
import {
  invert3, computeHomographyFromUnitSquareToQuad, applyHomography, applyHomographyInv,
  rectPlaneToImagePoints, ellipsePlaneToImagePoints, circlePlaneToImagePoints,
  ellipsePlaneToImagePointsRot, normalizeHalfPi, principalAxisAngle,
  findPlaneRotationForHorizontal, computeLocalJacobian,
  thetaForHorizontalUsingJacobian, thetaForHorizontal,
} from "../../lib/annotate/homography";
import type { PerspectiveQuadPoint } from "../../lib/annotate/pitchCalibration";

export type Tool = 'select' | 'box' | 'circle' | 'shadow' | 'arrow' | 'lob' | 'text' | 'poly' | 'highlight' | 'calibrate';

export type { StrokePattern } from "../../lib/annotate/shapeRendering";

export type Shape = {
  id: string;
  type: 'box' | 'circle' | 'shadow' | 'arrow' | 'lob' | 'text' | 'poly' | 'highlight';
  x: number;
  y: number;
  rotation?: number;
  w?: number;
  h?: number;
  r?: number;
  spreadDeg?: number;
  rx?: number;
  ry?: number;
  points?: number[]; // [x1,y1,x2,y2,...]
  vertexRefs?: (string | null)[];
  text?: string;
  closed?: boolean;
  plane?: { cx: number; cy: number; w?: number; h?: number; r?: number; rx?: number; ry?: number };
  style?: {
    stroke?: string;
    fill?: string;
    fillOpacity?: number;
    strokeWidth?: number;
    strokePattern?: StrokePattern;
    fontSize?: number;
    fontFamily?: string;
    textHighlight?: boolean;
  };
};

function useImage(url: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImage(null); return; }
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    img.src = url;
    return () => { setImage(null); };
  }, [url]);
  return image;
}

async function openBackupDB(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open('annotate-backup-db', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains('ann-backup')) db.deleteObjectStore('ann-backup');
      db.createObjectStore('ann-backup', { keyPath: 'docKey' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

async function readBackup(docKey: string): Promise<any | null> {
  try {
    const db = await openBackupDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('ann-backup', 'readonly');
      const req = tx.objectStore('ann-backup').get(docKey);
      req.onsuccess = () => { const v = req.result; db.close(); resolve(v || null); };
      req.onerror = () => { const e = req.error; db.close(); reject(e); };
    });
  } catch {
    return null;
  }
}

async function writeBackup(entry: any): Promise<void> {
  try {
    const db = await openBackupDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('ann-backup', 'readwrite');
      tx.objectStore('ann-backup').put(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
    });
  } catch {
  }
}

export default function Editor({
  stillId,
  annotationId,
  annotationFilePath,
  annotationLabel,
  imageInfo,
  imgUrl,
  stageScale,
  stageOffset,
  tool,
  defaultStrokePattern,
  defaultColor,
  defaultStrokeWidth,
  defaultFill,
  defaultFillOpacity,
  defaultFontSize,
  defaultTextHighlight,
  enableForegroundOcclusion,
  occlusionMethod,
  onRequestToolChange,
  saveTick,
  onSaveStatus,
  autoPerspectiveQuad,
  autoPerspectiveTick,
  backgroundVideoElement,
  backgroundFrameTick,
  annotationsLocked,
}: {
  stillId: string;
  annotationId: string;
  annotationFilePath: string;
  annotationLabel?: string;
  imageInfo: { file: string; width: number; height: number };
  imgUrl: string | null;
  stageScale: number;
  stageOffset: { x: number; y: number };
  tool: Tool;
  defaultStrokePattern?: StrokePattern;
  defaultColor?: string;
  defaultStrokeWidth?: number;
  defaultFill?: string;
  defaultFillOpacity?: number;
  defaultFontSize?: number;
  defaultTextHighlight?: boolean;
  enableForegroundOcclusion?: boolean;
  occlusionMethod?: 'edge' | 'ml';
  onRequestToolChange?: (t: Tool) => void;
  saveTick?: number;
  onSaveStatus?: (s: { state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string }) => void;
  autoPerspectiveQuad?: PerspectiveQuadPoint[] | null;
  autoPerspectiveTick?: number;
  backgroundVideoElement?: HTMLVideoElement | null;
  backgroundFrameTick?: number;
  annotationsLocked?: boolean;
}) {
  const { projectDir } = useProject();
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const shadowAnchorRef = useRef<string | null>(null);
  const arrowTempRef = useRef<{ start: { x: number; y: number; refId?: string | null } | null } | null>(null);
  const lobTempRef = useRef<{ start: { x: number; y: number; refId?: string | null } | null } | null>(null);
  const clickHistoryRef = useRef<{ t: number; x: number; y: number }[]>([]);
  const suppressNextClickRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const pastRef = useRef<Shape[][]>([]);
  const futureRef = useRef<Shape[][]>([]);
  const lastShapesRef = useRef<Shape[] | null>(null);
  const lastFinalRef = useRef<Shape[] | null>(null);
  const historyActionRef = useRef<null | 'undo' | 'redo'>(null);
  const polyTempRef = useRef<{ points: { x: number; y: number; refId?: string | null }[] } | null>(null);
  const polyNearIndexRef = useRef<number>(-1);
  const [isSelecting, setIsSelecting] = useState(false);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selCandidateRef = useRef<{ x: number; y: number } | null>(null);
  const selCandidateEmptyRef = useRef<boolean>(false);
  const [perspective, setPerspective] = useState<{ quad: { x: number; y: number }[] } | null>(null);
  const perspectiveRef = useRef<{ quad: { x: number; y: number }[] } | null>(null);
  const lastNonNullPerspectiveRef = useRef<{ quad: { x: number; y: number }[] } | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibPoints, setCalibPoints] = useState<{ x: number; y: number }[]>([]);
  const [calibHover, setCalibHover] = useState<{ x: number; y: number } | null>(null);
  const [hlFrac, setHlFrac] = useState<{ rx: number; ry: number } | null>(null);
  const [boxFrac, setBoxFrac] = useState<{ w: number; h: number } | null>(null);
  const [circFrac, setCircFrac] = useState<{ rx: number; ry: number } | null>(null);
  const [ioError, setIoError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [backupOffer, setBackupOffer] = useState<any | null>(null);
  const lastSavedHashRef = useRef<string | null>(null);
  const lastManualTickRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);
  const loadGenRef = useRef(0);
  const shapesRef = useRef<Shape[]>([]);
  const lastAutoPerspectiveTickRef = useRef<number>(0);

  const [textEdit, setTextEdit] = useState<null | { id: string; value: string; orig: string; isNew: boolean }>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const bgImage = useImage(imgUrl);
  const backgroundMedia = backgroundVideoElement || bgImage;
  const showAnnotations = !annotationsLocked;
  const defaultAnnColor = defaultColor || '#000000';
  const defStrokeW = defaultStrokeWidth ?? 6;
  const defFill = defaultFill || defaultAnnColor;
  const defFillOp = defaultFillOpacity ?? 0.3;
  const defFontSz = defaultFontSize ?? 48;
  const defTextHl = defaultTextHighlight ?? false;
  const backupDocKey = `${stillId}::${annotationId}`;

  const [foregroundCutout, setForegroundCutout] = useState<HTMLCanvasElement | null>(null);
  const foregroundGenRef = useRef(0);

  const effectiveOcclusionMethod: 'edge' | 'ml' = occlusionMethod || 'edge';

  function clearPerspectiveState() {
    perspectiveRef.current = null;
    lastNonNullPerspectiveRef.current = null;
    setPerspective(null);
    setCalibrating(false);
    setCalibPoints([]);
    setCalibHover(null);
    setHlFrac(null);
    setBoxFrac(null);
    setCircFrac(null);
  }

  function applyPerspectiveQuadState(quad: PerspectiveQuadPoint[]) {
    const nextPerspective = { quad };
    perspectiveRef.current = nextPerspective;
    lastNonNullPerspectiveRef.current = nextPerspective;
    setPerspective(nextPerspective);
    setCalibrating(false);
    setCalibPoints([]);
    setCalibHover(null);
    const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const leftMid = lerpPt(quad[0], quad[3], 0.5);
    const rightMid = lerpPt(quad[1], quad[2], 0.5);
    const widthMid = Math.max(1e-6, dist(leftMid, rightMid));
    const topMid = lerpPt(quad[0], quad[1], 0.5);
    const botMid = lerpPt(quad[3], quad[2], 0.5);
    const heightMid = Math.max(1e-6, dist(topMid, botMid));
    setHlFrac({ rx: 15 / widthMid, ry: 12 / heightMid });
    setBoxFrac({ w: 80 / widthMid, h: 48 / heightMid });
    setCircFrac({ rx: 24 / widthMid, ry: 16 / heightMid });
  }

  useEffect(() => {
    if (!enableForegroundOcclusion) {
      foregroundGenRef.current++;
      setForegroundCutout(null);
      return;
    }

    if (!bgImage || !imageInfo?.width || !imageInfo?.height) {
      setForegroundCutout(null);
      return;
    }
    const token = ++foregroundGenRef.current;
    setForegroundCutout(null);

    (async () => {
      const cutoutMaxDim = Math.min(4096, Math.max(imageInfo.width, imageInfo.height));
      const res = effectiveOcclusionMethod === 'edge'
        ? await computeEdgeForegroundCutout(bgImage, imageInfo.width, imageInfo.height, {
          maskMaxDim: 720,
          cutoutMaxDim,
          edgePercentile: 0.92,
          dilateRadius: 0,
          closeIterations: 0,
          fillHoles: true,
          maxComponentAreaFrac: 0.25,
        })
        : await computePersonForegroundCutout(bgImage, imageInfo.width, imageInfo.height, {
          maskMaxDim: 720,
          cutoutMaxDim,
          internalResolution: 'medium',
          segmentationThreshold: 0.7,
          foregroundThresholdProbability: 0.5,
        });
      if (token !== foregroundGenRef.current) return;

      if (!res) {
        setForegroundCutout(null);
        return;
      }

      if (res.ratio > 0.85 || res.ratio < 0.0001) {
        setForegroundCutout(null);
        return;
      }

      setForegroundCutout(res.cutout);
    })();
  }, [bgImage, effectiveOcclusionMethod, enableForegroundOcclusion, imageInfo?.height, imageInfo?.width]);

  // Container sizing (fills parent)
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 300, h: 200 });
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onResize = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(0, Math.floor(rect.width)), h: Math.max(0, Math.floor(rect.height)) });
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Attach transformer to selected node
  useEffect(() => {
    const tr = transformerRef.current;
    const node = selectedNodeRef.current;
    if (tr) {
      if (node) {
        tr.nodes([node]);
      } else {
        tr.nodes([]);
      }
      tr.getLayer()?.batchDraw();
    }
  }, [selectedId, selectedIds, shapes]);

  useEffect(() => {
    if (!backgroundVideoElement) return;
    stageRef.current?.batchDraw();
  }, [backgroundVideoElement, backgroundFrameTick]);

  // Load annotations JSON
  useEffect(() => {
    const token = ++loadGenRef.current;
    lastNonNullPerspectiveRef.current = null;
    (async () => {
      if (!projectDir) return;
      hasLoadedRef.current = false;
      try {
        const anyHandle: any = projectDir as any;
        const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
        if (q !== 'granted') { setIoError('Folder permission not granted'); return; }
        let text = '';
        let file: File | null = null;
        try {
          const parts = annotationFilePath.split('/').filter(Boolean);
          let cur: FileSystemDirectoryHandle = projectDir;
          for (let i = 0; i < parts.length - 1; i += 1) {
            cur = await cur.getDirectoryHandle(parts[i], { create: false });
          }
          const fh = await cur.getFileHandle(parts[parts.length - 1], { create: false });
          file = await fh.getFile();
          text = await file.text();
        } catch (e: any) {
          const name = (e && (e.name || e?.toString?.())) ? String(e.name || '') : '';
          if (name === 'NotFoundError') {
            text = '';
            file = null;
          } else {
            throw e;
          }
        }
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }

        if (text && !json) {
          setIoError('Invalid annotations JSON. Refusing to overwrite.');
          return;
        }
        if (json?.schema && json.schema !== 'annotations.v1') {
          setIoError(`Unsupported annotations schema: ${String(json.schema)}. Refusing to overwrite.`);
          return;
        }

        if (token !== loadGenRef.current) return;

        const loaded: Shape[] = Array.isArray(json?.shapes) ? json.shapes.filter((s: any) => !s?._temp && !(typeof s?.id === 'string' && s.id.startsWith('_temp_'))) : [];
        const normalized: Shape[] = loaded.map((s) => {
          const stroke = s.style?.stroke || defaultAnnColor;
          const strokeWidth = s.style?.strokeWidth ?? (s.type === 'text' ? 1 : 6);
          const needFill = (s.type === 'box') || (s.type === 'circle') || (s.type === 'highlight') || (s.type === 'shadow') || (s.type === 'poly' && s.closed);
          const fill = needFill ? (s.style?.fill && s.style.fill !== 'transparent' ? s.style.fill : stroke) : s.style?.fill;
          const fillOpacity = needFill ? (s.style?.fillOpacity ?? 0.3) : s.style?.fillOpacity;
          return { ...s, style: { ...s.style, stroke, strokeWidth, fill, fillOpacity } } as Shape;
        });
        shapesRef.current = normalized;
        setShapes(normalized);
        lastFinalRef.current = normalized;

        const quad = Array.isArray(json?.perspective?.quad) ? json.perspective.quad as { x: number; y: number }[] : null;
        const baselineBody: AnnotationsV1 = {
          schema: 'annotations.v1',
          annotationId,
          label: typeof json?.label === 'string' ? json.label : annotationLabel,
          stillId,
          image: { file: imageInfo.file, width: imageInfo.width, height: imageInfo.height },
          shapes: normalized,
          perspective: (quad && quad.length === 4) ? { quad } : undefined,
        };
        lastSavedHashRef.current = hashString(JSON.stringify(baselineBody, null, 2));
        setIoError(null);
        if (token !== loadGenRef.current) return;

        try {
          const bk = await readBackup(backupDocKey);
          if (bk && bk.contentHash && bk.data) {
            const diskHash = hashString(text);
            const fileTs = (file && typeof file.lastModified === 'number') ? file.lastModified : 0;
            const bkTs = Date.parse(bk.updatedAt || '') || 0;
            if (bk.contentHash !== diskHash && bkTs > fileTs) {
              setBackupOffer(bk);
            }
          }
        } catch {}

        if (token !== loadGenRef.current) return;
        if (quad && quad.length === 4) {
          applyPerspectiveQuadState(quad);
        } else {
          // No perspective yet; defaults will be flat and calibration is opt-in via tool.
          clearPerspectiveState();
        }

        if (token !== loadGenRef.current) return;
        hasLoadedRef.current = true;
      } catch (e) {
        if (token !== loadGenRef.current) return;
        setIoError((e as any)?.message || String(e));
      }
    })();
  }, [projectDir, stillId, annotationId, annotationFilePath, annotationLabel, backupDocKey, defaultAnnColor, imageInfo.file, imageInfo.width, imageInfo.height]);

  useEffect(() => {
    perspectiveRef.current = perspective;
    if (perspective && perspective.quad && perspective.quad.length === 4) {
      lastNonNullPerspectiveRef.current = perspective;
    }
  }, [perspective]);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  // Enter/exit calibration mode when tool changes
  useEffect(() => {
    const active = tool === 'calibrate';
    setCalibrating(active);
    setCalibPoints([]);
    setCalibHover(null);
  }, [tool]);

  // Homography from unit square to calibrated quad (and its inverse)
  const homography = useMemo(() => {
    if (!perspective?.quad || perspective.quad.length !== 4) return null as null | { H: number[]; Hinv: number[] };
    const { H, Hinv } = computeHomographyFromUnitSquareToQuad(perspective.quad);
    return { H, Hinv };
  }, [perspective]);

  const shapesById = useMemo(() => {
    const m = new Map<string, Shape>();
    for (const s of shapes) m.set(s.id, s);
    return m;
  }, [shapes]);

  const getHighlightCenter = useCallback((s: Shape): { x: number; y: number } => {
    if (homography && s.plane && s.type === 'highlight') return applyHomography(homography.H, s.plane.cx, s.plane.cy);
    return { x: s.x || 0, y: s.y || 0 };
  }, [homography]);

  const resolveLobPoints = useCallback((s: Shape) => {
    const base = s.points || [];
    const ox = s.x || 0;
    const oy = s.y || 0;
    let start = { x: (base[0] ?? 0) + ox, y: (base[1] ?? 0) + oy };
    const control = { x: (base[2] ?? 0) + ox, y: (base[3] ?? 0) + oy };
    let end = { x: (base[4] ?? 0) + ox, y: (base[5] ?? 0) + oy };
    const refs = Array.isArray(s.vertexRefs) ? s.vertexRefs : [];
    if (refs[0]) {
      const h = shapesById.get(refs[0]);
      if (h && h.type === 'highlight') start = getHighlightCenter(h);
    }
    if (refs[1]) {
      const h = shapesById.get(refs[1]);
      if (h && h.type === 'highlight') end = getHighlightCenter(h);
    }
    return { start, control, end };
  }, [getHighlightCenter, shapesById]);

  const resolveShadowCenter = useCallback((s: Shape) => {
    const refId = Array.isArray(s.vertexRefs) ? s.vertexRefs[0] : null;
    if (refId) {
      const h = shapesById.get(refId);
      if (h && h.type === 'highlight') return getHighlightCenter(h);
    }
    return { x: s.x || 0, y: s.y || 0 };
  }, [getHighlightCenter, shapesById]);

  const findHighlightHit = useCallback((p: { x: number; y: number }): { id: string; x: number; y: number } | null => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i] as any;
      if (s?._temp) continue;
      if (s.type !== 'highlight') continue;
      const cen = getHighlightCenter(s);
      const rx = (s.rx ?? 40);
      const ry = (s.ry ?? 10);
      const dx = p.x - cen.x;
      const dy = p.y - cen.y;
      const v = (dx * dx) / ((rx * rx) || 1e-6) + (dy * dy) / ((ry * ry) || 1e-6);
      if (v <= 1) return { id: s.id, x: cen.x, y: cen.y };
    }
    return null;
  }, [shapes, getHighlightCenter]);

  const getShapeBounds = useCallback((s: Shape): { x: number; y: number; w: number; h: number } => {
    if (homography && s.plane) {
      if (s.type === 'box') {
        const pts = rectPlaneToImagePoints(homography.H, s.plane.cx, s.plane.cy, s.plane.w || 0, s.plane.h || 0);
        return getBoundsForFlatPoints(pts);
      }
      if (s.type === 'circle') {
        const rx = s.plane.rx ?? s.plane.r ?? 0;
        const ry = s.plane.ry ?? s.plane.r ?? 0;
        const pts = ellipsePlaneToImagePoints(homography.H, s.plane.cx, s.plane.cy, rx, ry);
        return getBoundsForFlatPoints(pts);
      }
      if (s.type === 'highlight') {
        const cen = applyHomography(homography.H, s.plane.cx, s.plane.cy);
        const rx = s.rx ?? 40;
        const ry = s.ry ?? 10;
        return { x: cen.x - rx, y: cen.y - ry, w: rx * 2, h: ry * 2 };
      }
    }
    if (s.type === 'box') return { x: s.x, y: s.y, w: s.w || 0, h: s.h || 0 };
    if (s.type === 'circle') {
      const rx = s.rx ?? s.r ?? 0;
      const ry = s.ry ?? s.r ?? 0;
      return { x: s.x - rx, y: s.y - ry, w: rx * 2, h: ry * 2 };
    }
    if (s.type === 'highlight') return { x: s.x - (s.rx || 0), y: s.y - (s.ry || 0), w: (s.rx || 0) * 2, h: (s.ry || 0) * 2 };
    if (s.type === 'shadow') {
      const center = resolveShadowCenter(s);
      const pts = buildShadowSectorPoints(center.x, center.y, s.r || DEFAULT_SHADOW_RADIUS, s.rotation || 0, s.spreadDeg || DEFAULT_SHADOW_SPREAD_DEG);
      return getBoundsForFlatPoints(pts);
    }
    if (s.type === 'lob') {
      const { start, control, end } = resolveLobPoints(s);
      return getBoundsForFlatPoints([start.x, start.y, control.x, control.y, end.x, end.y]);
    }
    if (s.type === 'arrow' || s.type === 'poly') {
      const pts = s.points || [];
      const absolute = pts.map((v, i) => v + (i % 2 === 0 ? (s.x || 0) : (s.y || 0)));
      return getBoundsForFlatPoints(absolute);
    }
    const fs = s.style?.fontSize || 48;
    return { x: s.x, y: s.y, w: 100, h: fs };
  }, [getHighlightCenter, homography, resolveLobPoints, resolveShadowCenter]);

  const isTightDblClick = useCallback(() => {
    const h = clickHistoryRef.current;
    if (!h || h.length < 2) return true;
    const a = h[0];
    const b = h[1];
    const dt = a.t - b.t;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return dt >= 0 && dt <= 350 && d <= 4;
  }, []);

  const beginTextEdit = useCallback((id: string, opts?: { isNew?: boolean }) => {
    const s = shapes.find(x => x.id === id);
    if (!s || s.type !== 'text') return;
    const cur = s.text || '';
    setSelectedId(id);
    setSelectedIds([id]);
    setTextEdit({ id, value: cur, orig: cur, isNew: !!opts?.isNew });
  }, [shapes]);

  const commitTextEdit = useCallback(() => {
    setTextEdit(prev => {
      if (!prev) return prev;
      const v = prev.value;
      if (prev.isNew && v.trim().length === 0) {
        setShapes(s => s.filter(x => x.id !== prev.id));
        setSelectedId(null);
        setSelectedIds([]);
      } else {
        setShapes(s => s.map(x => x.id === prev.id ? { ...x, text: v } : x));
      }
      return null;
    });
  }, []);

  const cancelTextEdit = useCallback(() => {
    setTextEdit(prev => {
      if (!prev) return prev;
      if (prev.isNew) {
        setShapes(s => s.filter(x => x.id !== prev.id));
        setSelectedId(null);
        setSelectedIds([]);
      } else {
        setShapes(s => s.map(x => x.id === prev.id ? { ...x, text: prev.orig } : x));
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!textEdit) return;
    const t = window.setTimeout(() => {
      const el = textAreaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [textEdit, shapes]);

  // Core save routine with permission checks
  const performSave = useCallback(async () => {
    if (!projectDir) return;
    try {
      setIoError(null);
      const liveShapes = shapesRef.current;
      const livePerspective = perspectiveRef.current;
      const writePerspective = livePerspective || lastNonNullPerspectiveRef.current;
      const finalShapes = Array.isArray(liveShapes) ? liveShapes.filter((s: any) => !s?._temp && !(typeof s?.id === 'string' && s.id.startsWith('_temp_'))) : [];
      const body: AnnotationsV1 = {
        schema: 'annotations.v1',
        annotationId,
        label: annotationLabel,
        stillId,
        image: { file: imageInfo.file, width: imageInfo.width, height: imageInfo.height },
        shapes: finalShapes,
        perspective: writePerspective ? { quad: writePerspective.quad } : undefined,
      };
      const text = JSON.stringify(body, null, 2);
      const contentHash = hashString(text);
      if (lastSavedHashRef.current && lastSavedHashRef.current === contentHash) {
        const now = new Date().toISOString();
        if (onSaveStatus) onSaveStatus({ state: 'saved', at: now, message: 'already_saved' });
        return;
      }
      const doWrite = async () => {
        setIsSaving(true);
        if (onSaveStatus) onSaveStatus({ state: 'saving' });
        const anyHandle: any = projectDir as any;
        const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'readwrite' }) : 'granted');
        if (q !== 'granted' || !hasLoadedRef.current) {
          setIoError('Write permission not granted for project folder.');
          setIsSaving(false);
          await writeBackup({ docKey: backupDocKey, stillId, annotationId, schema: 'annotations.v1', updatedAt: new Date().toISOString(), contentHash, data: body });
          if (onSaveStatus) onSaveStatus({ state: 'error', at: new Date().toISOString(), message: 'permission' });
          return;
        }
        try {
          await writeAnnotationDocument(projectDir, annotationFilePath, body);
          lastSavedHashRef.current = contentHash;
          setIsSaving(false);
          await writeBackup({ docKey: backupDocKey, stillId, annotationId, schema: 'annotations.v1', updatedAt: new Date().toISOString(), contentHash, data: body });
          try {
            const bc = new BroadcastChannel('annotate-events');
            bc.postMessage({ type: 'annotation-saved', stillId, annotationId, file: annotationFilePath, lastModified: new Date().toISOString() });
            bc.close();
          } catch {}
          if (onSaveStatus) onSaveStatus({ state: 'saved', at: new Date().toISOString() });
        } catch (e: any) {
          setIsSaving(false);
          setIoError(e?.message || String(e));
          await writeBackup({ docKey: backupDocKey, stillId, annotationId, schema: 'annotations.v1', updatedAt: new Date().toISOString(), contentHash, data: body });
          if (onSaveStatus) onSaveStatus({ state: 'error', at: new Date().toISOString(), message: e?.message || String(e) });
        }
      };
      const navAny: any = navigator as any;
      if (navAny?.locks?.request) {
        await navAny.locks.request(`save-${backupDocKey}`, { mode: 'exclusive' }, async () => { await doWrite(); });
      } else {
        if (isSaving) return;
        await doWrite();
      }
    } catch (e: any) {
      setIoError(e?.message || String(e));
      if (onSaveStatus) onSaveStatus({ state: 'error', at: new Date().toISOString(), message: e?.message || String(e) });
    }
  }, [projectDir, stillId, annotationId, annotationFilePath, annotationLabel, backupDocKey, imageInfo, onSaveStatus, isSaving]);

  // Debounced save wrapper
  const requestSave = useCallback(() => {
    if (!hasLoadedRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void performSave(); }, 600);
  }, [performSave]);

  useEffect(() => {
    if (!autoPerspectiveTick || autoPerspectiveTick === lastAutoPerspectiveTickRef.current) return;
    lastAutoPerspectiveTickRef.current = autoPerspectiveTick;
    if (!autoPerspectiveQuad || autoPerspectiveQuad.length !== 4) return;
    applyPerspectiveQuadState(autoPerspectiveQuad);
    requestSave();
    if (onRequestToolChange) Promise.resolve().then(() => onRequestToolChange('select'));
  }, [autoPerspectiveQuad, autoPerspectiveTick, onRequestToolChange, requestSave]);

  // Manual Save: when parent bumps saveTick, run an immediate save
  useEffect(() => {
    const { nextSeenTick, shouldSave } = consumeManualSaveTick(lastManualTickRef.current, saveTick);
    lastManualTickRef.current = nextSeenTick;
    if (shouldSave) void performSave();
  }, [saveTick, performSave]);

  useEffect(() => {
    const onHide = () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void performSave();
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [performSave]);

  // If the projectDir/manifest become available after shapes changed, try saving once
  useEffect(() => {
    if (projectDir) {
      // Attempt a save of current state (debounced)
      requestSave();
    }
  }, [projectDir, requestSave]);

  // Flush pending save on unmount and when tab is hidden
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void performSave();
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, [performSave]);

  useEffect(() => {
    const hasTemp = Array.isArray(shapes) && shapes.some(s => (s as any)._temp);
    if (!hasTemp) {
      if (historyActionRef.current) {
        lastFinalRef.current = shapes;
        if (shapes) requestSave();
      } else {
        if (lastFinalRef.current && lastFinalRef.current !== shapes) {
          pastRef.current.push(lastFinalRef.current);
          futureRef.current = [];
        }
        lastFinalRef.current = shapes;
        if (shapes) requestSave();
      }
    }
    lastShapesRef.current = shapes;
    historyActionRef.current = null;
  }, [shapes, requestSave]);

  // Helpers: get pointer pos in image space
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const selectedNodeRef = useRef<any>(null);
  const getPointerPos = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current as any;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const tr = stage.getAbsoluteTransform().copy();
    tr.invert();
    const p = tr.point(pos);
    return { x: p.x, y: p.y };
  }, []);

  const getLocalScales = useCallback((p: { x: number; y: number }): { width: number; height: number } | null => {
    if (!perspective?.quad) return null;
    const q = perspective.quad;
    const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x - b.x, y: a.y - b.y });
    const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y;
    const len2 = (v: { x: number; y: number }) => v.x * v.x + v.y * v.y;
    const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
    let bestV = 0.5; let bestT = 0.5; let bestD2 = Infinity;
    for (let i = 0; i <= 40; i++) {
      const v = i / 40;
      const L = lerpPt(q[0], q[3], v);
      const R = lerpPt(q[1], q[2], v);
      const LR = sub(R, L);
      const w = sub(p, L);
      const denom = Math.max(1e-6, len2(LR));
      let t = dot(w, LR) / denom;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const proj = { x: L.x + LR.x * t, y: L.y + LR.y * t };
      const d2 = len2(sub(p, proj));
      if (d2 < bestD2) { bestD2 = d2; bestV = v; bestT = t; }
    }
    const L = lerpPt(q[0], q[3], bestV);
    const R = lerpPt(q[1], q[2], bestV);
    const width = Math.max(1e-6, len(sub(R, L)));
    const T = lerpPt(q[0], q[1], bestT);
    const B = lerpPt(q[3], q[2], bestT);
    const height = Math.max(1e-6, len(sub(B, T)));
    return { width, height };
  }, [perspective]);

  const getMidlineDims = useCallback((): { widthMid: number; heightMid: number } | null => {
    // Prefer boxFrac if available, fallback to hlFrac
    if (boxFrac && boxFrac.w > 0 && boxFrac.h > 0) {
      // boxFrac.w = 80 / widthMid, so widthMid = 80 / boxFrac.w
      const widthMid = 80 / boxFrac.w;
      const heightMid = 48 / boxFrac.h;
      return { widthMid, heightMid };
    }
    if (hlFrac && hlFrac.rx > 0 && hlFrac.ry > 0) {
      const widthMid = 15 / hlFrac.rx;
      const heightMid = 12 / hlFrac.ry;
      return { widthMid, heightMid };
    }
    return null;
  }, [boxFrac, hlFrac]);

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    startRef.current = null;
    shadowAnchorRef.current = null;
    if (arrowTempRef.current) arrowTempRef.current.start = null;
    if (lobTempRef.current) lobTempRef.current.start = null;
    polyTempRef.current = null;
    polyNearIndexRef.current = -1;
    setShapes(prev => prev.filter((s: any) => !s?._temp && !(typeof s?.id === 'string' && s.id.startsWith('_temp_'))));
  }, []);

  useEffect(() => {
    if (!annotationsLocked) return;
    cancelDrawing();
    setIsSelecting(false);
    selStartRef.current = null;
    selCandidateRef.current = null;
    selCandidateEmptyRef.current = false;
    setSelRect(null);
    setTextEdit(null);
  }, [annotationsLocked, cancelDrawing]);

  // Tool interactions
  const onMouseDown = useCallback((e: any) => {
    if (annotationsLocked) return;
    const p = getPointerPos(); if (!p) return;
    const evt = (e && (e.evt || e)) as any;
    if (evt?.button === 0) {
      const now = Date.now();
      const prev0 = clickHistoryRef.current[0];
      clickHistoryRef.current = [{ t: now, x: p.x, y: p.y }, ...(prev0 ? [prev0] : [])];
    }
    if (evt?.button === 2) {
      evt.preventDefault();
      suppressNextClickRef.current = true;
      if (isDrawing || arrowTempRef.current?.start || polyTempRef.current) {
        cancelDrawing();
      } else {
        setSelectedId(null);
        setSelectedIds([]);
      }
      return;
    }
    const tgt = e?.target;
    const isStage = tgt && tgt.getStage && (tgt === tgt.getStage());
    const isLayer = tgt && (typeof tgt.getClassName === 'function' ? tgt.getClassName() === 'Layer' : tgt?.className === 'Layer');
    const clickedOnEmpty = !!(isStage || isLayer);
    if (tool === 'calibrate') {
      setCalibPoints(prev => {
        const pts = [...prev, p];
        if (pts.length === 4) {
          applyPerspectiveQuadState(pts);
          requestSave();
          if (onRequestToolChange) Promise.resolve().then(() => onRequestToolChange('select'));
        }
        return pts;
      });
      return;
    }
    if (tool === 'select') {
      if (!clickedOnEmpty) return;
      selCandidateRef.current = p;
      selCandidateEmptyRef.current = clickedOnEmpty;
      selStartRef.current = p;
      setIsSelecting(false);
      setSelRect(null);
      return;
    }
    if (tool === 'box' || tool === 'circle') {
      if (!clickedOnEmpty) return;
      setIsDrawing(true);
      startRef.current = p;
      shadowAnchorRef.current = null;
      return;
    }
    if (tool === 'shadow') {
      const hit = findHighlightHit(p);
      if (!clickedOnEmpty && !hit) return;
      setIsDrawing(true);
      startRef.current = hit ? { x: hit.x, y: hit.y } : p;
      shadowAnchorRef.current = hit?.id || null;
    }
  }, [annotationsLocked, tool, getPointerPos, isDrawing, cancelDrawing]);

  const onClick = useCallback((e: any) => {
    if (annotationsLocked) return;
    const p = getPointerPos(); if (!p) return;
    const evt = (e && (e.evt || e)) as any;
    if (evt?.button === 2) return;
    if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
    const tgt = e?.target;
    const isStage = tgt && tgt.getStage && (tgt === tgt.getStage());
    const isLayer = tgt && (typeof tgt.getClassName === 'function' ? tgt.getClassName() === 'Layer' : tgt?.className === 'Layer');
    const clickedOnEmpty = !!(isStage || isLayer);
    if (tool === 'highlight') {
      if (!clickedOnEmpty) return;
      const id = makeId();
      // Flat, screen-space highlight: width=80, height=20 (radiusX=40, radiusY=10)
      const rx = 40;
      const ry = 10;
      setShapes(prev => [...prev, { id, type: 'highlight', x: p.x, y: p.y, rx, ry, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } }]);
      return;
    }
    if (tool === 'text') {
      if (!clickedOnEmpty) return;
      const id = makeId();
      const initial = 'Text';
      setShapes(prev => [...prev, { id, type: 'text', x: p.x, y: p.y, text: initial, style: { stroke: defaultAnnColor, fill: 'transparent', strokeWidth: 1, strokePattern: (defaultStrokePattern || 'solid'), fontSize: defFontSz, fontFamily: 'Inter, system-ui, sans-serif', textHighlight: defTextHl } }]);
      setSelectedId(id);
      setSelectedIds([id]);
      setTextEdit({ id, value: initial, orig: initial, isNew: true });
      return;
    }
    if (tool === 'arrow') {
      const hit = findHighlightHit(p);
      if (!clickedOnEmpty && !hit) return;
      if (!arrowTempRef.current) arrowTempRef.current = { start: null };
      if (!arrowTempRef.current.start) {
        arrowTempRef.current.start = hit ? { x: hit.x, y: hit.y, refId: hit.id } : { x: p.x, y: p.y };
      } else {
        const s = arrowTempRef.current.start;
        const hit2 = findHighlightHit(p);
        const end = hit2 ? { x: hit2.x, y: hit2.y, refId: hit2.id } : { x: p.x, y: p.y };
        const id = makeId();
        setShapes(prev => {
          const next = prev.filter(x => !(x as any)._temp || x.id !== '_temp_arrow');
          const refs = [s.refId || null, end.refId || null];
          return [...next, { id, type: 'arrow', points: [s.x, s.y, end.x, end.y], vertexRefs: refs.some(r => !!r) ? refs : undefined, x: 0, y: 0, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid') } }];
        });
        arrowTempRef.current.start = null;
      }
      return;
    }
    if (tool === 'lob') {
      const hit = findHighlightHit(p);
      if (!clickedOnEmpty && !hit) return;
      if (!lobTempRef.current) lobTempRef.current = { start: null };
      if (!lobTempRef.current.start) {
        lobTempRef.current.start = hit ? { x: hit.x, y: hit.y, refId: hit.id } : { x: p.x, y: p.y };
      } else {
        const s = lobTempRef.current.start;
        const hit2 = findHighlightHit(p);
        const end = hit2 ? { x: hit2.x, y: hit2.y, refId: hit2.id } : { x: p.x, y: p.y };
        const control = buildDefaultLobControlPoint({ x: s.x, y: s.y }, { x: end.x, y: end.y });
        const id = makeId();
        setShapes(prev => {
          const next = prev.filter(x => !(x as any)._temp || x.id !== '_temp_lob');
          const refs = [s.refId || null, end.refId || null];
          return [...next, {
            id,
            type: 'lob',
            x: 0,
            y: 0,
            points: [s.x, s.y, control.x, control.y, end.x, end.y],
            vertexRefs: refs.some(r => !!r) ? refs : undefined,
            style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid') },
          }];
        });
        lobTempRef.current.start = null;
      }
      return;
    }
    if (tool === 'poly') {
      const hit = findHighlightHit(p);
      if (!clickedOnEmpty && !hit) return;
      if (!polyTempRef.current) polyTempRef.current = { points: [] };
      const poly = polyTempRef.current;
      let bestIdx = -1;
      let bestD = Infinity;
      for (let i = 0; i < poly.points.length; i++) {
        const pt = poly.points[i];
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d <= 10 && d < bestD) { bestD = d; bestIdx = i; }
      }
      polyNearIndexRef.current = bestIdx;
      const nearVertex = bestIdx >= 0 && bestD <= 10;
      if (nearVertex && poly.points.length >= 2) {
        const id = makeId();
        const pts = poly.points;
        const refs = pts.map(pt => pt.refId || null);
        const closed = bestIdx === 0 && pts.length >= 3;
        setShapes(prev => {
          const next = prev.filter(x => !(x as any)._temp || x.id !== '_temp_poly');
          next.push({ id, type: 'poly', x: 0, y: 0, points: pts.flatMap(pt => [pt.x, pt.y]), vertexRefs: refs.some(r => !!r) ? refs : undefined, closed, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: closed ? defFill : undefined, fillOpacity: closed ? defFillOp : undefined } } as any);
          return next;
        });
        polyTempRef.current = null;
        polyNearIndexRef.current = -1;
      } else {
        const nextPt = hit ? { x: hit.x, y: hit.y, refId: hit.id } : { x: p.x, y: p.y };
        const last = poly.points.length > 0 ? poly.points[poly.points.length - 1] : null;
        const sameRef = (last?.refId || null) === (nextPt as any).refId;
        if (!last || !sameRef || Math.hypot(last.x - nextPt.x, last.y - nextPt.y) > 1) {
          poly.points.push(nextPt as any);
        }
        polyNearIndexRef.current = -1;
        setShapes(prev => {
          const next = prev.filter(x => !(x as any)._temp || x.id !== '_temp_poly');
          const flat = poly.points.flatMap(pt => [pt.x, pt.y]);
          next.push({ id: '_temp_poly', type: 'poly', x: 0, y: 0, points: flat, closed: false, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid') } } as any);
          (next[next.length - 1] as any)._temp = true;
          return next;
        });
      }
    }
  }, [annotationsLocked, tool, getPointerPos, findHighlightHit, beginTextEdit, defaultStrokePattern, defaultAnnColor, defStrokeW, defFill, defFillOp, defFontSz, defTextHl]);

  const onDblClick = useCallback(() => {
    if (annotationsLocked) return;
    if (tool !== 'poly') return;
    if (!isTightDblClick()) return;
    const poly = polyTempRef.current;
    if (!poly || poly.points.length < 2) return;
    const pts = [...poly.points];
    if (pts.length >= 2) {
      const a = pts[pts.length - 1];
      const b = pts[pts.length - 2];
      const sameRef = (a.refId || null) === (b.refId || null);
      if (sameRef && Math.hypot(a.x - b.x, a.y - b.y) <= 1) pts.pop();
    }
    if (pts.length < 2) return;
    const id = makeId();
    const refs = pts.map(pt => pt.refId || null);
    setShapes(prev => {
      const next = prev.filter(x => !(x as any)._temp || x.id !== '_temp_poly');
      next.push({ id, type: 'poly', x: 0, y: 0, points: pts.flatMap(pt => [pt.x, pt.y]), vertexRefs: refs.some(r => !!r) ? refs : undefined, closed: false, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid') } } as any);
      return next;
    });
    polyTempRef.current = null;
    polyNearIndexRef.current = -1;
  }, [annotationsLocked, tool, isTightDblClick, defaultStrokePattern, defaultAnnColor, defStrokeW]);

  const onMouseMove = useCallback((e: any) => {
    if (annotationsLocked) return;
    const p = getPointerPos(); if (!p) return;
    const evt = (e && (e.evt || e)) as any;
    const shiftKey = !!evt?.shiftKey;
    const constrainKey = !!(evt?.metaKey || evt?.ctrlKey);
    if (tool === 'calibrate') {
      setCalibHover(p);
      return;
    }
    if (tool === 'select') {
      // start selection only if drag threshold passed (from anywhere)
      if (!isSelecting && selCandidateRef.current) {
        const s = selCandidateRef.current;
        const dx = p.x - s.x; const dy = p.y - s.y;
        if ((Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          setIsSelecting(true);
          selStartRef.current = s;
          const x = Math.min(s.x, p.x);
          const y = Math.min(s.y, p.y);
          const w = Math.abs(p.x - s.x);
          const h = Math.abs(p.y - s.y);
          setSelRect({ x, y, w, h });
          return;
        }
      }
      if (isSelecting && selStartRef.current) {
        const s = selStartRef.current;
        const x = Math.min(s.x, p.x);
        const y = Math.min(s.y, p.y);
        const w = Math.abs(p.x - s.x);
        const h = Math.abs(p.y - s.y);
        setSelRect({ x, y, w, h });
        return;
      }
    }
    if (!isDrawing || !startRef.current) return;
    const s = startRef.current;
    if (tool === 'box') {
      const usePerspective = !!homography && !shiftKey;
      if (usePerspective) {
        const sp = applyHomographyInv(homography.Hinv, s.x, s.y);
        const pp = applyHomographyInv(homography.Hinv, p.x, p.y);
        const cx = (sp.u + pp.u) / 2; const cy = (sp.v + pp.v) / 2;
        let w = Math.abs(pp.u - sp.u);
        let h = Math.abs(pp.v - sp.v);
        if (constrainKey) {
          const sz = Math.max(w, h);
          w = sz; h = sz;
        }
        const pts = rectPlaneToImagePoints(homography.H, cx, cy, w, h);
        setShapes(prev => {
          const next = prev.filter(x => !(x as any)._temp);
          next.push({ id: '_temp_poly', type: 'poly', x: 0, y: 0, points: pts, closed: true, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } } as any);
          (next[next.length - 1] as any)._temp = true;
          return next;
        });
      } else {
        let x = Math.min(s.x, p.x);
        let y = Math.min(s.y, p.y);
        let w = Math.abs(p.x - s.x);
        let h = Math.abs(p.y - s.y);
        if (!shiftKey) {
          const scales = getLocalScales({ x: (s.x + p.x) / 2, y: (s.y + p.y) / 2 });
          const mids = getMidlineDims();
          if (scales && mids) {
            const kx = Math.max(1e-6, scales.width / mids.widthMid);
            const ky = Math.max(1e-6, scales.height / mids.heightMid);
            w = w * kx;
            h = h * ky;
            const cx = (s.x + p.x) / 2; const cy = (s.y + p.y) / 2;
            x = cx - w / 2; y = cy - h / 2;
          }
        }
        if (constrainKey) {
          const sz = Math.max(w, h);
          const cx = (s.x + p.x) / 2; const cy = (s.y + p.y) / 2;
          w = sz; h = sz;
          x = cx - w / 2; y = cy - h / 2;
        }
        setShapes(prev => {
          const next = [...prev];
          if (next.length > 0 && (next[next.length - 1] as any)._temp) next.pop();
          next.push({ id: '_temp_rect', type: 'box', x, y, w, h, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } } as any);
          (next[next.length - 1] as any)._temp = true;
          return next;
        });
      }
    } else if (tool === 'circle') {
      const usePerspective = !!homography && !shiftKey;
      if (usePerspective) {
        const sp = applyHomographyInv(homography.Hinv, s.x, s.y);
        const pp = applyHomographyInv(homography.Hinv, p.x, p.y);
        let rx = Math.abs(pp.u - sp.u);
        let ry = Math.abs(pp.v - sp.v);
        if (constrainKey) {
          const r = Math.max(rx, ry);
          rx = r; ry = r;
        }
        const pts = ellipsePlaneToImagePoints(homography.H, sp.u, sp.v, rx, ry);
        setShapes(prev => {
          const next = prev.filter(x => !(x as any)._temp);
          next.push({ id: '_temp_poly', type: 'poly', x: 0, y: 0, points: pts, closed: true, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } } as any);
          (next[next.length - 1] as any)._temp = true;
          return next;
        });
      } else {
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        let rx = Math.abs(dx);
        let ry = Math.abs(dy);
        if (!shiftKey) {
          const scales = getLocalScales(s);
          const mids = getMidlineDims();
          if (scales && mids) {
            const kx = Math.max(1e-6, scales.width / mids.widthMid);
            const ky = Math.max(1e-6, scales.height / mids.heightMid);
            rx = rx * kx;
            ry = ry * ky;
          }
        }
        if (constrainKey) {
          const r = Math.max(rx, ry);
          rx = r; ry = r;
        }
        setShapes(prev => {
          const next = [...prev];
          if (next.length > 0 && (next[next.length - 1] as any)._temp) next.pop();
          next.push({ id: '_temp_circle', type: 'circle', x: s.x, y: s.y, rx, ry, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } } as any);
          (next[next.length - 1] as any)._temp = true;
          return next;
        });
      }
    } else if (tool === 'shadow') {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dist = Math.hypot(dx, dy);
      const radius = dist <= 3 ? DEFAULT_SHADOW_RADIUS : dist;
      const rotation = dist <= 3 ? 0 : radiansToDegrees(Math.atan2(dy, dx));
      setShapes(prev => {
        const next = [...prev];
        if (next.length > 0 && (next[next.length - 1] as any)._temp) next.pop();
        next.push({
          id: '_temp_shadow',
          type: 'shadow',
          x: s.x,
          y: s.y,
          r: radius,
          rotation,
          spreadDeg: DEFAULT_SHADOW_SPREAD_DEG,
          style: {
            stroke: defaultAnnColor,
            strokeWidth: Math.max(2, Math.min(defStrokeW, 4)),
            strokePattern: (defaultStrokePattern || 'solid'),
            fill: defFill,
            fillOpacity: Math.max(defFillOp, 0.22),
          },
        } as any);
        (next[next.length - 1] as any)._temp = true;
        return next;
      });
    }
  }, [annotationsLocked, isDrawing, isSelecting, tool, getPointerPos, homography, getLocalScales, getMidlineDims, defaultStrokePattern, defaultAnnColor, defStrokeW, defFill, defFillOp]);

  const onMouseUp = useCallback((e: any) => {
    if (annotationsLocked) return;
    const p = getPointerPos();
    const evt = (e && (e.evt || e)) as any;
    const shiftKey = !!evt?.shiftKey;
    const constrainKey = !!(evt?.metaKey || evt?.ctrlKey);
    if (tool === 'select' && (selStartRef.current || selCandidateRef.current)) {
      const s = selStartRef.current || selCandidateRef.current!;
      const end = p || s;
      const x = Math.min(s.x, end.x);
      const y = Math.min(s.y, end.y);
      const w = Math.abs(end.x - s.x);
      const h = Math.abs(end.y - s.y);
      const dragged = Math.max(w, h) > 3;
      if (dragged) {
        const rect = { x, y, w, h };
        const intersects = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => (
          a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        );
        const hits = shapes.filter(sh => !(sh as any)._temp && intersects(getShapeBounds(sh), rect)).map(sh => sh.id);
        const addKey = !!evt?.shiftKey;
        const subKey = !!(evt?.metaKey || evt?.ctrlKey);
        const base = (selectedIds && selectedIds.length > 0)
          ? selectedIds
          : (selectedId ? [selectedId] : []);
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
          const sub = new Set(hits);
          nextIds = base.filter(id => !sub.has(id));
        }
        if (nextIds.length === 0) {
          setSelectedIds([]);
          setSelectedId(null);
        } else if (nextIds.length === 1) {
          setSelectedIds([]);
          setSelectedId(nextIds[0]);
        } else {
          setSelectedIds(nextIds);
          setSelectedId(nextIds[nextIds.length - 1]);
        }
      } else if (!dragged && selCandidateEmptyRef.current) {
        // empty click without drag threshold => clear selection
        const addKey = !!evt?.shiftKey;
        const subKey = !!(evt?.metaKey || evt?.ctrlKey);
        if (!addKey && !subKey) {
          setSelectedIds([]);
          setSelectedId(null);
        }
      }
      setIsSelecting(false);
      selStartRef.current = null;
      selCandidateRef.current = null;
      selCandidateEmptyRef.current = false;
      setSelRect(null);
      return;
    }
    if (!p || !isDrawing || !startRef.current) return;
    const s = startRef.current;
    if (tool === 'box') {
      const id = makeId();
      const clicked = Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) <= 3;
      const usePerspective = !!homography && !shiftKey;
      if (usePerspective) {
        if (clicked) {
          const uv = applyHomographyInv(homography.Hinv, s.x, s.y);
          const w = boxFrac ? boxFrac.w : 0.1;
          const h = boxFrac ? boxFrac.h : 0.06;
          const sz = constrainKey ? Math.max(w, h) : 0;
          setShapes(prev => [...prev.filter(x => !(x as any)._temp), { id, type: 'box', x: 0, y: 0, plane: { cx: uv.u, cy: uv.v, w: constrainKey ? sz : w, h: constrainKey ? sz : h }, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } }]);
        } else {
          const sp = applyHomographyInv(homography.Hinv, s.x, s.y);
          const pp = applyHomographyInv(homography.Hinv, p.x, p.y);
          const cx = (sp.u + pp.u) / 2; const cy = (sp.v + pp.v) / 2;
          let w = Math.abs(pp.u - sp.u);
          let h = Math.abs(pp.v - sp.v);
          if (constrainKey) {
            const sz = Math.max(w, h);
            w = sz; h = sz;
          }
          setShapes(prev => [...prev.filter(x => !(x as any)._temp), { id, type: 'box', x: 0, y: 0, plane: { cx, cy, w, h }, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } }]);
        }
      } else {
        let x = Math.min(s.x, p.x);
        let y = Math.min(s.y, p.y);
        let w = Math.abs(p.x - s.x);
        let h = Math.abs(p.y - s.y);
        const clickedFlat = Math.max(w, h) <= 3;
        if (clickedFlat) {
          if (!shiftKey) {
            const scales = getLocalScales(s);
            if (scales && boxFrac) {
              w = boxFrac.w * scales.width;
              h = boxFrac.h * scales.height;
              x = s.x - w / 2;
              y = s.y - h / 2;
            } else {
              w = 80; h = 48; x = s.x - w / 2; y = s.y - h / 2;
            }
          } else {
            w = 80; h = 48; x = s.x - w / 2; y = s.y - h / 2;
          }
        } else {
          if (!shiftKey) {
            const scales = getLocalScales({ x: (s.x + p.x) / 2, y: (s.y + p.y) / 2 });
            const mids = getMidlineDims();
            if (scales && mids) {
              const kx = Math.max(1e-6, scales.width / mids.widthMid);
              const ky = Math.max(1e-6, scales.height / mids.heightMid);
              w = w * kx;
              h = h * ky;
              const cx0 = (s.x + p.x) / 2; const cy0 = (s.y + p.y) / 2;
              x = cx0 - w / 2; y = cy0 - h / 2;
            }
          }
          if (constrainKey) {
            const sz = Math.max(w, h);
            const cx0 = (s.x + p.x) / 2; const cy0 = (s.y + p.y) / 2;
            w = sz; h = sz;
            x = cx0 - w / 2; y = cy0 - h / 2;
          }
        }
        if (clickedFlat && constrainKey) {
          const sz = Math.max(w, h);
          w = sz; h = sz;
          x = s.x - w / 2; y = s.y - h / 2;
        }
        setShapes(prev => [...prev.filter(x => !(x as any)._temp), { id, type: 'box', x, y, w, h, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } }]);
      }
    } else if (tool === 'circle') {
      const id = makeId();
      const dx = p.x - s.x; const dy = p.y - s.y;
      const clicked = Math.hypot(dx, dy) <= 3;
      const usePerspective = !!homography && !shiftKey;
      if (usePerspective) {
        const sp = applyHomographyInv(homography.Hinv, s.x, s.y);
        if (clicked) {
          const rx = circFrac ? circFrac.rx : 0.05;
          const ry = circFrac ? circFrac.ry : 0.03;
          const r = constrainKey ? Math.max(rx, ry) : 0;
          setShapes(prev => [...prev.filter(x => !(x as any)._temp), { id, type: 'circle', x: 0, y: 0, plane: { cx: sp.u, cy: sp.v, rx: constrainKey ? r : rx, ry: constrainKey ? r : ry }, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } }]);
        } else {
          const pp = applyHomographyInv(homography.Hinv, p.x, p.y);
          let rx = Math.abs(pp.u - sp.u);
          let ry = Math.abs(pp.v - sp.v);
          if (constrainKey) {
            const r = Math.max(rx, ry);
            rx = r; ry = r;
          }
          setShapes(prev => [...prev.filter(x => !(x as any)._temp), { id, type: 'circle', x: 0, y: 0, plane: { cx: sp.u, cy: sp.v, rx, ry }, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } }]);
        }
      } else {
        let rx = Math.abs(dx);
        let ry = Math.abs(dy);
        const clickedFlat = Math.max(rx, ry) <= 3;
        if (clickedFlat) {
          if (!shiftKey) {
            const scales = getLocalScales(s);
            if (scales && circFrac) {
              rx = circFrac.rx * scales.width;
              ry = circFrac.ry * scales.height;
            } else {
              rx = 24; ry = 16;
            }
          } else {
            rx = 24; ry = 16;
          }
        } else {
          if (!shiftKey) {
            const scales = getLocalScales(s);
            const mids = getMidlineDims();
            if (scales && mids) {
              const kx = Math.max(1e-6, scales.width / mids.widthMid);
              const ky = Math.max(1e-6, scales.height / mids.heightMid);
              rx = rx * kx;
              ry = ry * ky;
            }
          }
        }
        if (constrainKey) {
          const r = Math.max(rx, ry);
          rx = r; ry = r;
        }
        setShapes(prev => [...prev.filter(x => !(x as any)._temp), { id, type: 'circle', x: s.x, y: s.y, rx, ry, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: defFill, fillOpacity: defFillOp } }]);
      }
    } else if (tool === 'shadow') {
      const id = makeId();
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dist = Math.hypot(dx, dy);
      const radius = dist <= 3 ? DEFAULT_SHADOW_RADIUS : dist;
      const rotation = dist <= 3 ? 0 : radiansToDegrees(Math.atan2(dy, dx));
      setShapes(prev => [...prev.filter(x => !(x as any)._temp), {
        id,
        type: 'shadow',
        x: s.x,
        y: s.y,
        r: radius,
        rotation,
        spreadDeg: DEFAULT_SHADOW_SPREAD_DEG,
        vertexRefs: shadowAnchorRef.current ? [shadowAnchorRef.current] : undefined,
        style: {
          stroke: defaultAnnColor,
          strokeWidth: Math.max(2, Math.min(defStrokeW, 4)),
          strokePattern: (defaultStrokePattern || 'solid'),
          fill: defFill,
          fillOpacity: Math.max(defFillOp, 0.22),
        },
      }]);
    }
    setIsDrawing(false);
    startRef.current = null;
    shadowAnchorRef.current = null;
  }, [annotationsLocked, isDrawing, isSelecting, tool, getPointerPos, selRect, shapes, homography, boxFrac, circFrac, defaultStrokePattern, defaultAnnColor, defStrokeW, defFill, defFillOp, selectedId, selectedIds, getShapeBounds]);

  // Arrow & Poly preview while placing
  useEffect(() => {
    if (annotationsLocked) return;
    const onMove = () => {
      const p = getPointerPos(); if (!p) return;
      if (tool === 'arrow') {
        const st = arrowTempRef.current?.start;
        if (!st) return;
        const hit = findHighlightHit(p);
        const end = hit ? { x: hit.x, y: hit.y } : p;
        setShapes(prev => {
          const next = [...prev];
          const idx = next.findIndex(x => (x as any)._temp && x.id === '_temp_arrow');
          if (idx >= 0) next.splice(idx, 1);
          next.push({ id: '_temp_arrow', type: 'arrow', x: 0, y: 0, points: [st.x, st.y, end.x, end.y], style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid') } } as any);
          (next[next.length - 1] as any)._temp = true;
          return next;
        });
      } else if (tool === 'lob') {
        const st = lobTempRef.current?.start;
        if (!st) return;
        const hit = findHighlightHit(p);
        const end = hit ? { x: hit.x, y: hit.y } : p;
        const control = buildDefaultLobControlPoint({ x: st.x, y: st.y }, end);
        setShapes(prev => {
          const next = [...prev];
          const idx = next.findIndex(x => (x as any)._temp && x.id === '_temp_lob');
          if (idx >= 0) next.splice(idx, 1);
          next.push({
            id: '_temp_lob',
            type: 'lob',
            x: 0,
            y: 0,
            points: [st.x, st.y, control.x, control.y, end.x, end.y],
            style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid') },
          } as any);
          (next[next.length - 1] as any)._temp = true;
          return next;
        });
      } else if (tool === 'poly') {
        const poly = polyTempRef.current;
        if (!poly || poly.points.length === 0) return;
        let bestIdx = -1;
        let bestD = Infinity;
        for (let i = 0; i < poly.points.length; i++) {
          const pt = poly.points[i];
          const d = Math.hypot(p.x - pt.x, p.y - pt.y);
          if (d <= 10 && d < bestD) { bestD = d; bestIdx = i; }
        }
        polyNearIndexRef.current = bestIdx;
        const hit = findHighlightHit(p);
        const cursor = hit ? { x: hit.x, y: hit.y } : p;
        const nearVertex = bestIdx >= 0 && bestD <= 10;
        setShapes(prev => {
          const next = prev.filter(x => !(x as any)._temp || x.id !== '_temp_poly');
          let pts = poly.points;
          let closed = false;
          if (nearVertex) {
            closed = (bestIdx === 0) && (poly.points.length >= 3);
          } else {
            pts = poly.points.concat([cursor as any]);
          }
          const flat = pts.flatMap(pt => [pt.x, pt.y]);
          next.push({ id: '_temp_poly', type: 'poly', x: 0, y: 0, points: flat, closed, style: { stroke: defaultAnnColor, strokeWidth: defStrokeW, strokePattern: (defaultStrokePattern || 'solid'), fill: closed ? defFill : undefined, fillOpacity: closed ? defFillOp : undefined } } as any);
          (next[next.length - 1] as any)._temp = true;
          return next;
        });
      }
    };
    const stage = stageRef.current;
    if (stage) stage.on('mousemove', onMove);
    return () => { if (stage) stage.off('mousemove', onMove); };
  }, [annotationsLocked, tool, getPointerPos, findHighlightHit, defaultStrokePattern, defaultAnnColor, defStrokeW, defFill, defFillOp]);

  // Clear temp shapes when tool changes
  useEffect(() => {
    setShapes(prev => prev.filter(s => !(s as any)._temp));
    if (tool !== 'shadow') shadowAnchorRef.current = null;
    if (tool !== 'arrow' && arrowTempRef.current) arrowTempRef.current.start = null;
    if (tool !== 'lob' && lobTempRef.current) lobTempRef.current.start = null;
    if (tool !== 'poly') { polyTempRef.current = null; polyNearIndexRef.current = -1; }
    if (tool !== 'select') { setIsSelecting(false); selStartRef.current = null; setSelRect(null); }
  }, [tool]);

  // Selection and basic drag for shapes
  const onShapeMouseDown = useCallback((id: string, e?: any) => {
    if (annotationsLocked) return;
    if (tool === 'calibrate') return;
    const evt = (e && (e.evt || e)) as any;
    const addKey = !!evt?.shiftKey;
    const subKey = !!(evt?.metaKey || evt?.ctrlKey);

    const base = (selectedIds && selectedIds.length > 0)
      ? selectedIds
      : (selectedId ? [selectedId] : []);

    if (!addKey && !subKey) {
      if (selectedId === id && (!selectedIds || selectedIds.length === 0)) return;
      setSelectedId(id);
      setSelectedIds([]);
      return;
    }

    const set = new Set(base);
    if (addKey) set.add(id);
    if (subKey) set.delete(id);

    const nextOrdered = base.filter(x => set.has(x));
    if (addKey && !base.includes(id) && set.has(id)) nextOrdered.push(id);

    if (nextOrdered.length === 0) {
      setSelectedIds([]);
      setSelectedId(null);
      return;
    }
    if (nextOrdered.length === 1) {
      setSelectedIds([]);
      setSelectedId(nextOrdered[0]);
      return;
    }
    setSelectedIds(nextOrdered);
    if (!subKey && set.has(id)) {
      setSelectedId(id);
    } else if (selectedId && set.has(selectedId)) {
      setSelectedId(selectedId);
    } else {
      setSelectedId(nextOrdered[nextOrdered.length - 1]);
    }
  }, [annotationsLocked, tool, selectedId, selectedIds]);

  const onDragMove = useCallback((id: string, e: any) => {
    if (annotationsLocked) return;
    if (isSelecting) return;
    const node = e.target;
    const { x, y } = node.position();
    setShapes(prev => prev.map(s => s.id === id ? { ...s, x, y } : s));
  }, [annotationsLocked, isSelecting]);

  // Transform end handler for rect/circle/text (arrow transforms disabled for now)
  const onTransformEnd = useCallback((s: Shape, e: any) => {
    if (annotationsLocked) return;
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const rotation = node.rotation();
    const pos = node.position();
    setShapes(prev => prev.map(sp => {
      if (sp.id !== s.id) return sp;
      if (s.type === 'box') {
        const newW = Math.max(0.5, (s.w || 0) * scaleX);
        const newH = Math.max(0.5, (s.h || 0) * scaleY);
        // reset node scale to 1 to keep sizes in attrs
        node.scaleX(1); node.scaleY(1);
        return { ...sp, x: pos.x, y: pos.y, w: newW, h: newH, rotation };
      } else if (s.type === 'circle') {
        const baseR = s.r || 0;
        const newR = Math.max(0.5, baseR * Math.max(scaleX, scaleY));
        node.scaleX(1); node.scaleY(1);
        return { ...sp, x: pos.x, y: pos.y, r: newR, rotation };
      } else if (s.type === 'highlight') {
        const baseRX = s.rx || 0;
        const baseRY = s.ry || 0;
        const newRX = Math.max(0.5, baseRX * scaleX);
        const newRY = Math.max(0.5, baseRY * scaleY);
        node.scaleX(1); node.scaleY(1);
        return { ...sp, x: pos.x, y: pos.y, rx: newRX, ry: newRY, rotation };
      } else if (s.type === 'text') {
        // treat text as scaled container
        node.scaleX(1); node.scaleY(1);
        return { ...sp, x: pos.x, y: pos.y, rotation };
      }
      return sp;
    }));
  }, [annotationsLocked]);

  // Delete selected on Delete/Backspace
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (annotationsLocked) return;
      const t = e.target as HTMLElement | null;
      const isTyping = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (isTyping) return;
      if (e.key === 'Enter' && polyTempRef.current && (polyTempRef.current.points.length >= 2)) {
        e.preventDefault();
        const pts = polyTempRef.current.points;
        const id = makeId();
        setShapes(prev => {
          const next = prev.filter(x => !(x as any)._temp || x.id !== '_temp_poly');
          const closed = !e.shiftKey && pts.length >= 3;
          const refs = pts.map(pt => (pt as any).refId || null);
          next.push({ id, type: 'poly', x: 0, y: 0, points: pts.flatMap(pt => [pt.x, pt.y]), vertexRefs: refs.some(r => !!r) ? refs : undefined, closed, style: { stroke: defaultAnnColor, strokeWidth: 6, strokePattern: (defaultStrokePattern || 'solid'), fill: closed ? defaultAnnColor : undefined, fillOpacity: closed ? 0.3 : undefined } as any });
          return next;
        });
        polyTempRef.current = null;
        polyNearIndexRef.current = -1;
        return;
      }
      if (e.key === 'Escape') {
        if (isDrawing || arrowTempRef.current?.start || lobTempRef.current?.start || polyTempRef.current) {
          e.preventDefault();
          cancelDrawing();
          return;
        }
        if ((selectedIds && selectedIds.length > 0) || selectedId) {
          e.preventDefault();
          setSelectedId(null);
          setSelectedIds([]);
          return;
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((selectedIds && selectedIds.length > 0) || selectedId) {
          e.preventDefault();
          const idsToDelete = selectedIds && selectedIds.length > 0 ? new Set(selectedIds) : new Set([selectedId!]);
          setShapes(prev => prev.filter(s => !idsToDelete.has(s.id)));
          setSelectedId(null);
          setSelectedIds([]);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        // Undo
        if (pastRef.current.length > 0) {
          e.preventDefault();
          historyActionRef.current = 'undo';
          const prev = pastRef.current.pop()!;
          futureRef.current.push(shapes);
          setShapes(prev);
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        // Redo
        if (futureRef.current.length > 0) {
          e.preventDefault();
          historyActionRef.current = 'redo';
          const next = futureRef.current.pop()!;
          pastRef.current.push(shapes);
          setShapes(next);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [annotationsLocked, selectedId, selectedIds, shapes, isDrawing, cancelDrawing, defaultStrokePattern, defaultAnnColor]);

  const occluderNodes = useMemo(() => {
    return shapes.filter(s => s.type === 'highlight').map(s => {
      const cen = getHighlightCenter(s);
      const rx = (s as any).rx ?? 40;
      const ry = (s as any).ry ?? 10;
      return (
        <KEllipse
          key={`occ_${s.id}`}
          x={cen.x}
          y={cen.y}
          radiusX={Math.max(0.5, rx)}
          radiusY={Math.max(0.5, ry)}
          fill="#000"
          listening={false}
          globalCompositeOperation="destination-out"
        />
      );
    });
  }, [shapes, getHighlightCenter]);

  const highlightNodes = shapes.filter(s => s.type === 'highlight').map(s => {
    const isTemp = (s as any)._temp;
    const strokeWidth = s.style?.strokeWidth || 6;
    const dash = dashFromStrokePattern(s.style?.strokePattern, strokeWidth);
    const common = { x: s.x || 0, y: s.y || 0, rotation: 0, stroke: s.style?.stroke || defaultAnnColor, strokeWidth, dash, listening: !annotationsLocked && !isTemp } as any;
    if (homography && s.plane) {
      const cen = applyHomography(homography.H, s.plane.cx, s.plane.cy);
      const rx = (s as any).rx ?? 40;
      const ry = (s as any).ry ?? 10;
      const fill = s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.3) : 'transparent';
      return (
        <KEllipse
          key={s.id}
          {...common}
          x={cen.x}
          y={cen.y}
          radiusX={Math.max(0.5, rx)}
          radiusY={Math.max(0.5, ry)}
          fill={fill}
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragEnd={(e: any) => {
            const node = e.target; const pos = node.position();
            setShapes(prev => prev.map(sp => sp.id === s.id ? { ...sp, x: pos.x, y: pos.y, rx, ry, plane: undefined as any } : sp));
          }}
          hitStrokeWidth={16}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    }
    const fill = s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.3) : 'transparent';
    return (
      <KEllipse
        key={s.id}
        {...common}
        radiusX={Math.max(0.5, s.rx || Math.max(0, (s.w || 0) / 2))}
        radiusY={Math.max(0.5, s.ry || Math.max(0, (s.h || 0) / 2))}
        fill={fill}
        draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
        onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
        onDragMove={(e: any) => onDragMove(s.id, e)}
        hitStrokeWidth={16}
        ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
      />
    );
  });

  // Render shapes
  const disableNonHighlightHit = tool === 'arrow' || tool === 'lob' || tool === 'poly';

  const shadowNodes = shapes.filter(s => s.type === 'shadow').map(s => {
    const isTemp = (s as any)._temp;
    const center = resolveShadowCenter(s);
    const linkedHighlightId = Array.isArray(s.vertexRefs) ? s.vertexRefs[0] : null;
    const strokeWidth = s.style?.strokeWidth || 3;
    const dash = dashFromStrokePattern(s.style?.strokePattern, strokeWidth);
    const fill = s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.22) : 'transparent';
    const radius = Math.max(1, s.r || DEFAULT_SHADOW_RADIUS);
    const spreadDeg = Math.max(1, Math.min(359, s.spreadDeg || DEFAULT_SHADOW_SPREAD_DEG));
    return (
      <KShape
        key={s.id}
        x={center.x}
        y={center.y}
        draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
        onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
        onDragMove={(e: any) => {
          if (!linkedHighlightId) onDragMove(s.id, e);
        }}
        onDragEnd={(e: any) => {
          if (!linkedHighlightId) return;
          const node = e.target;
          const pos = node.position();
          node.position({ x: center.x, y: center.y });
          const dx = pos.x - center.x;
          const dy = pos.y - center.y;
          setShapes(prev => prev.map((sp) => {
            if (sp.id === linkedHighlightId && sp.type === 'highlight') {
              return { ...sp, x: (sp.x || 0) + dx, y: (sp.y || 0) + dy, plane: undefined as any };
            }
            return sp;
          }));
        }}
        stroke={s.style?.stroke || defaultAnnColor}
        strokeWidth={strokeWidth}
        dash={dash}
        fill={fill}
        listening={!isTemp && !disableNonHighlightHit}
        hitStrokeWidth={16}
        ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        sceneFunc={(ctx, shape) => {
          const halfSpread = (spreadDeg * Math.PI) / 360;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, radius, -halfSpread, halfSpread, false);
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        }}
        rotation={s.rotation || 0}
      />
    );
  });

  const otherNodes = shapes.filter(s => s.type !== 'highlight' && s.type !== 'arrow' && s.type !== 'lob' && s.type !== 'poly' && s.type !== 'text' && s.type !== 'shadow').map(s => {
    const isTemp = (s as any)._temp;
    const strokeWidth = s.style?.strokeWidth || (s.type === 'text' ? 1 : 6);
    const dash = dashFromStrokePattern(s.style?.strokePattern, strokeWidth);
    const common = { x: s.x || 0, y: s.y || 0, rotation: 0, stroke: s.style?.stroke || defaultAnnColor, strokeWidth, dash, listening: !annotationsLocked && !isTemp && !disableNonHighlightHit } as any;
    if (homography && s.plane && s.type === 'box') {
      const w = s.plane.w || 0; const h = s.plane.h || 0;
      const pts = rectPlaneToImagePoints(homography.H, s.plane.cx, s.plane.cy, w, h);
      const fill = s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.3) : 'transparent';
      return (
        <KLine
          key={s.id}
          {...common}
          points={pts}
          closed={true}
          fill={fill}
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragEnd={(e: any) => {
            const node = e.target; const pos = node.position();
            node.position({ x: 0, y: 0 });
            const cen = applyHomography(homography.H, s.plane!.cx, s.plane!.cy);
            const newC = { x: cen.x + pos.x, y: cen.y + pos.y };
            const uv = applyHomographyInv(homography.Hinv, newC.x, newC.y);
            setShapes(prev => prev.map(sp => sp.id === s.id ? { ...sp, plane: { ...sp.plane!, cx: uv.u, cy: uv.v } } : sp));
          }}
          hitStrokeWidth={16}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    } else if (s.type === 'box') {
      const fill = s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.3) : 'transparent';
      return (
        <KRect
          key={s.id}
          {...common}
          width={Math.max(0.5, s.w || 0)}
          height={Math.max(0.5, s.h || 0)}
          fill={fill}
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragMove={(e: any) => onDragMove(s.id, e)}
          hitStrokeWidth={16}
          onTransformEnd={(e: any) => onTransformEnd(s, e)}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    } else if (homography && s.plane && s.type === 'circle') {
      const rx = (s.plane.rx ?? s.plane.r ?? 0);
      const ry = (s.plane.ry ?? s.plane.r ?? 0);
      const pts = ellipsePlaneToImagePoints(homography.H, s.plane.cx, s.plane.cy, rx, ry);
      const fill = s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.3) : 'transparent';
      return (
        <KLine
          key={s.id}
          {...common}
          points={pts}
          closed={true}
          fill={fill}
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragEnd={(e: any) => {
            const node = e.target; const pos = node.position();
            node.position({ x: 0, y: 0 });
            const cen = applyHomography(homography.H, s.plane!.cx, s.plane!.cy);
            const newC = { x: cen.x + pos.x, y: cen.y + pos.y };
            const uv = applyHomographyInv(homography.Hinv, newC.x, newC.y);
            setShapes(prev => prev.map(sp => sp.id === s.id ? { ...sp, plane: { ...sp.plane!, cx: uv.u, cy: uv.v } } : sp));
          }}
          hitStrokeWidth={16}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    } else if (s.type === 'circle') {
      const fill = s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.3) : 'transparent';
      return (
        <KEllipse
          key={s.id}
          {...common}
          radiusX={Math.max(0.5, (s as any).rx ?? (s as any).r ?? 0)}
          radiusY={Math.max(0.5, (s as any).ry ?? (s as any).r ?? 0)}
          fill={fill}
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragMove={(e: any) => onDragMove(s.id, e)}
          hitStrokeWidth={16}
          onTransformEnd={(e: any) => onTransformEnd(s, e)}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    } else if (s.type === 'arrow') {
      const base = s.points || [];
      const ox = s.x || 0;
      const oy = s.y || 0;
      let gx1 = (base[0] ?? 0) + ox;
      let gy1 = (base[1] ?? 0) + oy;
      let gx2 = (base[2] ?? 0) + ox;
      let gy2 = (base[3] ?? 0) + oy;
      const refs = Array.isArray(s.vertexRefs) ? s.vertexRefs : [];
      let startInfo: null | { cx: number; cy: number; rx: number; ry: number } = null;
      let endInfo: null | { cx: number; cy: number; rx: number; ry: number } = null;
      if (refs[0]) {
        const h = shapesById.get(refs[0]);
        if (h && h.type === 'highlight') {
          const cen = getHighlightCenter(h);
          const rx = (h as any).rx ?? 40;
          const ry = (h as any).ry ?? 10;
          gx1 = cen.x; gy1 = cen.y;
          startInfo = { cx: cen.x, cy: cen.y, rx, ry };
        }
      }
      if (refs[1]) {
        const h = shapesById.get(refs[1]);
        if (h && h.type === 'highlight') {
          const cen = getHighlightCenter(h);
          const rx = (h as any).rx ?? 40;
          const ry = (h as any).ry ?? 10;
          gx2 = cen.x; gy2 = cen.y;
          endInfo = { cx: cen.x, cy: cen.y, rx, ry };
        }
      }
      const pushOut = (c: { cx: number; cy: number; rx: number; ry: number }, toward: { x: number; y: number }) => {
        const vx = toward.x - c.cx;
        const vy = toward.y - c.cy;
        const denom = (vx * vx) / ((c.rx * c.rx) || 1e-6) + (vy * vy) / ((c.ry * c.ry) || 1e-6);
        if (denom <= 1e-8) return { x: c.cx, y: c.cy };
        const t = 1 / Math.sqrt(denom);
        const px = c.cx + vx * t;
        const py = c.cy + vy * t;
        const l = Math.hypot(vx, vy) || 1e-6;
        const ux = vx / l;
        const uy = vy / l;
        return { x: px + ux, y: py + uy };
      };
      if (startInfo) {
        const toward = endInfo ? { x: endInfo.cx, y: endInfo.cy } : { x: gx2, y: gy2 };
        const p = pushOut(startInfo, toward);
        gx1 = p.x; gy1 = p.y;
      }
      if (endInfo) {
        const toward = startInfo ? { x: startInfo.cx, y: startInfo.cy } : { x: gx1, y: gy1 };
        const p = pushOut(endInfo, toward);
        gx2 = p.x; gy2 = p.y;
      }
      const pts = [gx1 - ox, gy1 - oy, gx2 - ox, gy2 - oy];
      return (
        <KArrow
          key={s.id}
          {...common}
          points={pts}
          pointerLength={10}
          pointerWidth={10}
          fill={s.style?.stroke || defaultAnnColor}
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragEnd={(e: any) => {
            const node = e.target;
            const pos = node.position();
            node.position({ x: 0, y: 0 });
            const dx = pos.x;
            const dy = pos.y;
            const refSet = new Set(((s.vertexRefs || []) as any[]).filter(Boolean) as string[]);
            setShapes(prev => prev.map(sp => {
              if (sp.id === s.id) {
                const pts0 = sp.points || [];
                const moved = pts0.map((v: number, i: number) => (i % 2 === 0 ? v + dx : v + dy));
                return { ...sp, x: 0, y: 0, points: moved };
              }
              if (refSet.has(sp.id) && sp.type === 'highlight') {
                return { ...sp, x: (sp.x || 0) + dx, y: (sp.y || 0) + dy, plane: undefined as any };
              }
              return sp;
            }));
          }}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={16}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    } else if (s.type === 'poly') {
      const fill = s.closed && s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.3) : 'transparent';
      const basePts = s.points || [];
      let pts = basePts;
      if (Array.isArray(s.vertexRefs) && s.vertexRefs.length * 2 === basePts.length) {
        const out = basePts.slice();
        for (let i = 0; i < s.vertexRefs.length; i++) {
          const refId = s.vertexRefs[i];
          if (!refId) continue;
          const h = shapesById.get(refId);
          if (!h || h.type !== 'highlight') continue;
          const cen = getHighlightCenter(h);
          out[i * 2] = cen.x - (s.x || 0);
          out[i * 2 + 1] = cen.y - (s.y || 0);
        }
        pts = out;
      }
      return (
        <KLine
          key={s.id}
          {...common}
          points={pts}
          closed={!!s.closed}
          fill={fill}
          lineCap="round"
          lineJoin="round"
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragEnd={(e: any) => {
            const node = e.target;
            const pos = node.position();
            node.position({ x: 0, y: 0 });
            const dx = pos.x;
            const dy = pos.y;
            const refSet = new Set((s.vertexRefs || []).filter(Boolean) as string[]);
            setShapes(prev => prev.map(sp => {
              if (sp.id === s.id) {
                const base = sp.points || [];
                const moved = base.map((v: number, i: number) => (i % 2 === 0 ? v + dx : v + dy));
                return { ...sp, x: 0, y: 0, points: moved };
              }
              if (refSet.has(sp.id) && sp.type === 'highlight') {
                return { ...sp, x: (sp.x || 0) + dx, y: (sp.y || 0) + dy, plane: undefined as any };
              }
              return sp;
            }));
          }}
          hitStrokeWidth={16}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    }
    return null;
  });

  const textNodes = shapes.filter(s => s.type === 'text').map(s => {
    const isTemp = (s as any)._temp;
    const textColor = s.style?.stroke || defaultAnnColor;
    const fontSize = s.style?.fontSize || 48;
    const highlight = !!s.style?.textHighlight;
    const outlineColor = contrastStrokeForHex(textColor);
    const outlineWidth = Math.max(2, Math.round(fontSize * 0.18));
    return (
      <KText
        key={s.id}
        x={s.x || 0}
        y={s.y || 0}
        rotation={s.rotation || 0}
        listening={!annotationsLocked && !isTemp && !disableNonHighlightHit}
        text={s.text || ''}
        fontSize={fontSize}
        fontFamily={s.style?.fontFamily || 'Inter, system-ui, sans-serif'}
        draggable={!annotationsLocked && tool !== 'calibrate' && !isSelecting && !(textEdit && textEdit.id === s.id)}
        onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
        onDragMove={(e: any) => onDragMove(s.id, e)}
        fill={textColor}
        strokeEnabled={highlight}
        stroke={highlight ? outlineColor : undefined}
        strokeWidth={highlight ? outlineWidth : 0}
        shadowEnabled={highlight}
        shadowColor={highlight ? outlineColor : undefined}
        shadowBlur={highlight ? 2 : 0}
        shadowOpacity={highlight ? 1 : 0}
        shadowOffsetX={0}
        shadowOffsetY={0}
        hitStrokeWidth={24}
        onDblClick={() => {
          if (!isTightDblClick()) return;
          beginTextEdit(s.id, { isNew: false });
        }}
        onTransformEnd={(e: any) => onTransformEnd(s, e)}
        padding={6}
        ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
      />
    );
  });

  const lineNodes = shapes.filter(s => s.type === 'arrow' || s.type === 'lob' || s.type === 'poly').map(s => {
    const isTemp = (s as any)._temp;
    const strokeWidth = s.style?.strokeWidth || 6;
    const dash = dashFromStrokePattern(s.style?.strokePattern, strokeWidth);
    const common = { x: s.x || 0, y: s.y || 0, rotation: 0, stroke: s.style?.stroke || defaultAnnColor, strokeWidth, dash, listening: !annotationsLocked && !isTemp && !disableNonHighlightHit } as any;
    if (s.type === 'arrow') {
      const base = s.points || [];
      const ox = s.x || 0;
      const oy = s.y || 0;
      let gx1 = (base[0] ?? 0) + ox;
      let gy1 = (base[1] ?? 0) + oy;
      let gx2 = (base[2] ?? 0) + ox;
      let gy2 = (base[3] ?? 0) + oy;
      const refs = Array.isArray(s.vertexRefs) ? s.vertexRefs : [];
      let startInfo: null | { cx: number; cy: number; rx: number; ry: number } = null;
      let endInfo: null | { cx: number; cy: number; rx: number; ry: number } = null;
      if (refs[0]) {
        const h = shapesById.get(refs[0]);
        if (h && h.type === 'highlight') {
          const cen = getHighlightCenter(h);
          const rx = (h as any).rx ?? 40;
          const ry = (h as any).ry ?? 10;
          gx1 = cen.x; gy1 = cen.y;
          startInfo = { cx: cen.x, cy: cen.y, rx, ry };
        }
      }
      if (refs[1]) {
        const h = shapesById.get(refs[1]);
        if (h && h.type === 'highlight') {
          const cen = getHighlightCenter(h);
          const rx = (h as any).rx ?? 40;
          const ry = (h as any).ry ?? 10;
          gx2 = cen.x; gy2 = cen.y;
          endInfo = { cx: cen.x, cy: cen.y, rx, ry };
        }
      }
      const pushOut = (c: { cx: number; cy: number; rx: number; ry: number }, toward: { x: number; y: number }) => {
        const vx = toward.x - c.cx;
        const vy = toward.y - c.cy;
        const denom = (vx * vx) / ((c.rx * c.rx) || 1e-6) + (vy * vy) / ((c.ry * c.ry) || 1e-6);
        if (denom <= 1e-8) return { x: c.cx, y: c.cy };
        const t = 1 / Math.sqrt(denom);
        const px = c.cx + vx * t;
        const py = c.cy + vy * t;
        const l = Math.hypot(vx, vy) || 1e-6;
        const ux = vx / l;
        const uy = vy / l;
        return { x: px + ux, y: py + uy };
      };
      if (startInfo) {
        const toward = endInfo ? { x: endInfo.cx, y: endInfo.cy } : { x: gx2, y: gy2 };
        const p = pushOut(startInfo, toward);
        gx1 = p.x; gy1 = p.y;
      }
      if (endInfo) {
        const toward = startInfo ? { x: startInfo.cx, y: startInfo.cy } : { x: gx1, y: gy1 };
        const p = pushOut(endInfo, toward);
        gx2 = p.x; gy2 = p.y;
      }
      const pts = [gx1 - ox, gy1 - oy, gx2 - ox, gy2 - oy];
      return (
        <KArrow
          key={s.id}
          {...common}
          points={pts}
          pointerLength={10}
          pointerWidth={10}
          fill={s.style?.stroke || defaultAnnColor}
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragEnd={(e: any) => {
            const node = e.target;
            const pos = node.position();
            node.position({ x: 0, y: 0 });
            const dx = pos.x;
            const dy = pos.y;
            const refSet = new Set(((s.vertexRefs || []) as any[]).filter(Boolean) as string[]);
            setShapes(prev => prev.map(sp => {
              if (sp.id === s.id) {
                const pts0 = sp.points || [];
                const moved = pts0.map((v: number, i: number) => (i % 2 === 0 ? v + dx : v + dy));
                return { ...sp, x: 0, y: 0, points: moved };
              }
              if (refSet.has(sp.id) && sp.type === 'highlight') {
                return { ...sp, x: (sp.x || 0) + dx, y: (sp.y || 0) + dy, plane: undefined as any };
              }
              return sp;
            }));
          }}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={16}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    }
    if (s.type === 'lob') {
      const { start, control, end } = resolveLobPoints(s);
      const ox = s.x || 0;
      const oy = s.y || 0;
      const localStart = { x: start.x - ox, y: start.y - oy };
      const localControl = { x: control.x - ox, y: control.y - oy };
      const localEnd = { x: end.x - ox, y: end.y - oy };
      return (
        <KShape
          key={s.id}
          x={ox}
          y={oy}
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          stroke={s.style?.stroke || defaultAnnColor}
          strokeWidth={strokeWidth}
          dash={dash}
          fill={s.style?.stroke || defaultAnnColor}
        listening={!annotationsLocked && !isTemp && !disableNonHighlightHit}
          hitStrokeWidth={16}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
          onDragEnd={(e: any) => {
            const node = e.target;
            const pos = node.position();
            node.position({ x: 0, y: 0 });
            const dx = pos.x;
            const dy = pos.y;
            const refSet = new Set(((s.vertexRefs || []) as any[]).filter(Boolean) as string[]);
            setShapes(prev => prev.map(sp => {
              if (sp.id === s.id) {
                const pts0 = sp.points || [];
                const moved = pts0.map((v: number, i: number) => (i % 2 === 0 ? v + dx : v + dy));
                return { ...sp, x: 0, y: 0, points: moved };
              }
              if (refSet.has(sp.id) && sp.type === 'highlight') {
                return { ...sp, x: (sp.x || 0) + dx, y: (sp.y || 0) + dy, plane: undefined as any };
              }
              return sp;
            }));
          }}
          sceneFunc={(ctx, shape) => {
            ctx.beginPath();
            ctx.moveTo(localStart.x, localStart.y);
            ctx.quadraticCurveTo(localControl.x, localControl.y, localEnd.x, localEnd.y);
            ctx.strokeShape(shape);

            const tx = localEnd.x - localControl.x;
            const ty = localEnd.y - localControl.y;
            const len = Math.hypot(tx, ty) || 1;
            const ux = tx / len;
            const uy = ty / len;
            const px = -uy;
            const py = ux;
            const headLength = Math.max(10, strokeWidth * 2.2);
            const headWidth = Math.max(8, strokeWidth * 1.6);
            const baseX = localEnd.x - ux * headLength;
            const baseY = localEnd.y - uy * headLength;
            ctx.beginPath();
            ctx.moveTo(localEnd.x, localEnd.y);
            ctx.lineTo(baseX + px * headWidth * 0.5, baseY + py * headWidth * 0.5);
            ctx.lineTo(baseX - px * headWidth * 0.5, baseY - py * headWidth * 0.5);
            ctx.closePath();
            ctx.fillStrokeShape(shape);
          }}
        />
      );
    }
    if (s.type === 'poly') {
      const fill = s.closed && s.style?.fill && s.style.fill !== 'transparent' ? hexToRgba(s.style.fill, s.style?.fillOpacity ?? 0.3) : 'transparent';
      const basePts = s.points || [];
      let pts = basePts;
      if (Array.isArray(s.vertexRefs) && s.vertexRefs.length * 2 === basePts.length) {
        const out = basePts.slice();
        for (let i = 0; i < s.vertexRefs.length; i++) {
          const refId = s.vertexRefs[i];
          if (!refId) continue;
          const h = shapesById.get(refId);
          if (!h || h.type !== 'highlight') continue;
          const cen = getHighlightCenter(h);
          out[i * 2] = cen.x - (s.x || 0);
          out[i * 2 + 1] = cen.y - (s.y || 0);
        }
        pts = out;
      }
      return (
        <KLine
          key={s.id}
          {...common}
          points={pts}
          closed={!!s.closed}
          fill={fill}
          lineCap="round"
          lineJoin="round"
          draggable={!annotationsLocked && tool !== 'calibrate' && !isTemp && !isSelecting}
          onMouseDown={(e: any) => onShapeMouseDown(s.id, e)}
          onDragEnd={(e: any) => {
            const node = e.target;
            const pos = node.position();
            node.position({ x: 0, y: 0 });
            const dx = pos.x;
            const dy = pos.y;
            const refSet = new Set((s.vertexRefs || []).filter(Boolean) as string[]);
            setShapes(prev => prev.map(sp => {
              if (sp.id === s.id) {
                const base0 = sp.points || [];
                const moved = base0.map((v: number, i: number) => (i % 2 === 0 ? v + dx : v + dy));
                return { ...sp, x: 0, y: 0, points: moved };
              }
              if (refSet.has(sp.id) && sp.type === 'highlight') {
                return { ...sp, x: (sp.x || 0) + dx, y: (sp.y || 0) + dy, plane: undefined as any };
              }
              return sp;
            }));
          }}
          hitStrokeWidth={16}
          ref={s.id === selectedId ? (node: any) => { selectedNodeRef.current = node; } : undefined}
        />
      );
    }
    return null;
  });

  return (
    <div ref={hostRef} className="absolute inset-0">
      {textEdit && (() => {
        const s = shapes.find(x => x.id === textEdit.id);
        if (!s || s.type !== 'text') return null;
        const left = (s.x || 0) * stageScale + stageOffset.x;
        const top = (s.y || 0) * stageScale + stageOffset.y;
        const fontSize = (s.style?.fontSize || 48) * stageScale;
        const fontFamily = s.style?.fontFamily || 'Inter, system-ui, sans-serif';
        const color = s.style?.stroke || defaultAnnColor;
        return (
          <textarea
            ref={textAreaRef}
            value={textEdit.value}
            onChange={(e) => setTextEdit(prev => prev ? { ...prev, value: e.target.value } : prev)}
            onBlur={() => commitTextEdit()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelTextEdit();
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitTextEdit();
              }
            }}
            style={{
              position: 'absolute',
              left,
              top,
              minWidth: 120 * stageScale,
              maxWidth: Math.max(50, size.w - left - 12),
              minHeight: 40 * stageScale,
              padding: 6 * stageScale,
              border: '1px solid rgba(59,130,246,0.85)',
              borderRadius: 6,
              outline: 'none',
              background: 'rgba(255,255,255,0.92)',
              color,
              fontSize,
              fontFamily,
              lineHeight: 1.25,
              zIndex: 50,
              resize: 'both',
            }}
          />
        );
      })()}
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={stageOffset.x}
        y={stageOffset.y}
        scaleX={stageScale}
        scaleY={stageScale}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onDblClick={onDblClick}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={(e: any) => {
          const evt = (e && (e.evt || e)) as any;
          if (evt?.preventDefault) evt.preventDefault();
          if (isDrawing || arrowTempRef.current?.start || lobTempRef.current?.start || polyTempRef.current) cancelDrawing();
        }}
      >
        <Layer listening={false}>
          {backgroundMedia && (
            <KImage image={backgroundMedia as any} x={0} y={0} width={imageInfo.width} height={imageInfo.height} />
          )}
        </Layer>
        {tool === 'calibrate' && !annotationsLocked && (
          <Layer listening={false}>
            {(() => {
              const pts = [...calibPoints];
              if (calibHover && pts.length < 4) pts.push(calibHover);
              if (pts.length >= 2) {
                const flat = pts.map(pt => [pt.x, pt.y]).flat() as number[];
                const closed = pts.length >= 4;
                return (
                  <KLine points={flat} stroke="#60a5fa" strokeWidth={2} closed={closed} opacity={0.9} />
                );
              }
              return null;
            })()}
            {calibPoints.map((pt, i) => (
              <KCircle key={`cal_${i}`} x={pt.x} y={pt.y} radius={4} fill="#60a5fa" />
            ))}
          </Layer>
        )}
        {showAnnotations && (
          <Layer>
            {shadowNodes}
          </Layer>
        )}
        {showAnnotations && (
          <Layer>
            {otherNodes}
          </Layer>
        )}
        {showAnnotations && (
          <Layer>
            {lineNodes}
            {occluderNodes}
          </Layer>
        )}
        {showAnnotations && (
          <Layer>
            {highlightNodes}
          </Layer>
        )}
        <Layer listening={false}>
          {!backgroundVideoElement && foregroundCutout && (
            <KImage image={foregroundCutout} x={0} y={0} width={imageInfo.width} height={imageInfo.height} />
          )}
        </Layer>
        {showAnnotations && (
          <Layer>
            {textNodes}
          </Layer>
        )}
        {showAnnotations && (
          <Layer>
            {selectedIds.length > 0 && selectedIds.map(id => {
              const s = shapes.find(sh => sh.id === id);
              if (!s) return null;
              const b = getShapeBounds(s);
              return (
                <KRect
                  key={`selbox_${id}`}
                  x={b.x}
                  y={b.y}
                  width={Math.max(0, b.w)}
                  height={Math.max(0, b.h)}
                  stroke="#60a5fa"
                  dash={[4,4]}
                  strokeWidth={1.5}
                  listening={false}
                />
              );
            })}
            {selectedId && (() => {
              const selectedShape = shapes.find((s) => s.id === selectedId);
              if (!selectedShape || selectedShape.type !== 'lob') return null;
              const { start, control, end } = resolveLobPoints(selectedShape);
              return (
                <>
                  <KLine
                    points={[start.x, start.y, control.x, control.y, end.x, end.y]}
                    stroke="#60a5fa"
                    dash={[4, 4]}
                    strokeWidth={1.5}
                    listening={false}
                  />
                  <KCircle
                    x={control.x}
                    y={control.y}
                    radius={7}
                    fill="#60a5fa"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    draggable={!annotationsLocked && tool !== 'calibrate' && !isSelecting}
                    onDragMove={(e: any) => {
                      const pos = e.target.position();
                      setShapes(prev => prev.map((s) => {
                        if (s.id !== selectedShape.id) return s;
                        const pts = s.points ? s.points.slice() : [0, 0, 0, 0, 0, 0];
                        pts[2] = pos.x;
                        pts[3] = pos.y;
                        return { ...s, points: pts, x: 0, y: 0 };
                      }));
                    }}
                  />
                </>
              );
            })()}
            {selectedId && (selectedIds.length <= 1) && !annotationsLocked && (
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                anchorSize={10}
                enabledAnchors={((): any => {
                  const sh = shapes.find(s => s.id === selectedId);
                  if (!sh) return [];
                  if (sh.type === 'arrow' || sh.type === 'lob' || sh.type === 'poly' || sh.type === 'shadow') return [];
                  if (homography && sh.plane && (sh.type === 'box' || sh.type === 'circle' || sh.type === 'highlight')) return [];
                  return undefined;
                })()}
              />
            )}
          </Layer>
        )}
      </Stage>
      {ioError && (
        <div className="panel absolute right-2 bottom-2 p-2 min-w-[260px]">
          <strong>Save Error</strong>
          <div className="status mt-1.5">{ioError}</div>
          <div className="toolbar mt-2 flex gap-2">
            <button onClick={() => { setIoError(null); void performSave(); }}>Retry Save</button>
          </div>
        </div>
      )}
      {calibrating && !annotationsLocked && (
        <div className="panel absolute left-2 top-2 p-2 min-w-[220px]">
          <strong>Define Pitch</strong>
          <div className="status mt-1.5">Click 4 corners: TL, TR, BR, BL</div>
          <div className="toolbar mt-2">
            <button onClick={() => setCalibPoints([])}>Reset</button>
          </div>
        </div>
      )}
      {isSelecting && selRect && (
        <div className="absolute inset-0 pointer-events-none">
          <svg width="100%" height="100%" className="absolute inset-0">
            <rect x={selRect.x * stageScale + stageOffset.x} y={selRect.y * stageScale + stageOffset.y} width={selRect.w * stageScale} height={selRect.h * stageScale} fill="rgba(59,130,246,0.15)" stroke="#60a5fa" strokeDasharray="4,4" />
          </svg>
        </div>
      )}
      {showAnnotations && (selectedId || (selectedIds && selectedIds.length > 0)) && (
        <div className="panel absolute right-2 top-2 p-2 min-w-[220px]">
          <strong>Inspector</strong>
          <div className="status">ID: {(selectedId || selectedIds[0]).slice(0, 8)}</div>
          {(() => {
            const idSet = (selectedIds && selectedIds.length > 0) ? new Set(selectedIds) : new Set(selectedId ? [selectedId] : []);
            const selShapes = shapes.filter(s => idSet.has(s.id));
            const first = selShapes[0];

            const isFillCapable = (s: Shape) => (
              s.type === 'box' || s.type === 'circle' || s.type === 'highlight' || s.type === 'shadow' || (s.type === 'poly' && !!(s as any).closed)
            );

            const fillSample = selShapes.find(isFillCapable);
            const anyFill = !!fillSample;
            const textSample = selShapes.find(s => s.type === 'text');
            const anyText = !!textSample;

            return (
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                <label className="status">Stroke</label>
                <input type="color" onChange={(e) => {
                  const v = e.target.value;
                  setShapes(prev => prev.map(s => idSet.has(s.id) ? { ...s, style: { ...s.style, stroke: v } } : s));
                }} value={first?.style?.stroke || defaultAnnColor} />

                <label className="status">Width</label>
                <input type="number" min={1} max={16} step={1} onChange={(e) => {
                  const v = Math.max(1, Math.min(16, Number(e.target.value) || 1));
                  setShapes(prev => prev.map(s => idSet.has(s.id) ? { ...s, style: { ...s.style, strokeWidth: v } } : s));
                }} value={(first?.style?.strokeWidth ?? 4)} />

                <label className="status">Style</label>
                <select value={(() => {
                  const pats = new Set(shapes.filter(s => idSet.has(s.id)).map(s => s.style?.strokePattern || 'solid'));
                  return pats.size === 1 ? Array.from(pats)[0] : 'solid';
                })()} onChange={(e) => {
                  const v = (e.target.value || 'solid') as any;
                  setShapes(prev => prev.map(s => {
                    if (!idSet.has(s.id)) return s;
                    if (s.type === 'text') return s;
                    return { ...s, style: { ...s.style, strokePattern: v } };
                  }));
                }}>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                  <option value="dashdot">Dash-dot</option>
                </select>

                {anyFill && (
                  <>
                    <label className="status">Fill</label>
                    <input type="color" onChange={(e) => {
                      const v = e.target.value;
                      setShapes(prev => prev.map(s => {
                        if (!idSet.has(s.id)) return s;
                        if (!isFillCapable(s)) return s;
                        return { ...s, style: { ...s.style, fill: v } };
                      }));
                    }} value={fillSample?.style?.fill || fillSample?.style?.stroke || defaultAnnColor} />

                    <label className="status">Fill Opacity</label>
                    <input type="range" min={0} max={100} step={1} onChange={(e) => {
                      const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100;
                      setShapes(prev => prev.map(s => {
                        if (!idSet.has(s.id)) return s;
                        if (!isFillCapable(s)) return s;
                        return { ...s, style: { ...s.style, fillOpacity: v } };
                      }));
                    }} value={Math.round(((fillSample?.style?.fillOpacity ?? 0.3) * 100))} />
                  </>
                )}

                {anyText && (
                  <>
                    <label className="status">Font</label>
                    <input type="number" min={1} max={300} step={1} onChange={(e) => {
                      const v = Math.max(1, Math.min(300, Number(e.target.value) || 48));
                      setShapes(prev => prev.map(s => {
                        if (!idSet.has(s.id)) return s;
                        if (s.type !== 'text') return s;
                        return { ...s, style: { ...s.style, fontSize: v } };
                      }));
                    }} value={textSample?.style?.fontSize || 48} />

                    <label className="status">Highlight</label>
                    <input type="checkbox" onChange={(e) => {
                      const v = !!e.target.checked;
                      setShapes(prev => prev.map(s => {
                        if (!idSet.has(s.id)) return s;
                        if (s.type !== 'text') return s;
                        return { ...s, style: { ...s.style, textHighlight: v } };
                      }));
                    }} checked={(() => {
                      const vals = new Set(selShapes.filter(s => s.type === 'text').map(s => !!s.style?.textHighlight));
                      return vals.size === 1 ? vals.has(true) : false;
                    })()} />
                  </>
                )}

                {selShapes.length === 1 && first?.type === 'shadow' && (
                  <>
                    <label className="status">Radius</label>
                    <input type="number" min={1} max={2000} step={1} onChange={(e) => {
                      const v = Math.max(1, Number(e.target.value) || DEFAULT_SHADOW_RADIUS);
                      setShapes(prev => prev.map(s => s.id === first.id ? { ...s, r: v } : s));
                    }} value={Math.round(first.r || DEFAULT_SHADOW_RADIUS)} />

                    <label className="status">Spread</label>
                    <input type="range" min={5} max={180} step={1} onChange={(e) => {
                      const v = Math.max(5, Math.min(180, Number(e.target.value) || DEFAULT_SHADOW_SPREAD_DEG));
                      setShapes(prev => prev.map(s => s.id === first.id ? { ...s, spreadDeg: v } : s));
                    }} value={Math.round(first.spreadDeg || DEFAULT_SHADOW_SPREAD_DEG)} />
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
