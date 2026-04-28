"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import ColorLinkToggle from "../../../components/annotate/ColorLinkToggle";
import type { Tool, StrokePattern } from "../../../components/annotate/Editor";
import { useProject } from "../../../lib/state/ProjectContext";
import {
  buildAnnotationPath,
  createEmptyAnnotations,
  deleteAnnotationDocument,
  listAnnotationEntriesForStillWithDefault,
  readAnnotationDocument,
  sortAnnotationEntries,
  writeAnnotationDocument,
} from "../../../lib/fs/annotationStorage";
import type { ProjectAnnotationIndexEntry } from "../../../lib/types/project";
import { writeManifest } from "../../../lib/fs/projectFolder";
import { validateProjectFolderStructure } from "../../../lib/fs/projectFolder";
import {
  registerVideoFile,
  requestHomography,
  unregisterVideoRef,
} from "../../../lib/clip/sidecarClient";
import type { HomographyFrame } from "../../../lib/fs/homographyCache";
import { resolveUsableHomographyAtTime } from "../../../lib/clip/homographyInterpolation";
import { projectPitchBoundsToPerspectiveQuad } from "../../../lib/annotate/pitchCalibration";

export default function AnnotatePage({ params }: { params: { stillId: string } }) {
  const { stillId } = params;
  const { projectDir, setProjectDir, manifest, setManifest } = useProject();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [strokePattern, setStrokePattern] = useState<StrokePattern>('solid');
  const [defaultColor, setDefaultColor] = useState<string>('#000000');
  const [defaultStrokeWidth, setDefaultStrokeWidth] = useState<number>(6);
  const [defaultFill, setDefaultFill] = useState<string>('#000000');
  const [defaultColorsLinked, setDefaultColorsLinked] = useState(true);
  const [defaultFillOpacity, setDefaultFillOpacity] = useState<number>(0.3);
  const [defaultFontSize, setDefaultFontSize] = useState<number>(48);
  const [defaultTextHighlight, setDefaultTextHighlight] = useState<boolean>(false);
  const [enableForegroundOcclusion, setEnableForegroundOcclusion] = useState(false);
  const [occlusionMethod, setOcclusionMethod] = useState<'edge' | 'ml'>('edge');
  const [saveTick, setSaveTick] = useState(0);
  const [saveStatus, setSaveStatus] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string } | null>(null);
  const [writePermission, setWritePermission] = useState<'granted' | 'denied' | 'prompt' | null>(null);
  const [isCreatingAnnotationSet, setIsCreatingAnnotationSet] = useState(false);
  const [isRenamingAnnotationSet, setIsRenamingAnnotationSet] = useState(false);
  const [newAnnotationLabel, setNewAnnotationLabel] = useState('');
  const [renameAnnotationLabel, setRenameAnnotationLabel] = useState('');
  const [isComputingHomography, setIsComputingHomography] = useState(false);
  const [homographyStatus, setHomographyStatus] = useState<string | null>(null);
  const [autoPerspectiveQuad, setAutoPerspectiveQuad] = useState<Array<{ x: number; y: number }> | null>(null);
  const [autoPerspectiveTick, setAutoPerspectiveTick] = useState(0);
  const [sidecarVideoRef, setSidecarVideoRef] = useState<string | null>(null);
  const [sidecarVideoError, setSidecarVideoError] = useState<string | null>(null);
  const [sourceVideoUrl, setSourceVideoUrl] = useState<string | null>(null);
  const [sourceVideoError, setSourceVideoError] = useState<string | null>(null);
  const [previewTimeMs, setPreviewTimeMs] = useState<number | null>(null);
  const [previewFrameTick, setPreviewFrameTick] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const activeSidecarVideoRef = useRef<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const previewDirectionRef = useRef<-1 | 0 | 1>(0);
  const previewLastTsRef = useRef<number | null>(null);
  const lastSyncedPreviewMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!saveStatus) return;
    if (saveStatus.state === 'saving' || saveStatus.state === 'error') return;
    const ms = saveStatus.message === 'already_saved' ? 1000 : 1200;
    const t = window.setTimeout(() => setSaveStatus(null), ms);
    return () => window.clearTimeout(t);
  }, [saveStatus]);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const offsetStartRef = useRef<{ x: number; y: number } | null>(null);

  const still = useMemo(() => {
    if (!manifest) return null;
    return (manifest.stills || []).find(s => s.id === stillId) || null;
  }, [manifest, stillId]);

  const annotationEntries = useMemo(() => {
    if (!manifest) return [];
    return listAnnotationEntriesForStillWithDefault(manifest, stillId);
  }, [manifest, stillId]);

  const selectedAnnotationId = useMemo(() => {
    const requested = searchParams?.get('annotation');
    if (requested && annotationEntries.some((entry) => entry.id === requested)) {
      return requested;
    }
    return annotationEntries[0]?.id ?? 'default';
  }, [annotationEntries, searchParams]);

  const selectedAnnotationEntry = useMemo(() => {
    return annotationEntries.find((entry) => entry.id === selectedAnnotationId) ?? null;
  }, [annotationEntries, selectedAnnotationId, stillId]);

  const effectiveSelectedAnnotationEntry = useMemo(() => {
    return selectedAnnotationEntry ?? annotationEntries[0] ?? {
      stillId,
      id: 'default',
      file: buildAnnotationPath(stillId, 'default'),
      role: 'default' as const,
      label: 'Default annotations',
    };
  }, [selectedAnnotationEntry, annotationEntries, stillId]);

  const selectedAnnotationLabel = selectedAnnotationEntry?.label
    || (selectedAnnotationEntry?.id === 'default'
      ? 'Default annotations'
      : selectedAnnotationEntry
        ? `Annotation set ${selectedAnnotationEntry.id}`
        : 'Default annotations');

  const setSelectedAnnotation = useCallback((annotationId: string) => {
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
    if (!annotationId || annotationId === 'default') {
      nextParams.delete('annotation');
    } else {
      nextParams.set('annotation', annotationId);
    }
    const query = nextParams.toString();
    router.replace(query ? `/annotate/${stillId}?${query}` : `/annotate/${stillId}`);
  }, [router, searchParams, stillId]);

  useEffect(() => {
    if (!selectedAnnotationEntry) return;
    setRenameAnnotationLabel(selectedAnnotationEntry.label || (selectedAnnotationEntry.id === 'default' ? 'Default annotations' : ''));
  }, [selectedAnnotationEntry]);

  const createAnnotationSet = useCallback(async () => {
    if (!projectDir || !manifest || !still) return;
    const label = newAnnotationLabel.trim() || `Annotation set ${annotationEntries.filter((entry) => entry.id !== 'default').length + 1}`;
    const annotationId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
      ? `ann_${(globalThis.crypto as any).randomUUID().slice(0, 8)}`
      : `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const file = buildAnnotationPath(stillId, annotationId);
    const document = createEmptyAnnotations(still, annotationId);
    document.label = label;
    const entry: ProjectAnnotationIndexEntry = {
      stillId,
      id: annotationId,
      file,
      role: 'alternate',
      label,
      lastModified: new Date().toISOString(),
    };
    try {
      await writeAnnotationDocument(projectDir, file, document);
      const nextManifest = {
        ...manifest,
        annotations: sortAnnotationEntries([...(manifest.annotations || []), entry]),
      };
      await writeManifest(projectDir, nextManifest);
      setManifest(nextManifest);
      setNewAnnotationLabel('');
      setIsCreatingAnnotationSet(false);
      setSelectedAnnotation(annotationId);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [projectDir, manifest, still, newAnnotationLabel, annotationEntries, stillId, setManifest, setSelectedAnnotation]);

  const renameSelectedAnnotationSet = useCallback(async () => {
    if (!projectDir || !manifest || !selectedAnnotationEntry || !still) return;
    const nextLabel = renameAnnotationLabel.trim() || (selectedAnnotationEntry.id === 'default' ? 'Default annotations' : `Annotation set ${selectedAnnotationEntry.id}`);
    try {
      const existingDocument = await readAnnotationDocument(projectDir, selectedAnnotationEntry.file);
      if (existingDocument) {
        await writeAnnotationDocument(projectDir, selectedAnnotationEntry.file, {
          ...existingDocument,
          annotationId: existingDocument.annotationId || selectedAnnotationEntry.id,
          label: nextLabel,
        });
      }
      const updatedEntry: ProjectAnnotationIndexEntry = {
        ...selectedAnnotationEntry,
        label: nextLabel,
        lastModified: new Date().toISOString(),
      };
      const remaining = (manifest.annotations || []).filter((entry) => entry.file !== selectedAnnotationEntry.file);
      const nextManifest = {
        ...manifest,
        annotations: sortAnnotationEntries([...remaining, updatedEntry]),
      };
      await writeManifest(projectDir, nextManifest);
      setManifest(nextManifest);
      setIsRenamingAnnotationSet(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [projectDir, manifest, selectedAnnotationEntry, still, renameAnnotationLabel, setManifest]);

  const deleteSelectedAnnotationSet = useCallback(async () => {
    if (!projectDir || !manifest || !selectedAnnotationEntry) return;
    if (selectedAnnotationEntry.id === 'default') {
      setError('Default annotations cannot be deleted.');
      return;
    }
    try {
      await deleteAnnotationDocument(projectDir, selectedAnnotationEntry.file).catch(() => {});
      const nextManifest = {
        ...manifest,
        annotations: (manifest.annotations || []).filter((entry) => entry.file !== selectedAnnotationEntry.file),
      };
      await writeManifest(projectDir, nextManifest);
      setManifest(nextManifest);
      setIsRenamingAnnotationSet(false);
      setRenameAnnotationLabel('');
      setSelectedAnnotation('default');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [projectDir, manifest, selectedAnnotationEntry, setManifest, setSelectedAnnotation]);

  const Editor = useMemo(() => dynamic(() => import("../../../components/annotate/Editor"), { ssr: false }), []);

  const getFileForPath = useCallback(async (dir: FileSystemDirectoryHandle, path: string) => {
    const parts = path.split('/').filter(Boolean);
    let cur: FileSystemDirectoryHandle = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: false });
    }
    const fh = await cur.getFileHandle(parts[parts.length - 1], { create: false });
    return await fh.getFile();
  }, []);

  const getFileUrlForPath = useCallback(async (dir: FileSystemDirectoryHandle, path: string) => {
    const file = await getFileForPath(dir, path);
    return URL.createObjectURL(file);
  }, [getFileForPath]);

  // Persist and restore the chosen project directory handle using IndexedDB
  const openDB = useCallback((): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('annotate-db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }, []);

  const saveProjectHandle = useCallback(async (handle: FileSystemDirectoryHandle) => {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle as any, 'project');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
      });
    } catch {
      // ignore persistence errors
    }
  }, [openDB]);

  const loadProjectHandle = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const db = await openDB();
      const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('project');
        req.onsuccess = () => { const v = req.result as FileSystemDirectoryHandle | undefined; db.close(); resolve(v || null); };
        req.onerror = () => { const err = req.error; db.close(); reject(err); };
      });
      return handle;
    } catch {
      return null;
    }
  }, [openDB]);

  // Attempt to auto-restore a previously opened project folder on mount
  useEffect(() => {
    (async () => {
      if (projectDir || manifest) return;
      try {
        const handle = await loadProjectHandle();
        if (!handle) return;
        const anyHandle: any = handle as any;
        const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
        if (q !== 'granted') return;
        const v = await validateProjectFolderStructure(handle);
        if (v.ok) {
          setProjectDir(handle);
          setManifest(v.manifest);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, [projectDir, manifest, loadProjectHandle, setProjectDir, setManifest]);

  useEffect(() => {
    (async () => {
      if (!projectDir) { setWritePermission(null); return; }
      try {
        const anyHandle: any = projectDir as any;
        const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'readwrite' }) : 'granted');
        setWritePermission(q);
      } catch {
        setWritePermission(null);
      }
    })();
  }, [projectDir]);

  const imageInfo = useMemo(() => ({
    file: still?.file || "",
    width: still?.width || imgSize?.w || 0,
    height: still?.height || imgSize?.h || 0,
  }), [still, imgSize]);

  const sourceVideoPath = useMemo(() => {
    if (!manifest || !still) return null;
    return manifest.videos.find((video) => video.id === still.videoId)?.file || null;
  }, [manifest, still]);

  const annotationTimeMs = still?.t_ms ?? 0;
  const previewBounds = useMemo(() => {
    const startMs = Math.max(0, annotationTimeMs - 5000);
    const unclampedEndMs = annotationTimeMs + 5000;
    const endMs = videoDurationMs != null ? Math.max(startMs, Math.min(videoDurationMs, unclampedEndMs)) : unclampedEndMs;
    return { startMs, endMs };
  }, [annotationTimeMs, videoDurationMs]);

  const clampPreviewMs = useCallback((rawMs: number, durationOverrideMs?: number | null) => {
    const startMs = Math.max(0, annotationTimeMs - 5000);
    const unclampedEndMs = annotationTimeMs + 5000;
    const durationMs = durationOverrideMs ?? videoDurationMs;
    const endMs = durationMs != null ? Math.max(startMs, Math.min(durationMs, unclampedEndMs)) : unclampedEndMs;
    return Math.max(startMs, Math.min(endMs, rawMs));
  }, [annotationTimeMs, videoDurationMs]);

  const previewAtAnnotationFrame = previewTimeMs == null || Math.abs(previewTimeMs - annotationTimeMs) <= 8;
  const annotationsLocked = !!sourceVideoUrl && previewReady && !previewAtAnnotationFrame;
  const previewVideoActive = annotationsLocked;

  const canAutoCalibrate = !!(projectDir && still && sourceVideoPath && sidecarVideoRef);

  useEffect(() => {
    (async () => {
      if (!projectDir || !still) return;
      try {
        const anyHandle: any = projectDir as any;
        const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
        if (q !== 'granted') { setError('Folder permission not granted'); return; }
        const url = await getFileUrlForPath(projectDir, still.file);
        const w = still.width || 0;
        const h = still.height || 0;
        setImgSize({ w, h });
        setImgUrl(url);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, [projectDir, still?.file, still?.width, still?.height, getFileUrlForPath]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!projectDir || !sourceVideoPath) {
        setSourceVideoUrl(null);
        setSourceVideoError(null);
        setPreviewReady(false);
        setPreviewTimeMs(null);
        setVideoDurationMs(null);
        return;
      }

      try {
        const url = await getFileUrlForPath(projectDir, sourceVideoPath);
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        setSourceVideoUrl(url);
        setSourceVideoError(null);
        setPreviewReady(false);
        setPreviewTimeMs(null);
        setVideoDurationMs(null);
      } catch (e: any) {
        if (!active) return;
        setSourceVideoUrl(null);
        setSourceVideoError(e?.message || 'Failed to load source video');
        setPreviewReady(false);
        setPreviewTimeMs(null);
        setVideoDurationMs(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [projectDir, sourceVideoPath, getFileUrlForPath]);

  // Revoke previous object URL when imgUrl changes (prevents revoking the current one too early)
  useEffect(() => {
    return () => { if (imgUrl) URL.revokeObjectURL(imgUrl); };
  }, [imgUrl]);

  useEffect(() => {
    return () => { if (sourceVideoUrl) URL.revokeObjectURL(sourceVideoUrl); };
  }, [sourceVideoUrl]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!projectDir || !sourceVideoPath) {
        const prev = activeSidecarVideoRef.current;
        activeSidecarVideoRef.current = null;
        if (prev) {
          await unregisterVideoRef(prev).catch(() => {});
        }
        setSidecarVideoRef(null);
        setSidecarVideoError(null);
        return;
      }

      try {
        const file = await getFileForPath(projectDir, sourceVideoPath);
        const reg = await registerVideoFile(file);

        if (!active) {
          await unregisterVideoRef(reg.videoRef).catch(() => {});
          return;
        }

        const prev = activeSidecarVideoRef.current;
        activeSidecarVideoRef.current = reg.videoRef;
        setSidecarVideoRef(reg.videoRef);
        setSidecarVideoError(null);
        if (prev && prev !== reg.videoRef) {
          await unregisterVideoRef(prev).catch(() => {});
        }
      } catch (e: any) {
        if (!active) return;
        const prev = activeSidecarVideoRef.current;
        activeSidecarVideoRef.current = null;
        if (prev) {
          await unregisterVideoRef(prev).catch(() => {});
        }
        setSidecarVideoRef(null);
        setSidecarVideoError(e?.message || 'Failed to register source video with sidecar');
      }
    })();

    return () => {
      active = false;
    };
  }, [projectDir, sourceVideoPath, getFileForPath]);

  useEffect(() => {
    return () => {
      const ref = activeSidecarVideoRef.current;
      if (ref) {
        void unregisterVideoRef(ref).catch(() => {});
        activeSidecarVideoRef.current = null;
      }
    };
  }, []);

  const syncPreviewFrame = useCallback((force = false) => {
    const video = previewVideoRef.current;
    if (!video) return;
    const nextMs = clampPreviewMs(Math.round(video.currentTime * 1000), videoDurationMs);
    if (!force && lastSyncedPreviewMsRef.current != null && Math.abs(nextMs - lastSyncedPreviewMsRef.current) < 25) {
      return;
    }
    lastSyncedPreviewMsRef.current = nextMs;
    setPreviewTimeMs(nextMs);
    setPreviewFrameTick((tick) => tick + 1);
  }, [clampPreviewMs, videoDurationMs]);

  const stopPreviewPlayback = useCallback((snapToMs?: number | null) => {
    previewDirectionRef.current = 0;
    previewLastTsRef.current = null;
    if (previewRafRef.current != null) {
      window.cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
    const video = previewVideoRef.current;
    if (!video) return;
    video.pause();
    if (snapToMs != null) {
      const clamped = clampPreviewMs(snapToMs, videoDurationMs);
      if (Math.abs(video.currentTime * 1000 - clamped) > 6) {
        video.currentTime = clamped / 1000;
      }
    }
    syncPreviewFrame(true);
  }, [clampPreviewMs, syncPreviewFrame, videoDurationMs]);

  const startPreviewPlayback = useCallback((direction: -1 | 1) => {
    const video = previewVideoRef.current;
    if (!video || !previewReady) return;
    if (previewDirectionRef.current === direction) return;
    stopPreviewPlayback();
    previewDirectionRef.current = direction;
    previewLastTsRef.current = null;

    if (direction > 0) {
      if (video.currentTime * 1000 >= previewBounds.endMs - 8) {
        video.currentTime = previewBounds.endMs / 1000;
        syncPreviewFrame(true);
        return;
      }
      video.playbackRate = 1;
      void video.play().catch(() => {});
      const tick = () => {
        if (previewDirectionRef.current !== 1) return;
        if (video.currentTime * 1000 >= previewBounds.endMs - 8) {
          stopPreviewPlayback(previewBounds.endMs);
          return;
        }
        syncPreviewFrame();
        previewRafRef.current = window.requestAnimationFrame(tick);
      };
      previewRafRef.current = window.requestAnimationFrame(tick);
      return;
    }

    video.pause();
    const tick = (ts: number) => {
      if (previewDirectionRef.current !== -1) return;
      const prevTs = previewLastTsRef.current ?? ts;
      previewLastTsRef.current = ts;
      const deltaMs = Math.max(0, ts - prevTs);
      const nextMs = clampPreviewMs(video.currentTime * 1000 - deltaMs, videoDurationMs);
      video.currentTime = nextMs / 1000;
      syncPreviewFrame();
      if (nextMs <= previewBounds.startMs + 1) {
        stopPreviewPlayback(previewBounds.startMs);
        return;
      }
      previewRafRef.current = window.requestAnimationFrame(tick);
    };
    previewRafRef.current = window.requestAnimationFrame(tick);
  }, [clampPreviewMs, previewBounds.endMs, previewBounds.startMs, previewReady, stopPreviewPlayback, syncPreviewFrame, videoDurationMs]);

  const returnToAnnotationFrame = useCallback(() => {
    stopPreviewPlayback(annotationTimeMs);
  }, [annotationTimeMs, stopPreviewPlayback]);

  useEffect(() => {
    const handlePointerRelease = () => {
      if (previewDirectionRef.current !== 0) {
        stopPreviewPlayback();
      }
    };
    const handleWindowBlur = () => {
      if (previewDirectionRef.current !== 0) {
        stopPreviewPlayback();
      }
    };
    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [stopPreviewPlayback]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === ' ') {
        e.preventDefault();
        returnToAnnotationFrame();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        startPreviewPlayback(-1);
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        startPreviewPlayback(1);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        stopPreviewPlayback();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [returnToAnnotationFrame, startPreviewPlayback, stopPreviewPlayback]);

  useEffect(() => {
    return () => stopPreviewPlayback();
  }, [stopPreviewPlayback]);

  useEffect(() => {
    if (!sourceVideoUrl) {
      stopPreviewPlayback();
    }
  }, [sourceVideoUrl, stopPreviewPlayback]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const [pageHeightPx, setPageHeightPx] = useState<number | null>(null);

  useEffect(() => {
    const updateAvailableHeight = () => {
      const el = pageRootRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setPageHeightPx(Math.max(0, Math.floor(window.innerHeight - top)));
    };
    updateAvailableHeight();
    window.addEventListener('resize', updateAvailableHeight);
    return () => window.removeEventListener('resize', updateAvailableHeight);
  }, []);

  // Lock page scrolling while this page is open
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement as HTMLElement;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverscroll = (body.style as any).overscrollBehavior;
    const prevHtmlOverscroll = (html.style as any).overscrollBehavior;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    (body.style as any).overscrollBehavior = 'none';
    (html.style as any).overscrollBehavior = 'none';
    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      if (prevBodyOverscroll) (body.style as any).overscrollBehavior = prevBodyOverscroll; else body.style.removeProperty('overscroll-behavior');
      if (prevHtmlOverscroll) (html.style as any).overscrollBehavior = prevHtmlOverscroll; else html.style.removeProperty('overscroll-behavior');
    };
  }, []);

  const openProject = useCallback(async () => {
    try {
      const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker();
      const anyHandle: any = dir as any;
      const q = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'readwrite' }) : 'granted');
      if (q !== 'granted' && anyHandle?.requestPermission) {
        const r = await anyHandle.requestPermission({ mode: 'readwrite' });
        if (r !== 'granted') throw new Error('Write permission not granted');
      }
      await saveProjectHandle(dir);
      const v = await validateProjectFolderStructure(dir);
      if (!v.ok) throw new Error(`Not a valid project folder: ${v.reason}`);
      setProjectDir(dir);
      setManifest(v.manifest);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [setProjectDir, setManifest]);

  const requestWriteAccess = useCallback(async () => {
    if (!projectDir) return;
    try {
      const anyHandle: any = projectDir as any;
      if (!anyHandle?.requestPermission) return;
      const r = await anyHandle.requestPermission({ mode: 'readwrite' });
      setWritePermission(r);
      if (r !== 'granted') {
        setError('Write permission not granted');
        return;
      }
      const v = await validateProjectFolderStructure(projectDir);
      if (!v.ok) throw new Error(`Not a valid project folder: ${v.reason}`);
      setManifest(v.manifest);
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [projectDir, setManifest]);

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as any;
      if (data && data.type === 'project-handle' && data.handle) {
        try {
          const handle: FileSystemDirectoryHandle = data.handle as FileSystemDirectoryHandle;
          await saveProjectHandle(handle);
          const anyHandle: any = handle as any;
          const q = await (anyHandle.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
          if (q !== 'granted') return;
          const v = await validateProjectFolderStructure(handle);
          if (!v.ok) throw new Error(`Not a valid project folder: ${v.reason}`);
          setProjectDir(handle);
          setManifest(v.manifest);
        } catch (err) {
          // ignore
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [setProjectDir, setManifest]);

  // Keep latest values in refs for non-passive wheel listener
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  // Attach non-passive wheel listener on document; only handle when over container
  useEffect(() => {
    const onWheelNative = (e: WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      e.preventDefault();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const prev = scaleRef.current;
      const next = Math.min(8, Math.max(0.1, prev * (1 + (-e.deltaY * 0.001))));
      const contentX = (cx - offsetRef.current.x) / prev;
      const contentY = (cy - offsetRef.current.y) / prev;
      const nx = cx - contentX * next;
      const ny = cy - contentY * next;
      setScale(next);
      setOffset({ x: nx, y: ny });
    };
    document.addEventListener('wheel', onWheelNative, { passive: false });
    return () => document.removeEventListener('wheel', onWheelNative);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Middle mouse button for pan
    if (e.button === 1) {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      setPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY };
      offsetStartRef.current = { ...offset };
    }
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panning || !panStartRef.current || !offsetStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setOffset({ x: offsetStartRef.current.x + dx, y: offsetStartRef.current.y + dy });
  }, [panning]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (panning) {
      setPanning(false);
      panStartRef.current = null;
      offsetStartRef.current = null;
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    }
  }, [panning]);

  const handleAutoCalibrate = useCallback(async () => {
    if (!still || !sidecarVideoRef) return;
    setIsComputingHomography(true);
    setHomographyStatus(null);
    setError(null);

    const paddingMs = 400;
    const startMs = Math.max(0, still.t_ms - paddingMs);
    const endMs = Math.max(startMs + 1, still.t_ms + paddingMs);

    try {
      const result = await requestHomography({
        videoRef: sidecarVideoRef,
        startMs,
        endMs,
        fps: 5,
      });

      const frames: HomographyFrame[] = result.frames.map((frame) => ({
        tMs: frame.tMs,
        matrix: frame.matrix,
        method: frame.method,
      }));
      const matrix = resolveUsableHomographyAtTime(frames, still.t_ms);
      const quad = projectPitchBoundsToPerspectiveQuad(matrix);

      if (!quad) {
        throw new Error('PnLCalib ran, but no usable homography was found for this still');
      }

      setAutoPerspectiveQuad(quad);
      setAutoPerspectiveTick((tick) => tick + 1);
      setTool('select');
      setHomographyStatus('PnLCalib applied');
    } catch (e: any) {
      setHomographyStatus(null);
      setError(e?.message || 'PnLCalib calibration failed');
    } finally {
      setIsComputingHomography(false);
    }
  }, [sidecarVideoRef, still]);

  const handlePreviewVideoLoadedMetadata = useCallback(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null;
    setVideoDurationMs(durationMs);
    setPreviewReady(true);
    const targetMs = clampPreviewMs(annotationTimeMs, durationMs);
    video.currentTime = targetMs / 1000;
    lastSyncedPreviewMsRef.current = targetMs;
    setPreviewTimeMs(targetMs);
    setPreviewFrameTick((tick) => tick + 1);
  }, [annotationTimeMs, clampPreviewMs]);

  const handlePreviewVideoSeeked = useCallback(() => {
    syncPreviewFrame(true);
  }, [syncPreviewFrame]);

  const toolBtnCls = (t: Tool) =>
    `self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base cursor-pointer ${
      tool === t
        ? 'bg-[#2563eb] text-white'
        : 'bg-surface text-primary'
    }`;

  const actionBtnCls =
    'self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base cursor-pointer bg-canvas text-primary disabled:opacity-50 disabled:cursor-not-allowed';

  const annotationControlCls = annotationsLocked ? 'opacity-50 cursor-not-allowed' : '';
  const saveStatusCls =
    saveStatus?.state === 'error' ? 'text-danger'
    : saveStatus?.state === 'saving' ? 'text-warning'
    : saveStatus?.state === 'saved' ? 'text-[#34d399]'
    : '';

  const hasStroke = ['box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly', 'text'].includes(tool);
  const hasWidth = ['box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly'].includes(tool);
  const hasPattern = ['box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly'].includes(tool);
  const hasFill = ['box', 'circle', 'highlight', 'shadow', 'poly'].includes(tool);
  const hasFont = tool === 'text';
  const handleDefaultStrokeColorChange = useCallback((value: string) => {
    const next = value || '#000000';
    setDefaultColor(next);
    if (defaultColorsLinked) setDefaultFill(next);
  }, [defaultColorsLinked]);
  const handleDefaultFillColorChange = useCallback((value: string) => {
    const next = value || '#000000';
    setDefaultFill(next);
    if (defaultColorsLinked) setDefaultColor(next);
  }, [defaultColorsLinked]);
  const toggleDefaultColorsLinked = useCallback(() => {
    const next = !defaultColorsLinked;
    setDefaultColorsLinked(next);
    if (next) setDefaultFill(defaultColor);
  }, [defaultColor, defaultColorsLinked]);
  const previewCanStepBackward = previewReady && previewBounds.startMs < annotationTimeMs;
  const previewCanStepForward = previewReady && previewBounds.endMs > annotationTimeMs;
  const previewStatus = sourceVideoError
    ? sourceVideoError
    : !sourceVideoPath
      ? 'No source video for this still'
      : !sourceVideoUrl
        ? 'Loading source video…'
        : !previewReady
          ? 'Preparing video…'
          : previewAtAnnotationFrame
            ? 'At annotation frame'
            : `${previewTimeMs != null && previewTimeMs < annotationTimeMs ? 'Preview -' : 'Preview +'}${(((previewTimeMs ?? annotationTimeMs) - annotationTimeMs) / 1000).toFixed(2).replace('-', '')}s`;

  const navbar = (
    <div className="flex items-stretch bg-surface border-b border-border shrink-0">
      <button onClick={() => { setSaveStatus({ state: 'saving' }); setSaveTick(t => t + 1); }}
        className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base bg-[#10b981] text-surface cursor-pointer">Save</button>
      <div className={`self-stretch flex items-center px-3 text-sm min-w-[100px] ${saveStatusCls}`}>
        {saveStatus?.state === 'saving'
          ? 'Saving…'
          : saveStatus?.state === 'saved'
            ? (saveStatus?.message === 'already_saved' ? 'Already saved' : 'Saved')
            : saveStatus?.state === 'error'
              ? 'Save failed'
              : ''}
      </div>
      <div className="self-stretch flex items-center gap-2 px-3 border-0 border-r border-solid border-border text-sm">
        <span className="text-muted">Set</span>
        <select
          value={selectedAnnotationId}
          onChange={(e) => setSelectedAnnotation(e.target.value)}
          className="min-w-[180px]"
        >
          {annotationEntries.map((entry) => {
            const label = entry.label || (entry.id === 'default' ? 'Default annotations' : `Annotation set ${entry.id}`);
            return <option key={entry.file} value={entry.id}>{label}</option>;
          })}
        </select>
        {!isCreatingAnnotationSet ? (
          <button onClick={() => setIsCreatingAnnotationSet(true)} className="px-3 py-1 border border-subtle bg-canvas text-sm">New set</button>
        ) : (
          <>
            <input
              value={newAnnotationLabel}
              onChange={(e) => setNewAnnotationLabel(e.target.value)}
              placeholder="New set label"
              className="w-[180px]"
            />
            <button onClick={() => void createAnnotationSet()} className="px-3 py-1 border border-subtle bg-canvas text-sm">Create</button>
            <button onClick={() => { setIsCreatingAnnotationSet(false); setNewAnnotationLabel(''); }} className="px-3 py-1 border border-subtle bg-canvas text-sm">Cancel</button>
          </>
        )}
        {!isRenamingAnnotationSet ? (
          <button onClick={() => setIsRenamingAnnotationSet(true)} className="px-3 py-1 border border-subtle bg-canvas text-sm" disabled={!selectedAnnotationEntry}>Rename</button>
        ) : (
          <>
            <input
              value={renameAnnotationLabel}
              onChange={(e) => setRenameAnnotationLabel(e.target.value)}
              placeholder="Rename set"
              className="w-[180px]"
            />
            <button onClick={() => void renameSelectedAnnotationSet()} className="px-3 py-1 border border-subtle bg-canvas text-sm">Save name</button>
            <button onClick={() => { setIsRenamingAnnotationSet(false); setRenameAnnotationLabel(selectedAnnotationLabel); }} className="px-3 py-1 border border-subtle bg-canvas text-sm">Cancel</button>
          </>
        )}
        <button
          onClick={() => void deleteSelectedAnnotationSet()}
          className="px-3 py-1 border border-subtle bg-canvas text-sm"
          disabled={!selectedAnnotationEntry || selectedAnnotationEntry.id === 'default'}
        >
          Delete
        </button>
      </div>
      <span className="flex-1" />
      <label className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
        <input
          type="checkbox"
          checked={enableForegroundOcclusion}
          onChange={(e) => setEnableForegroundOcclusion(e.target.checked)}
        />
        Occlusion
      </label>
      <select
        value={occlusionMethod}
        onChange={(e) => setOcclusionMethod(e.target.value as any)}
        disabled={!enableForegroundOcclusion}
        className={`self-stretch px-2 border-0 border-l border-solid border-border text-sm ${enableForegroundOcclusion ? '' : 'opacity-60'}`}
      >
        <option value="edge">Edge</option>
        <option value="ml">ML</option>
      </select>
      <div className="self-stretch flex items-center px-3 border-0 border-l border-solid border-border text-sm text-muted">
        {selectedAnnotationLabel} · Zoom: {(scale * 100).toFixed(0)}%
      </div>
    </div>
  );

  const toolBar = (
    <div className="flex items-stretch justify-center bg-surface border-b border-border shrink-0">
      <button onClick={() => setTool('select')} aria-pressed={tool === 'select'} className={`${toolBtnCls('select')} ${annotationControlCls}`} disabled={annotationsLocked}>Select</button>
      <button onClick={() => setTool('box')} aria-pressed={tool === 'box'} className={`${toolBtnCls('box')} ${annotationControlCls}`} disabled={annotationsLocked}>Box</button>
      <button onClick={() => setTool('circle')} aria-pressed={tool === 'circle'} className={`${toolBtnCls('circle')} ${annotationControlCls}`} disabled={annotationsLocked}>Circle</button>
      <button onClick={() => setTool('highlight')} aria-pressed={tool === 'highlight'} className={`${toolBtnCls('highlight')} ${annotationControlCls}`} disabled={annotationsLocked}>Highlight</button>
      <button onClick={() => setTool('shadow')} aria-pressed={tool === 'shadow'} className={`${toolBtnCls('shadow')} ${annotationControlCls}`} disabled={annotationsLocked}>Shadow</button>
      <button onClick={() => setTool('arrow')} aria-pressed={tool === 'arrow'} className={`${toolBtnCls('arrow')} ${annotationControlCls}`} disabled={annotationsLocked}>Arrow</button>
      <button onClick={() => setTool('lob')} aria-pressed={tool === 'lob'} className={`${toolBtnCls('lob')} ${annotationControlCls}`} disabled={annotationsLocked}>Lob</button>
      <button onClick={() => setTool('poly')} aria-pressed={tool === 'poly'} className={`${toolBtnCls('poly')} ${annotationControlCls}`} disabled={annotationsLocked}>Poly</button>
      <button onClick={() => setTool('text')} aria-pressed={tool === 'text'} className={`${toolBtnCls('text')} ${annotationControlCls}`} disabled={annotationsLocked}>Text</button>
      <button
        onClick={() => void handleAutoCalibrate()}
        disabled={annotationsLocked || !canAutoCalibrate || isComputingHomography}
        className={`${actionBtnCls} ${annotationControlCls}`}
      >
        {isComputingHomography ? 'Calibrating…' : 'Calibrate'}
      </button>
      <button onClick={() => setTool('calibrate')} aria-pressed={tool === 'calibrate'} className={`${toolBtnCls('calibrate')} ${annotationControlCls}`} disabled={annotationsLocked}>Manual H</button>
      {(homographyStatus || sidecarVideoError) && (
        <div className={`self-stretch flex items-center px-3 border-0 border-l border-solid border-border text-sm ${
          sidecarVideoError ? 'text-warning' : 'text-muted'
        }`}>
          {sidecarVideoError || homographyStatus}
        </div>
      )}
      {hasStroke && hasFill && (
        <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
          <span className="text-muted">Stroke</span>
          <input type="color" value={defaultColor} onChange={(e) => handleDefaultStrokeColorChange(e.target.value)} className="w-7 h-7 cursor-pointer" disabled={annotationsLocked} />
          <ColorLinkToggle linked={defaultColorsLinked} onToggle={toggleDefaultColorsLinked} disabled={annotationsLocked} />
          <span className="text-muted">Fill</span>
          <input type="color" value={defaultFill} onChange={(e) => handleDefaultFillColorChange(e.target.value)} className="w-7 h-7 cursor-pointer" disabled={annotationsLocked} />
        </div>
      )}
      {hasStroke && !hasFill && (
        <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
          <span className="text-muted">Stroke</span>
          <input type="color" value={defaultColor} onChange={(e) => handleDefaultStrokeColorChange(e.target.value)} className="w-7 h-7 cursor-pointer" disabled={annotationsLocked} />
        </div>
      )}
      {hasWidth && (
        <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
          <span className="text-muted">Width</span>
          <input type="number" min={1} max={16} step={1} value={defaultStrokeWidth} onChange={(e) => setDefaultStrokeWidth(Math.max(1, Math.min(16, Number(e.target.value) || 1)))} className="w-12" disabled={annotationsLocked} />
        </div>
      )}
      {hasPattern && (
        <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
          <span className="text-muted">Style</span>
          <select value={strokePattern} onChange={(e) => setStrokePattern((e.target.value as StrokePattern) || 'solid')} disabled={annotationsLocked}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
            <option value="dashdot">Dash-dot</option>
          </select>
        </div>
      )}
      {hasFill && (
        <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
          <span className="text-muted">Opacity</span>
          <input type="range" min={0} max={100} step={1} value={Math.round(defaultFillOpacity * 100)} onChange={(e) => setDefaultFillOpacity(Number(e.target.value) / 100)} className="w-16" disabled={annotationsLocked} />
          <span className="text-muted text-xs">{Math.round(defaultFillOpacity * 100)}%</span>
        </div>
      )}
      {hasFont && (
        <div className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
          <span className="text-muted">Size</span>
          <input type="number" min={1} max={300} step={1} value={defaultFontSize} onChange={(e) => setDefaultFontSize(Math.max(1, Math.min(300, Number(e.target.value) || 48)))} className="w-14" disabled={annotationsLocked} />
        </div>
      )}
      {hasFont && (
        <label className="self-stretch flex items-center gap-1.5 px-3 border-0 border-l border-solid border-border text-sm">
          <input type="checkbox" checked={defaultTextHighlight} onChange={(e) => setDefaultTextHighlight(e.target.checked)} disabled={annotationsLocked} />
          <span className="text-muted">Highlight</span>
        </label>
      )}
    </div>
  );

  const videoContextBar = (
    <div className="flex items-stretch bg-surface border-b border-border shrink-0">
      <div className="flex items-center px-3 text-sm text-muted border-0 border-l border-solid border-border">
        {previewStatus}
      </div>
      <div className="flex items-center px-3 text-xs text-muted border-0 border-l border-solid border-border">
        Hold {previewCanStepBackward ? '←' : '·'} / {previewCanStepForward ? '→' : '·'} · Space returns
      </div>
      {annotationsLocked && (
        <div className="flex items-center px-3 text-xs text-warning border-0 border-l border-solid border-border">
          Preview active. Zoom and pan only.
        </div>
      )}
      <span className="flex-1" />
      <div className="flex items-center px-3 text-xs text-muted border-0 border-l border-solid border-border">
        Hard stop: {Math.round(previewBounds.startMs / 1000)}s - {Math.round(previewBounds.endMs / 1000)}s
      </div>
    </div>
  );

  if (!projectDir) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">No project open. If you opened this page from Stills, it will auto-connect. Otherwise, open your project folder.</div>
          <div className="toolbar mt-2">
            <button onClick={openProject}>Open Project Folder</button>
          </div>
        </div>
      </div>
    );
  }
  if (!manifest) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">Project folder connected, but access is not granted yet. Click enable to load the project and allow saving.</div>
          <div className="toolbar mt-2 flex gap-2">
            <button onClick={requestWriteAccess}>Enable access</button>
            <button onClick={openProject}>Pick Folder</button>
          </div>
          {error && <div className="status mt-2 text-danger">{error}</div>}
        </div>
      </div>
    );
  }
  if (!still) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">Still not found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fullbleed">
      <div
        ref={pageRootRef}
        className="flex flex-col overflow-hidden"
        style={{ height: pageHeightPx != null ? `${pageHeightPx}px` : 'calc(100vh - var(--player-headroom))', overscrollBehavior: 'none' }}
      >
        {navbar}
        {toolBar}
        {videoContextBar}
        {writePermission && writePermission !== 'granted' && (
          <div className="shrink-0 px-3 py-1 text-xs text-warning border-b border-subtle flex items-center gap-2">
            Write access not granted.
            <button onClick={requestWriteAccess} className="bg-[#f59e0b] text-surface border border-[#fbbf24] px-2 py-0.5 cursor-pointer text-xs">Enable autosave</button>
          </div>
        )}
        {error && <div className="shrink-0 px-3 py-1 text-xs text-danger border-b border-subtle">{error}</div>}
        <video
          ref={previewVideoRef}
          src={sourceVideoUrl ?? undefined}
          muted
          playsInline
          preload="auto"
          className="hidden"
          onLoadedMetadata={handlePreviewVideoLoadedMetadata}
          onLoadedData={() => syncPreviewFrame(true)}
          onSeeked={handlePreviewVideoSeeked}
          onTimeUpdate={() => syncPreviewFrame()}
          onError={() => {
            setSourceVideoError('Failed to load source video');
            setPreviewReady(false);
          }}
        />
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={`relative flex-1 min-h-0 bg-surface overflow-hidden touch-none ${panning ? 'cursor-grabbing' : 'cursor-default'}`}
          style={{ overscrollBehavior: 'none' }}
        >
          {imgUrl && (
            <Editor
              key={`${stillId}:${selectedAnnotationId}`}
              stillId={stillId}
              annotationId={selectedAnnotationId}
              annotationFilePath={effectiveSelectedAnnotationEntry.file}
              annotationLabel={effectiveSelectedAnnotationEntry.label}
              imageInfo={imageInfo}
              imgUrl={imgUrl}
              stageScale={scale}
              stageOffset={offset}
              tool={tool}
              defaultStrokePattern={strokePattern}
              defaultColor={defaultColor}
              defaultStrokeWidth={defaultStrokeWidth}
              defaultFill={defaultFill}
              defaultFillOpacity={defaultFillOpacity}
              defaultFontSize={defaultFontSize}
              defaultTextHighlight={defaultTextHighlight}
              enableForegroundOcclusion={enableForegroundOcclusion}
              occlusionMethod={occlusionMethod}
              onRequestToolChange={setTool}
              saveTick={saveTick}
              onSaveStatus={setSaveStatus}
              autoPerspectiveQuad={autoPerspectiveQuad}
              autoPerspectiveTick={autoPerspectiveTick}
              backgroundVideoElement={previewVideoActive ? previewVideoRef.current : null}
              backgroundFrameTick={previewFrameTick}
              annotationsLocked={annotationsLocked}
            />
          )}
        </div>
      </div>
    </div>
  );
}
