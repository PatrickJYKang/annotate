"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../../lib/state/ProjectContext';
import {
  mergeLoadedAnnotationDocuments,
  readAnnotationDocumentsForStill,
  type LoadedAnnotationDocument,
} from '../../lib/fs/annotationStorage';
import { listClips, resolveMarkPinning } from '../../lib/fs/clipStorage';
import { writeManifest } from '../../lib/fs/projectFolder';
import { writePresentation } from '../../lib/fs/presentationStorage';
import type { Clip } from '../../lib/types/clip';
import type { ProjectManifestV1 } from '../../lib/types/project';
import type { Presentation, PresentationSlide, PresentationTransition, TitleSlide } from '../../lib/types/presentation';
import type { TaggingSchema } from '../../lib/tagging/schema';
import type { AnnotationsV1 } from '../../lib/export/d7Render';
import { renderAnnotatedPng } from '../../lib/export/d7Render';
import { usePresentationPlayerController } from '../../lib/presentation/playerController';
import {
  buildPresentationAssetIndex,
  createClipSlide,
  createStillSlide,
  createTitleSlide,
  insertSlideAfterSelection,
  moveSlide,
  removeSlideAtIndex,
} from '../../lib/presentation/authoring';
import { findCanonicalStillForMark } from '../../lib/utils/projectIntegrity';
import PresentationCanvas from './PresentationCanvas';
import PresentationDeckStrip from './PresentationDeckStrip';
import PresentationInspector from './PresentationInspector';
import PresentationAssetBrowser from './PresentationAssetBrowser';

export interface PresentationAuthoringEditorProps {
  projectDir: FileSystemDirectoryHandle;
  manifest: ProjectManifestV1;
  presentation: Presentation;
  taggingSchema: TaggingSchema | null;
  onBack: () => void;
}

const SAVE_DEBOUNCE_MS = 400;

function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

function pad6(n: number): string {
  return String(n).padStart(6, '0');
}

function formatTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms || 0));
  let rest = clamped;
  const hh = Math.floor(rest / 3600000);
  rest %= 3600000;
  const mm = Math.floor(rest / 60000);
  rest %= 60000;
  const ss = Math.floor(rest / 1000);
  const mss = rest % 1000;
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(mss).padStart(3, '0')}`;
  }
  return `${mm}:${String(ss).padStart(2, '0')}.${String(mss).padStart(3, '0')}`;
}

function formatClockTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function revokeUrls(urls: Record<string, string>) {
  Object.values(urls).forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
}

export default function PresentationAuthoringEditor({
  projectDir,
  manifest,
  presentation,
  taggingSchema,
  onBack,
}: PresentationAuthoringEditorProps) {
  const { setManifest } = useProject();
  const [workingManifest, setWorkingManifest] = useState(manifest);
  const [draftPresentation, setDraftPresentation] = useState(presentation);
  const draftRef = useRef(presentation);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(presentation.updatedAt);
  const [assetStatus, setAssetStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [assetError, setAssetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stillUrlById, setStillUrlById] = useState<Record<string, string>>({});
  const [annotatedStillUrlById, setAnnotatedStillUrlById] = useState<Record<string, string>>({});
  const [thumbnailUrlByStillId, setThumbnailUrlByStillId] = useState<Record<string, string>>({});
  const [annotationsByStillId, setAnnotationsByStillId] = useState<Record<string, AnnotationsV1 | null>>({});
  const [annotationDocumentsByStillId, setAnnotationDocumentsByStillId] = useState<Record<string, LoadedAnnotationDocument[]>>({});
  const [clips, setClips] = useState<Clip[]>([]);
  const [videoUrlById, setVideoUrlById] = useState<Record<string, string>>({});
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [captureBusyMarkId, setCaptureBusyMarkId] = useState<string | null>(null);
  const [isPresentMode, setIsPresentMode] = useState(false);
  const [isRetrievalBrowserOpen, setIsRetrievalBrowserOpen] = useState(false);
  const stillUrlRegistryRef = useRef<Record<string, string>>({});
  const annotatedUrlRegistryRef = useRef<Record<string, string>>({});
  const thumbnailUrlRegistryRef = useRef<Record<string, string>>({});
  const videoUrlRegistryRef = useRef<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setWorkingManifest(manifest);
  }, [manifest]);

  useEffect(() => {
    setDraftPresentation(presentation);
    draftRef.current = presentation;
    setLastSavedAt(presentation.updatedAt);
    setSaveState('idle');
  }, [presentation]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const persistDraft = useCallback(async () => {
    setSaveState('saving');
    try {
      await writePresentation(projectDir, draftRef.current);
      setLastSavedAt(draftRef.current.updatedAt);
      setSaveState('saved');
    } catch (e: any) {
      setSaveState('error');
      setToast(e?.message || String(e));
    }
  }, [projectDir]);

  const queuePersist = useCallback((next: Presentation, immediate = false) => {
    draftRef.current = next;
    setDraftPresentation(next);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    if (immediate) {
      void persistDraft();
      return;
    }
    setSaveState('dirty');
    flushTimer.current = setTimeout(() => {
      void persistDraft();
    }, SAVE_DEBOUNCE_MS);
  }, [persistDraft]);

  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        void writePresentation(projectDir, draftRef.current).catch(() => {});
      }
    };
  }, [projectDir]);

  const clipById = useMemo(() => {
    return clips.reduce<Record<string, Clip>>((acc, clip) => {
      acc[clip.id] = clip;
      return acc;
    }, {});
  }, [clips]);

  const {
    selectedSlideIndex,
    state,
    currentTransition,
    showSlide,
    previewTransitionFrom,
    completeVideoPlayback,
    stopVideoPlayback,
    retrieveMark,
    goToPreviousSlide,
    goToNextSlide,
  } = usePresentationPlayerController(draftPresentation, workingManifest, clipById);

  const getFileForPath = useCallback(async (dir: FileSystemDirectoryHandle, path: string) => {
    const parts = path.split('/').filter(Boolean);
    let current: FileSystemDirectoryHandle = dir;
    for (let i = 0; i < parts.length - 1; i += 1) {
      current = await current.getDirectoryHandle(parts[i], { create: false });
    }
    const handle = await current.getFileHandle(parts[parts.length - 1], { create: false });
    return await handle.getFile();
  }, []);

  const writeBlobToFile = useCallback(async (dir: FileSystemDirectoryHandle, subdir: string, fileName: string, blob: Blob) => {
    const targetDir = await dir.getDirectoryHandle(subdir, { create: true });
    const handle = await targetDir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return `${subdir}/${fileName}`;
  }, []);

  const createThumbnailBlob = useCallback(async (srcBlob: Blob, maxWidth = 400) => {
    const img = new Image();
    const url = URL.createObjectURL(srcBlob);
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('thumb load failed'));
        img.src = url;
      });
      const scale = maxWidth / img.width;
      const tw = Math.round(img.width * scale);
      const th = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D not available');
      ctx.drawImage(img, 0, 0, tw, th);
      const thumbBlob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png'),
      );
      return { thumbBlob, tw, th };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  const captureFrameAtMark = useCallback(async (videoFile: File, tMs: number) => {
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('video load failed'));
        };
        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError as any);
        };
        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('error', onError as any);
        if (video.readyState >= 1) {
          cleanup();
          resolve();
        }
      });
      video.currentTime = tMs / 1000;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D not available');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG encode failed'))), 'image/png'),
      );
      return { blob, w: canvas.width, h: canvas.height };
    } finally {
      URL.revokeObjectURL(url);
      video.src = '';
    }
  }, []);

  const nextStillNumber = useCallback((mf: ProjectManifestV1) => {
    const re = /(\d{6})\.png$/i;
    let max = 0;
    for (const still of mf.stills || []) {
      const match = still.file.match(re);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return max + 1;
  }, []);

  const slideStillIds = useMemo(() => {
    const ids = new Set<string>();
    for (const slide of draftPresentation.slides) {
      if (slide.kind === 'still') ids.add(slide.stillId);
    }
    return Array.from(ids);
  }, [draftPresentation]);

  useEffect(() => {
    let cancelled = false;
    revokeUrls(stillUrlRegistryRef.current);
    revokeUrls(annotatedUrlRegistryRef.current);
    revokeUrls(thumbnailUrlRegistryRef.current);
    stillUrlRegistryRef.current = {};
    annotatedUrlRegistryRef.current = {};
    thumbnailUrlRegistryRef.current = {};
    setStillUrlById({});
    setAnnotatedStillUrlById({});
    setThumbnailUrlByStillId({});
    setAnnotationsByStillId({});
    setAnnotationDocumentsByStillId({});
    if (slideStillIds.length === 0) {
      setAssetStatus('ready');
      setAssetError(null);
      return;
    }
    setAssetStatus('loading');

    const load = async () => {
      const nextStillUrls: Record<string, string> = {};
      const nextAnnotatedUrls: Record<string, string> = {};
      const nextThumbUrls: Record<string, string> = {};
      const nextAnnotations: Record<string, AnnotationsV1 | null> = {};
      const nextAnnotationDocuments: Record<string, LoadedAnnotationDocument[]> = {};
      for (const stillId of slideStillIds) {
        const still = workingManifest.stills.find((entry) => entry.id === stillId);
        if (!still) continue;
        try {
          const stillFile = await getFileForPath(projectDir, still.file);
          nextStillUrls[still.id] = URL.createObjectURL(stillFile);
          try {
            const thumbFile = await getFileForPath(projectDir, `thumbnails/${baseName(still.file)}`);
            nextThumbUrls[still.id] = URL.createObjectURL(thumbFile);
          } catch {}
          const annotationDocuments = await readAnnotationDocumentsForStill(projectDir, workingManifest, still);
          nextAnnotationDocuments[still.id] = annotationDocuments;
          const annotations = mergeLoadedAnnotationDocuments(annotationDocuments);
          nextAnnotations[still.id] = annotations;
          if (annotations) {
            const bitmap = await createImageBitmap(stillFile);
            try {
              const annotatedBlob = await renderAnnotatedPng({ bmp: bitmap, ann: annotations });
              nextAnnotatedUrls[still.id] = URL.createObjectURL(annotatedBlob);
            } finally {
              bitmap.close();
            }
          }
        } catch {}
      }
      if (cancelled) {
        revokeUrls(nextStillUrls);
        revokeUrls(nextAnnotatedUrls);
        revokeUrls(nextThumbUrls);
        return;
      }
      stillUrlRegistryRef.current = nextStillUrls;
      annotatedUrlRegistryRef.current = nextAnnotatedUrls;
      thumbnailUrlRegistryRef.current = nextThumbUrls;
      setStillUrlById(nextStillUrls);
      setAnnotatedStillUrlById(nextAnnotatedUrls);
      setThumbnailUrlByStillId(nextThumbUrls);
      setAnnotationsByStillId(nextAnnotations);
      setAnnotationDocumentsByStillId(nextAnnotationDocuments);
      setAssetStatus('ready');
      setAssetError(null);
    };

    load().catch((e: any) => {
      if (cancelled) return;
      setAssetStatus('error');
      setAssetError(e?.message || String(e));
    });

    return () => {
      cancelled = true;
    };
  }, [slideStillIds, workingManifest, projectDir, getFileForPath]);

  useEffect(() => {
    let cancelled = false;
    const loadClipsForPresentation = async () => {
      const raw = await listClips(projectDir);
      const resolved = raw
        .map((clip) => resolveMarkPinning(clip, workingManifest.marks))
        .sort((a, b) => a.startMs - b.startMs);
      if (!cancelled) {
        setClips(resolved);
      }
    };
    void loadClipsForPresentation().catch((e: any) => {
      if (!cancelled) {
        setToast(e?.message || String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectDir, workingManifest.marks]);

  const activeVideoId = state.mode === 'video'
    ? state.videoId
    : state.mode === 'clip'
      ? state.clip.videoId
      : null;

  useEffect(() => {
    if (!activeVideoId) return;
    if (videoUrlRegistryRef.current[activeVideoId]) {
      setVideoUrlById((prev) => prev[activeVideoId] ? prev : { ...prev, [activeVideoId]: videoUrlRegistryRef.current[activeVideoId] });
      return;
    }
    let cancelled = false;
    const loadVideo = async () => {
      const video = workingManifest.videos.find((entry) => entry.id === activeVideoId);
      if (!video) throw new Error(`Video not found: ${activeVideoId}`);
      const file = await getFileForPath(projectDir, video.file);
      const url = URL.createObjectURL(file);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      videoUrlRegistryRef.current = { ...videoUrlRegistryRef.current, [activeVideoId]: url };
      setVideoUrlById((prev) => ({ ...prev, [activeVideoId]: url }));
    };
    loadVideo().catch((e: any) => {
      if (cancelled) return;
      setAssetError(e?.message || String(e));
      setToast(e?.message || String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [activeVideoId, workingManifest.videos, projectDir, getFileForPath]);

  useEffect(() => {
    return () => {
      revokeUrls(stillUrlRegistryRef.current);
      revokeUrls(annotatedUrlRegistryRef.current);
      revokeUrls(thumbnailUrlRegistryRef.current);
      revokeUrls(videoUrlRegistryRef.current);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isFullscreen) {
        setIsPresentMode(false);
        setIsRetrievalBrowserOpen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const hasPendingSave = saveState === 'dirty' || saveState === 'saving' || saveState === 'error';
    if (!hasPendingSave) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveState]);

  const assetIndex = useMemo(() => buildPresentationAssetIndex(taggingSchema, workingManifest), [taggingSchema, workingManifest]);
  const selectedSlide = selectedSlideIndex >= 0 ? draftPresentation.slides[selectedSlideIndex] ?? null : null;
  const selectedStillId = selectedSlide?.kind === 'still' ? selectedSlide.stillId : null;
  const selectedClipId = selectedSlide?.kind === 'clip' ? selectedSlide.clipId : null;
  const selectedStillSourceMarkId = state.mode === 'still' ? state.still.sourceMarkId ?? null : null;

  const previewMark = useCallback((mark: ProjectManifestV1['marks'][number]) => {
    setSelectedMarkId(mark.id);
    if (isPresentMode) {
      setIsRetrievalBrowserOpen(false);
    }
    retrieveMark(mark);
  }, [isPresentMode, retrieveMark]);

  const updateSelectedSlide = useCallback((updater: (slide: PresentationSlide) => PresentationSlide, immediate = false) => {
    if (selectedSlideIndex < 0) return;
    const nextSlides = draftPresentation.slides.map((slide, index) => index === selectedSlideIndex ? updater(slide) : slide);
    queuePersist({
      ...draftPresentation,
      slides: nextSlides,
      updatedAt: new Date().toISOString(),
    }, immediate);
  }, [draftPresentation, selectedSlideIndex, queuePersist]);

  const insertStillSlide = useCallback((stillId: string) => {
    const result = insertSlideAfterSelection(workingManifest, draftPresentation, selectedSlideIndex, createStillSlide(stillId));
    queuePersist(result.presentation, true);
    showSlide(result.insertedIndex);
    const still = workingManifest.stills.find((entry) => entry.id === stillId);
    setSelectedMarkId(still?.sourceMarkId ?? null);
    setToast('Still slide added');
  }, [workingManifest, draftPresentation, selectedSlideIndex, queuePersist, showSlide]);

  const insertClipSlide = useCallback((clipId: string) => {
    const result = insertSlideAfterSelection(workingManifest, draftPresentation, selectedSlideIndex, createClipSlide(clipId));
    queuePersist(result.presentation, true);
    showSlide(result.insertedIndex);
    setSelectedMarkId(null);
    setToast('Clip slide added');
  }, [workingManifest, draftPresentation, selectedSlideIndex, queuePersist, showSlide]);

  const addTitleSlide = useCallback((template: TitleSlide['template']) => {
    const result = insertSlideAfterSelection(workingManifest, draftPresentation, selectedSlideIndex, createTitleSlide(template));
    queuePersist(result.presentation, true);
    showSlide(result.insertedIndex);
    setToast('Title slide added');
  }, [workingManifest, draftPresentation, selectedSlideIndex, queuePersist, showSlide]);

  const deleteSelectedSlide = useCallback(() => {
    if (selectedSlideIndex < 0) return;
    const next = removeSlideAtIndex(workingManifest, draftPresentation, selectedSlideIndex);
    queuePersist(next, true);
    const nextIndex = next.slides.length === 0 ? -1 : Math.min(selectedSlideIndex, next.slides.length - 1);
    if (nextIndex >= 0) showSlide(nextIndex);
    setToast('Slide removed');
  }, [workingManifest, draftPresentation, selectedSlideIndex, queuePersist, showSlide]);

  const reorderSlide = useCallback((fromIndex: number, toIndex: number) => {
    const next = moveSlide(workingManifest, draftPresentation, fromIndex, toIndex);
    queuePersist(next, true);
    showSlide(toIndex);
    setToast('Slide reordered');
  }, [workingManifest, draftPresentation, queuePersist, showSlide]);

  const updateTransition = useCallback((updater: (transition: PresentationTransition) => PresentationTransition) => {
    if (selectedSlideIndex < 0 || selectedSlideIndex >= draftPresentation.slides.length - 1) return;
    const current = draftPresentation.transitions[selectedSlideIndex] ?? { mode: 'cut' as const };
    const nextTransitions = draftPresentation.transitions.slice();
    nextTransitions[selectedSlideIndex] = updater(current);
    queuePersist({
      ...draftPresentation,
      transitions: nextTransitions,
      updatedAt: new Date().toISOString(),
    }, true);
  }, [draftPresentation, selectedSlideIndex, queuePersist]);

  const handlePreviewTransition = useCallback(() => {
    if (selectedSlideIndex < 0) return;
    const result = previewTransitionFrom(selectedSlideIndex);
    if (!result.ok) {
      setToast(result.reason || 'Transition preview unavailable');
    }
  }, [previewTransitionFrom, selectedSlideIndex]);

  const createStillForMark = useCallback(async (mark: ProjectManifestV1['marks'][number]) => {
    const canonicalStill = findCanonicalStillForMark(workingManifest, mark.id);
    if (canonicalStill) {
      insertStillSlide(canonicalStill.id);
      return;
    }
    const videoEntry = workingManifest.videos.find((video) => video.id === mark.videoId);
    if (!videoEntry) {
      setToast(`Video not found for mark ${mark.id}`);
      return;
    }
    try {
      setCaptureBusyMarkId(mark.id);
      const file = await getFileForPath(projectDir, videoEntry.file);
      const { blob, w, h } = await captureFrameAtMark(file, mark.t_ms);
      const stillNumber = nextStillNumber(workingManifest);
      const fileName = `${pad6(stillNumber)}.png`;
      const stillPath = await writeBlobToFile(projectDir, 'stills', fileName, blob);
      const { thumbBlob } = await createThumbnailBlob(blob, 400);
      const thumbPath = await writeBlobToFile(projectDir, 'thumbnails', baseName(stillPath), thumbBlob);
      const stillId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
        ? (globalThis.crypto as any).randomUUID()
        : `still_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const nextManifest: ProjectManifestV1 = {
        ...workingManifest,
        stills: [
          ...workingManifest.stills,
          {
            id: stillId,
            videoId: mark.videoId,
            t_ms: mark.t_ms,
            file: stillPath,
            width: w,
            height: h,
            sourceMarkId: mark.id,
          },
        ],
        thumbnails: workingManifest.thumbnails.includes(thumbPath)
          ? workingManifest.thumbnails
          : [...workingManifest.thumbnails, thumbPath],
      };
      await writeManifest(projectDir, nextManifest);
      setWorkingManifest(nextManifest);
      setManifest(nextManifest);
      const result = insertSlideAfterSelection(nextManifest, draftPresentation, selectedSlideIndex, createStillSlide(stillId));
      queuePersist(result.presentation, true);
      showSlide(result.insertedIndex);
      setSelectedMarkId(mark.id);
      setToast('Created still and inserted slide');
    } catch (e: any) {
      setToast(e?.message || String(e));
    } finally {
      setCaptureBusyMarkId(null);
    }
  }, [workingManifest, projectDir, getFileForPath, captureFrameAtMark, nextStillNumber, writeBlobToFile, createThumbnailBlob, setManifest, draftPresentation, selectedSlideIndex, queuePersist, showSlide, insertStillSlide]);

  const transitionCanUseMatchVideo = useMemo(() => {
    if (selectedSlideIndex < 0 || selectedSlideIndex >= draftPresentation.slides.length - 1) return false;
    const fromSlide = draftPresentation.slides[selectedSlideIndex];
    const toSlide = draftPresentation.slides[selectedSlideIndex + 1];
    if (!fromSlide || !toSlide || fromSlide.kind !== 'still' || toSlide.kind !== 'still') return false;
    const fromStill = workingManifest.stills.find((still) => still.id === fromSlide.stillId);
    const toStill = workingManifest.stills.find((still) => still.id === toSlide.stillId);
    if (!fromStill || !toStill) return false;
    return fromStill.videoId === toStill.videoId && toStill.t_ms > fromStill.t_ms;
  }, [draftPresentation, selectedSlideIndex, workingManifest]);

  const transitionValidationMessage = transitionCanUseMatchVideo
    ? null
    : 'match_video requires adjacent still slides from the same video with forward timestamps';

  const currentCanvasLabel = state.mode === 'still'
    ? `Still slide ${selectedSlideIndex + 1}`
    : state.mode === 'clip'
      ? `Clip slide ${selectedSlideIndex + 1}`
    : state.mode === 'title'
      ? `Title slide ${selectedSlideIndex + 1}`
      : state.mode === 'video'
        ? state.source === 'transition'
          ? 'Transition preview'
          : 'Retrieved mark preview'
        : state.mode === 'missing'
          ? 'Missing asset'
          : 'Empty presentation';

  const activeBrowserMarkId = selectedMarkId ?? selectedStillSourceMarkId;

  const enterPresentMode = useCallback(async () => {
    setIsPresentMode(true);
    setIsRetrievalBrowserOpen(false);
    const element = (rootRef.current ?? document.documentElement) as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    try {
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen();
      }
    } catch {}
  }, []);

  const leavePresentMode = useCallback(async () => {
    setIsPresentMode(false);
    setIsRetrievalBrowserOpen(false);
    if (state.mode === 'video') {
      stopVideoPlayback();
    }
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitFullscreenElement?: Element | null;
    };
    try {
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      }
    } catch {}
  }, [state.mode, stopVideoPlayback]);

  const handlePresentPrevious = useCallback(() => {
    if (state.mode === 'video') {
      stopVideoPlayback();
      return;
    }
    goToPreviousSlide();
  }, [state.mode, stopVideoPlayback, goToPreviousSlide]);

  const handlePresentNext = useCallback(() => {
    if (state.mode === 'video') {
      if (state.source === 'retrieval') {
        stopVideoPlayback();
      }
      return;
    }
    if (selectedSlideIndex < 0) return;
    if (currentTransition?.transition.mode === 'match_video') {
      const result = previewTransitionFrom(selectedSlideIndex);
      if (!result.ok) {
        setToast(result.reason || 'Transition preview unavailable');
        goToNextSlide();
      }
      return;
    }
    goToNextSlide();
  }, [state, selectedSlideIndex, currentTransition, previewTransitionFrom, stopVideoPlayback, goToNextSlide]);

  const returnToSelectedSlide = useCallback(() => {
    setIsRetrievalBrowserOpen(false);
    if (state.mode === 'video') {
      stopVideoPlayback();
    }
  }, [state.mode, stopVideoPlayback]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntryTarget(event.target)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (isPresentMode) {
          handlePresentPrevious();
        } else {
          goToPreviousSlide();
        }
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (isPresentMode) {
          handlePresentNext();
        } else {
          goToNextSlide();
        }
        return;
      }
      if (event.key === 'Escape') {
        if (isPresentMode) {
          event.preventDefault();
          if (isRetrievalBrowserOpen) {
            setIsRetrievalBrowserOpen(false);
            return;
          }
          void leavePresentMode();
          return;
        }
        if (state.mode === 'video') {
          event.preventDefault();
          stopVideoPlayback();
        }
        return;
      }
      if (!isPresentMode && (event.key === 'Backspace' || event.key === 'Delete') && selectedSlideIndex >= 0) {
        event.preventDefault();
        deleteSelectedSlide();
        return;
      }
      if (!isPresentMode && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void enterPresentMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    deleteSelectedSlide,
    enterPresentMode,
    goToNextSlide,
    goToPreviousSlide,
    handlePresentNext,
    handlePresentPrevious,
    isPresentMode,
    isRetrievalBrowserOpen,
    leavePresentMode,
    selectedSlideIndex,
    state.mode,
    stopVideoPlayback,
  ]);

  const saveStatusLabel = saveState === 'saving'
    ? 'Saving…'
    : saveState === 'dirty'
      ? 'Unsaved changes'
      : saveState === 'saved'
        ? (lastSavedAt ? `Saved ${formatClockTime(lastSavedAt)}` : 'Saved')
        : saveState === 'error'
          ? 'Save error'
          : 'Ready';

  const saveStatusClassName = saveState === 'saving'
    ? 'border-info text-info'
    : saveState === 'dirty'
      ? 'border-warning text-warning'
      : saveState === 'error'
        ? 'border-danger text-danger'
        : 'border-subtle text-muted';

  const assetStatusLabel = assetStatus === 'loading'
    ? 'Loading assets…'
    : assetStatus === 'error'
      ? 'Asset load error'
      : 'Assets ready';

  return (
    <div ref={rootRef} className="fullbleed">
      {isPresentMode ? (
        <div className="relative flex flex-col bg-canvas" style={{ height: '100vh' }}>
          <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 pointer-events-none">
            <div className="pointer-events-auto rounded border border-subtle bg-surface/90 px-3 py-2 backdrop-blur-sm">
              <div className="text-xs uppercase tracking-wide text-muted">Present mode</div>
              <div className="text-sm font-medium mt-1">{draftPresentation.name}</div>
              <div className="text-xs text-muted mt-1">{currentCanvasLabel}</div>
            </div>
            <div className="pointer-events-auto flex items-stretch bg-surface/90 border border-subtle backdrop-blur-sm overflow-hidden">
              {state.mode === 'video' && state.source === 'retrieval' && (
                <button onClick={returnToSelectedSlide} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-sm">Return</button>
              )}
              <button onClick={() => setIsRetrievalBrowserOpen((prev) => !prev)} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-sm">Marks</button>
              <button onClick={handlePresentPrevious} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-sm">Prev</button>
              <button onClick={handlePresentNext} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-sm">Next</button>
              <button onClick={() => void leavePresentMode()} className="self-stretch px-4 py-2 border-0 text-sm">Exit</button>
            </div>
          </div>

          {isRetrievalBrowserOpen && (
            <div className="absolute left-4 top-20 bottom-4 z-30 rounded border border-subtle shadow-2xl overflow-hidden">
              <PresentationAssetBrowser
                schema={taggingSchema}
                manifest={workingManifest}
                assetIndex={assetIndex}
                selectedMarkId={activeBrowserMarkId}
                selectedStillId={selectedStillId}
                selectedClipId={selectedClipId}
                clips={clips}
                mode="retrieval"
                compact
                onPreviewMark={previewMark}
              />
            </div>
          )}

          {toast && <div className="absolute left-4 bottom-4 z-20 px-3 py-1 text-xs text-warning border border-subtle bg-surface/90">{toast}</div>}
          {assetError && <div className="absolute left-4 bottom-14 z-20 px-3 py-1 text-xs text-danger border border-subtle bg-surface/90">{assetError}</div>}

          <div className="flex-1 min-h-0 p-4 bg-canvas">
            <PresentationCanvas
              state={state}
              stillUrlById={stillUrlById}
              annotatedStillUrlById={annotatedStillUrlById}
              annotationsByStillId={annotationsByStillId}
              annotationDocumentsByStillId={annotationDocumentsByStillId}
              videoUrlById={videoUrlById}
              isPresenting
              onVideoComplete={completeVideoPlayback}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col" style={{ height: '100vh' }}>
          <div className="flex items-stretch bg-surface border-b border-border shrink-0">
            <button onClick={onBack} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base">← Presentations</button>
            <div className="self-stretch flex items-center px-4 text-base font-medium truncate">{draftPresentation.name}</div>
            <span className="flex-1" />
            <button onClick={() => addTitleSlide('title')} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Add title</button>
            <button onClick={() => addTitleSlide('section')} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Add section</button>
            <button onClick={() => addTitleSlide('divider')} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Add divider</button>
            <button onClick={goToPreviousSlide} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Prev</button>
            <button onClick={goToNextSlide} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Next</button>
            <button onClick={handlePreviewTransition} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Preview</button>
            <button onClick={() => void enterPresentMode()} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Present</button>
            <button onClick={() => void persistDraft()} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Save now</button>
            <div className="self-stretch flex items-center gap-2 px-4 text-xs text-muted border-0 border-l border-solid border-border">
              <span className={`px-2 py-1 border bg-canvas ${saveStatusClassName}`}>{saveStatusLabel}</span>
              <span className="px-2 py-1 border border-subtle bg-canvas">{assetStatusLabel}</span>
              <span className="hidden 2xl:inline">←/→ navigate · Del delete · F present</span>
            </div>
          </div>

          {toast && <div className="shrink-0 px-3 py-1 text-xs text-warning border-b border-subtle">{toast}</div>}
          {assetError && <div className="shrink-0 px-3 py-1 text-xs text-danger border-b border-subtle">{assetError}</div>}

          <div className="flex-1 min-h-0 flex">
            <PresentationAssetBrowser
              schema={taggingSchema}
              manifest={workingManifest}
              assetIndex={assetIndex}
              selectedMarkId={activeBrowserMarkId}
              selectedStillId={selectedStillId}
              selectedClipId={selectedClipId}
              clips={clips}
              onPreviewMark={previewMark}
              onInsertStill={insertStillSlide}
              onInsertClip={insertClipSlide}
              onCreateStillForMark={createStillForMark}
            />

            <div className="flex-1 min-w-0 flex flex-col p-4 gap-4 bg-canvas">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted">Current canvas</div>
                  <div className="text-lg font-semibold mt-1">{currentCanvasLabel}</div>
                </div>
                {state.mode === 'still' && (
                  <div className="text-sm text-muted">
                    {state.still.videoId} · {formatTimestamp(state.still.t_ms)} · {state.showAnnotations ? 'Annotations on' : 'Annotations off'}
                  </div>
                )}
                {state.mode === 'clip' && (
                  <div className="text-sm text-muted">
                    {state.clip.videoId} · {formatTimestamp(state.clip.startMs)} → {formatTimestamp(state.clip.endMs)}
                  </div>
                )}
                {state.mode === 'video' && (
                  <div className="text-sm text-muted">
                    {state.videoId} · {formatTimestamp(state.startMs)}
                    {typeof state.endMs === 'number' ? ` → ${formatTimestamp(state.endMs)}` : ''}
                  </div>
                )}
                {captureBusyMarkId && <div className="text-sm text-muted">Creating still from mark…</div>}
              </div>

              <PresentationCanvas
                state={state}
                stillUrlById={stillUrlById}
                annotatedStillUrlById={annotatedStillUrlById}
                annotationsByStillId={annotationsByStillId}
                annotationDocumentsByStillId={annotationDocumentsByStillId}
                videoUrlById={videoUrlById}
                onVideoComplete={completeVideoPlayback}
              />
            </div>

            <PresentationInspector
              presentation={draftPresentation}
              manifest={workingManifest}
              clips={clips}
              selectedSlideIndex={selectedSlideIndex}
              state={state}
              annotationsByStillId={annotationsByStillId}
              annotationDocumentsByStillId={annotationDocumentsByStillId}
              currentTransition={currentTransition}
              onPreviewTransition={handlePreviewTransition}
              canUseMatchVideo={transitionCanUseMatchVideo}
              transitionValidationMessage={transitionValidationMessage}
              onDeleteSelectedSlide={deleteSelectedSlide}
              onUpdateSelectedSlide={(update, immediate) => updateSelectedSlide(update, immediate)}
              onUpdateSelectedTransition={updateTransition}
            />
          </div>

          <PresentationDeckStrip
            presentation={draftPresentation}
            selectedSlideIndex={selectedSlideIndex}
            thumbnailUrlByStillId={thumbnailUrlByStillId}
            onSelectSlide={showSlide}
            onReorderSlide={reorderSlide}
            onDeleteSlide={(slideIndex) => {
              const next = removeSlideAtIndex(workingManifest, draftPresentation, slideIndex);
              queuePersist(next, true);
              if (selectedSlideIndex >= next.slides.length) {
                const nextIndex = next.slides.length === 0 ? -1 : next.slides.length - 1;
                if (nextIndex >= 0) showSlide(nextIndex);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
