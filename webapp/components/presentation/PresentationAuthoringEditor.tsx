"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../../lib/state/ProjectContext';
import {
  mergeLoadedAnnotationDocuments,
  readAnnotationDocumentsForStill,
  type LoadedAnnotationDocument,
} from '../../lib/fs/annotationStorage';
import {
  buildExactMotionPendingOutputPath,
  buildPreviewProxyPendingOutputPath,
  cleanupPendingPreviewProxyFilesForActiveJobs,
  cleanupPendingExactMotionFilesForActiveJobs,
  deleteFileAtRelativePath,
  ensurePresentationDerivedMediaStorage,
  ensurePreviewProxyStorage,
  getExactMotionAssetIndexEntryByGenerationKey,
  getPreviewProxyIndexEntryByGenerationKey,
  promoteExactMotionJobIfCurrent,
  promotePreviewProxyJobIfCurrent,
  readPresentationDerivedMediaJobQueue,
  readPreviewProxyDerivedMediaJobQueue,
  reconcileExactMotionIndexWithCurrentGenerationKeys,
  syncExactMotionIndexWithFailedJobs,
  upsertExactMotionAssetIndexEntry,
  upsertPreviewProxyIndexEntry,
  validateExactMotionAssetIndex,
  validatePreviewProxyIndex,
  writeBlobAtRelativePath,
  writeExactMotionAssetIndex,
  writePresentationDerivedMediaJobQueue,
  writePresentationPreparationStatus,
  writePreviewProxyDerivedMediaJobQueue,
  writePreviewProxyIndex,
} from '../../lib/fs/derivedMediaStorage';
import { listClips, resolveMarkPinning } from '../../lib/fs/clipStorage';
import { writeManifest } from '../../lib/fs/projectFolder';
import { writePresentation } from '../../lib/fs/presentationStorage';
import type { Clip } from '../../lib/types/clip';
import type { ProjectManifestV1 } from '../../lib/types/project';
import type { Presentation, PresentationSlide, PresentationTransition, TitleSlide } from '../../lib/types/presentation';
import type { TaggingSchema } from '../../lib/tagging/schema';
import type { AnnotationsV1 } from '../../lib/export/d7Render';
import { renderAnnotatedPng } from '../../lib/export/d7Render';
import type {
  PlaybackAssetRegistry,
  PreferredPlaybackAssetIdByVideoId,
  PresentationPreparationStatusRecord,
  ResolvedPlaybackAsset,
} from '../../lib/presentation/derivedMediaTypes';
import { createPlaybackAssetObjectUrlRegistry } from '../../lib/presentation/playbackAssetObjectUrls';
import { recordMediaTrace } from '../../lib/presentation/mediaTrace';
import {
  enqueueDerivedMediaGenerationRequest,
  isQueuedExactMotionJobCurrentForPromotion,
  isQueuedPreviewProxyJobCurrentForPromotion,
  isTerminalDerivedMediaJobStatus,
  updateDerivedMediaJobSnapshot,
} from '../../lib/presentation/derivedMediaJobs';
import {
  cleanupDerivedMediaJob,
  downloadDerivedMediaJobOutput,
  getDerivedMediaJobStatus,
  registerVideoFile,
  requestExactMotionEncode,
  startPreviewProxyEncodeJob,
  unregisterVideoRef,
} from '../../lib/clip/sidecarClient';
import {
  buildPreviewProxyAssetId,
  buildWeakSourceFingerprint,
} from '../../lib/presentation/derivedMediaKeys';
import {
  buildPreparePresentationExactMotionRequest,
  buildPresentationPreparationStatusRecord,
  collectPresentClosureRequirements,
  collectPresentClosureVideoIds,
  evaluatePresentClosureRequirements,
  type PresentClosureEvaluation,
} from '../../lib/presentation/presentPreparation';
import {
  buildInteractivePreviewProxyGenerationPlan,
  countPresentationVideoReferences,
} from '../../lib/presentation/previewProxyPlanning';
import {
  buildClipPlaybackPreferenceKey,
  buildOriginalPlaybackAssetId,
  buildTransitionPlaybackPreferenceKey,
  createOriginalPlaybackAsset,
  findReadyExactClipPlaybackAsset,
  findReadyExactTransitionPlaybackAsset,
  findReadyPreviewProxyPlaybackAsset,
} from '../../lib/presentation/playbackAssetResolver';
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
const PREVIEW_PROXY_POLL_MS = 1500;

type PreviewProxyTouchState = {
  touchCountByVideoId: Record<string, number>;
  lastTouchKeyByVideoId: Record<string, string>;
};

const previewProxyTouchStateByProject = new WeakMap<FileSystemDirectoryHandle, PreviewProxyTouchState>();

function getPreviewProxyTouchState(projectDir: FileSystemDirectoryHandle): PreviewProxyTouchState {
  const existing = previewProxyTouchStateByProject.get(projectDir);
  if (existing) {
    return existing;
  }
  const next: PreviewProxyTouchState = {
    touchCountByVideoId: {},
    lastTouchKeyByVideoId: {},
  };
  previewProxyTouchStateByProject.set(projectDir, next);
  return next;
}

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

function isMissingDerivedMediaJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Unknown derived-media job');
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
  const [playbackAssetById, setPlaybackAssetById] = useState<PlaybackAssetRegistry>({});
  const [preferredPlaybackAssetIdByVideoId, setPreferredPlaybackAssetIdByVideoId] = useState<PreferredPlaybackAssetIdByVideoId>({});
  const [preferredPlaybackAssetIdsByPlaybackKey, setPreferredPlaybackAssetIdsByPlaybackKey] = useState<Record<string, string[]>>({});
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [captureBusyMarkId, setCaptureBusyMarkId] = useState<string | null>(null);
  const [isPresentMode, setIsPresentMode] = useState(false);
  const [presentModePolicy, setPresentModePolicy] = useState<'exact' | 'fallback' | null>(null);
  const [isRetrievalBrowserOpen, setIsRetrievalBrowserOpen] = useState(false);
  const [presentBusy, setPresentBusy] = useState(false);
  const [resolvedPlaybackAsset, setResolvedPlaybackAsset] = useState<ResolvedPlaybackAsset | null>(null);
  const stillUrlRegistryRef = useRef<Record<string, string>>({});
  const annotatedUrlRegistryRef = useRef<Record<string, string>>({});
  const thumbnailUrlRegistryRef = useRef<Record<string, string>>({});
  const retrievalDirectVideoUrlByVideoIdRef = useRef<Record<string, string>>({});
  const retrievalDirectVideoPathByVideoIdRef = useRef<Record<string, string>>({});
  const playbackAssetRegistryRef = useRef<PlaybackAssetRegistry>({});
  const previewProxyWorkerRunningRef = useRef(false);
  const previewProxyPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exactMotionWorkerRunningRef = useRef(false);
  const derivedMediaVideoRefByPathRef = useRef<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [previewProxyWorkerPass, setPreviewProxyWorkerPass] = useState(0);
  const [exactMotionWorkerPass, setExactMotionWorkerPass] = useState(0);
  const [derivedMediaAssetRefreshPass, setDerivedMediaAssetRefreshPass] = useState(0);

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

  useEffect(() => {
    let cancelled = false;
    const ensureDerivedMediaStorage = async () => {
      await Promise.all([
        ensurePreviewProxyStorage(projectDir),
        ensurePresentationDerivedMediaStorage(projectDir, presentation.id),
      ]);
    };
    void ensureDerivedMediaStorage().catch((e: any) => {
      if (!cancelled) {
        setToast(e?.message || String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectDir, presentation.id]);

  useEffect(() => {
    let cancelled = false;
    const cleanupPendingExactMotion = async () => {
      const queue = await readPresentationDerivedMediaJobQueue(projectDir, presentation.id);
      await cleanupPendingExactMotionFilesForActiveJobs(projectDir, presentation.id, queue);
      if (!cancelled) {
        setExactMotionWorkerPass((value) => value + 1);
      }
    };
    void cleanupPendingExactMotion().catch((error: any) => {
      if (!cancelled) {
        setToast(error?.message || String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectDir, presentation.id]);

  useEffect(() => {
    let cancelled = false;
    const cleanupPendingPreviewProxy = async () => {
      const queue = await readPreviewProxyDerivedMediaJobQueue(projectDir);
      await cleanupPendingPreviewProxyFilesForActiveJobs(projectDir, queue);
      if (!cancelled) {
        setPreviewProxyWorkerPass((value) => value + 1);
      }
    };
    void cleanupPendingPreviewProxy().catch((error: any) => {
      if (!cancelled) {
        setToast(error?.message || String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectDir]);

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

  useEffect(() => {
    return () => {
      const videoRefs = Object.values(derivedMediaVideoRefByPathRef.current);
      derivedMediaVideoRefByPathRef.current = {};
      if (previewProxyPollTimerRef.current) {
        clearTimeout(previewProxyPollTimerRef.current);
        previewProxyPollTimerRef.current = null;
      }
      videoRefs.forEach((videoRef) => {
        void unregisterVideoRef(videoRef).catch(() => {});
      });
    };
  }, [draftPresentation.id]);

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

  const playbackAssetObjectUrlRegistry = useMemo(() => {
    void draftPresentation.id;
    return createPlaybackAssetObjectUrlRegistry({
      projectDir,
      getFileForPath,
    });
  }, [draftPresentation.id, projectDir, getFileForPath]);

  useEffect(() => {
    revokeUrls(retrievalDirectVideoUrlByVideoIdRef.current);
    retrievalDirectVideoUrlByVideoIdRef.current = {};
    retrievalDirectVideoPathByVideoIdRef.current = {};
    playbackAssetRegistryRef.current = {};
    setPlaybackAssetById({});
    setPreferredPlaybackAssetIdByVideoId({});
    setPreferredPlaybackAssetIdsByPlaybackKey({});
    setResolvedPlaybackAsset(null);
    setPresentBusy(false);
    setIsPresentMode(false);
    setPresentModePolicy(null);
    setIsRetrievalBrowserOpen(false);
  }, [draftPresentation.id]);

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
  const warmedTransitionVideoId = currentTransition?.transition.mode === 'match_video'
    && currentTransition.playable
    && currentTransition.videoId
    ? currentTransition.videoId
    : null;
  const activePreviewProxyTouchKey = useMemo(() => {
    if (state.mode === 'clip') {
      return `clip:${state.slide.id}:${state.clip.id}:${state.clip.videoId}`;
    }
    if (state.mode !== 'video') {
      return null;
    }
    if (state.source === 'retrieval') {
      // Retrieved mark preview stays on the older direct original-video loader for now.
      return null;
    }
    if (state.source === 'transition') {
      return `transition:${selectedSlideIndex}:${state.videoId}:${state.startMs}:${state.endMs ?? 'none'}`;
    }
    if (state.source === 'clip') {
      return `clip-video:${selectedSlideIndex}:${state.videoId}:${state.startMs}:${state.endMs ?? 'none'}`;
    }
    return null;
  }, [state, selectedSlideIndex]);
  const requestedVideoIds = useMemo(() => Array.from(new Set([
    activeVideoId,
    warmedTransitionVideoId,
  ].filter((value): value is string => !!value))), [activeVideoId, warmedTransitionVideoId]);

  useEffect(() => {
    if (!activeVideoId || !activePreviewProxyTouchKey) {
      return;
    }
    const touchState = getPreviewProxyTouchState(projectDir);
    if (touchState.lastTouchKeyByVideoId[activeVideoId] === activePreviewProxyTouchKey) {
      return;
    }
    touchState.lastTouchKeyByVideoId[activeVideoId] = activePreviewProxyTouchKey;
    touchState.touchCountByVideoId[activeVideoId] = (touchState.touchCountByVideoId[activeVideoId] ?? 0) + 1;
  }, [projectDir, activeVideoId, activePreviewProxyTouchKey]);

  useEffect(() => {
    if (requestedVideoIds.length === 0) {
      setPreferredPlaybackAssetIdsByPlaybackKey({});
      return;
    }
    const activeTransitionPlaybackKey = state.mode === 'video' && state.source === 'transition'
      ? buildTransitionPlaybackPreferenceKey({
          presentationId: draftPresentation.id,
          slotKey: state.source,
          videoId: state.videoId,
          startMs: state.startMs,
          endMs: state.endMs ?? null,
        })
      : null;
    const activeClipPlaybackKey = state.mode === 'clip'
      ? buildClipPlaybackPreferenceKey({
          presentationId: draftPresentation.id,
          slideId: state.slide.id,
          videoId: state.clip.videoId,
          startMs: state.clip.startMs,
          endMs: state.clip.endMs,
        })
      : null;
    const warmedTransitionPlaybackKey = currentTransition?.transition.mode === 'match_video'
      && currentTransition.playable
      && currentTransition.videoId
      && currentTransition.startMs != null
      && currentTransition.endMs != null
      ? buildTransitionPlaybackPreferenceKey({
          presentationId: draftPresentation.id,
          slotKey: `warm:${currentTransition.fromSlideIndex}`,
          videoId: currentTransition.videoId,
          startMs: currentTransition.startMs,
          endMs: currentTransition.endMs,
        })
      : null;
    let cancelled = false;
    const loadVideos = async () => {
      const nextAssets: PlaybackAssetRegistry = {};
      const nextPreferred: PreferredPlaybackAssetIdByVideoId = {};
      const nextPreferredByPlaybackKey: Record<string, string[]> = {};
      let previewProxyIndex = await validatePreviewProxyIndex(projectDir);
      let previewProxyJobQueue = await readPreviewProxyDerivedMediaJobQueue(projectDir);
      const exactMotionIndex = await validateExactMotionAssetIndex(projectDir, draftPresentation.id);
      const sourceFingerprintByVideoId: Record<string, string> = {};
      let previewProxyQueueChanged = false;
      let previewProxyIndexChanged = false;
      const createdAt = new Date().toISOString();
      try {
        for (const videoId of requestedVideoIds) {
          const video = workingManifest.videos.find((entry) => entry.id === videoId);
          if (!video) throw new Error(`Video not found: ${videoId}`);
          const file = await getFileForPath(projectDir, video.file);
          const sourceFingerprint = buildWeakSourceFingerprint({
            projectRelativeVideoPath: video.file,
            byteSize: file.size,
            lastModifiedMs: file.lastModified,
          });
          sourceFingerprintByVideoId[videoId] = sourceFingerprint;

          const previewAsset = findReadyPreviewProxyPlaybackAsset({
            videoId,
            sourceFingerprint,
            previewProxyEntries: previewProxyIndex.entries,
          });
          const shouldQueueInteractivePreviewProxy = !(
            state.mode === 'video'
            && state.source === 'retrieval'
            && state.videoId === videoId
          );
          if (previewAsset) {
            nextAssets[previewAsset.assetId] = previewAsset;
            nextPreferred[videoId] = previewAsset.assetId;
          } else if (shouldQueueInteractivePreviewProxy) {
            const touchState = getPreviewProxyTouchState(projectDir);
            const presentationReferenceCount = countPresentationVideoReferences({
              presentation: draftPresentation,
              manifest: workingManifest,
              clipById,
              videoId,
            });
            const previewPlan = buildInteractivePreviewProxyGenerationPlan({
              videoId,
              sourceFingerprint,
              sourceVideoPath: video.file,
              previewProxyIndex,
              previewJobQueue: previewProxyJobQueue,
              byteSize: file.size,
              durationMs: video.durationMs ?? null,
              sessionTouchCount: touchState.touchCountByVideoId[videoId] ?? 0,
              presentationReferenceCount,
            });
            const existingPreviewEntry = getPreviewProxyIndexEntryByGenerationKey(previewProxyIndex, previewPlan.generationKey);
            if (previewPlan.request) {
              const enqueueResult = enqueueDerivedMediaGenerationRequest(previewProxyJobQueue, previewPlan.request, 'interactive');
              previewProxyJobQueue = enqueueResult.queue;
              previewProxyQueueChanged = previewProxyQueueChanged || enqueueResult.created;
              previewProxyIndex = upsertPreviewProxyIndexEntry(previewProxyIndex, {
                assetId: previewPlan.assetId,
                generationKey: previewPlan.generationKey,
                sourceVideoId: videoId,
                sourceFingerprint,
                relativePath: previewPlan.relativePath,
                status: 'queued',
                profileVersion: previewPlan.request.profileVersion,
                createdAt: existingPreviewEntry?.createdAt ?? createdAt,
                lastUsedAt: existingPreviewEntry?.lastUsedAt,
                byteSize: existingPreviewEntry?.byteSize,
                durationMs: existingPreviewEntry?.durationMs,
                error: undefined,
              });
              previewProxyIndexChanged = true;
            }
          }

          const originalAssetId = buildOriginalPlaybackAssetId(videoId);
          let directOriginalObjectUrl: string | null = null;
          if (state.mode === 'video' && state.source === 'retrieval' && state.videoId === videoId) {
            const existingDirectUrl = retrievalDirectVideoUrlByVideoIdRef.current[videoId] ?? null;
            const existingDirectPath = retrievalDirectVideoPathByVideoIdRef.current[videoId] ?? null;
            if (existingDirectUrl && existingDirectPath === video.file) {
              directOriginalObjectUrl = existingDirectUrl;
            } else {
              directOriginalObjectUrl = URL.createObjectURL(file);
              if (existingDirectUrl && existingDirectUrl !== directOriginalObjectUrl) {
                try {
                  URL.revokeObjectURL(existingDirectUrl);
                } catch {}
              }
              retrievalDirectVideoUrlByVideoIdRef.current[videoId] = directOriginalObjectUrl;
              retrievalDirectVideoPathByVideoIdRef.current[videoId] = video.file;
              console.info('[PresentationAuthoringEditor] Loaded direct retrieval video URL', {
                videoId,
                filePath: video.file,
              });
            }
          }
          const asset = createOriginalPlaybackAsset(videoId, video.file, directOriginalObjectUrl);
          nextAssets[asset.assetId] = asset;
          if (!nextPreferred[videoId]) {
            nextPreferred[videoId] = originalAssetId;
          }
        }

        if (currentTransition?.transition.mode === 'match_video'
          && currentTransition.playable
          && currentTransition.videoId
          && currentTransition.startMs != null
          && currentTransition.endMs != null) {
          const fromSlide = draftPresentation.slides[currentTransition.fromSlideIndex];
          const toSlide = draftPresentation.slides[currentTransition.toSlideIndex];
          const sourceFingerprint = sourceFingerprintByVideoId[currentTransition.videoId];
          if (fromSlide && toSlide && sourceFingerprint) {
            const exactAsset = findReadyExactTransitionPlaybackAsset({
              presentationId: draftPresentation.id,
              transitionIndex: currentTransition.fromSlideIndex,
              fromSlideId: fromSlide.id,
              toSlideId: toSlide.id,
              sourceVideoId: currentTransition.videoId,
              sourceFingerprint,
              startMs: currentTransition.startMs,
              endMs: currentTransition.endMs,
              playbackRate: currentTransition.playbackRate ?? null,
              startOffsetMs: currentTransition.transition.startOffsetMs ?? null,
              endOffsetMs: currentTransition.transition.endOffsetMs ?? null,
              hideAnnotationsDuringPlayback: currentTransition.hideAnnotationsDuringPlayback ?? false,
              exactMotionEntries: exactMotionIndex.entries,
            });
            if (exactAsset) {
              nextAssets[exactAsset.assetId] = exactAsset;
              const exactPreference = [exactAsset.assetId];
              if (activeTransitionPlaybackKey) {
                nextPreferredByPlaybackKey[activeTransitionPlaybackKey] = exactPreference;
              }
              if (warmedTransitionPlaybackKey) {
                nextPreferredByPlaybackKey[warmedTransitionPlaybackKey] = exactPreference;
              }
            }
          }
        }

        if (state.mode === 'clip') {
          const sourceFingerprint = sourceFingerprintByVideoId[state.clip.videoId];
          if (sourceFingerprint && activeClipPlaybackKey) {
            const exactAsset = findReadyExactClipPlaybackAsset({
              presentationId: draftPresentation.id,
              clipId: state.clip.id,
              slideId: state.slide.id,
              sourceVideoId: state.clip.videoId,
              sourceFingerprint,
              startMs: state.clip.startMs,
              endMs: state.clip.endMs,
              exactMotionEntries: exactMotionIndex.entries,
            });
            if (exactAsset) {
              nextAssets[exactAsset.assetId] = exactAsset;
              nextPreferredByPlaybackKey[activeClipPlaybackKey] = [exactAsset.assetId];
            }
          }
        }
        if (cancelled) {
          return;
        }
        if (previewProxyQueueChanged) {
          await writePreviewProxyDerivedMediaJobQueue(projectDir, previewProxyJobQueue);
        }
        if (previewProxyIndexChanged) {
          await writePreviewProxyIndex(projectDir, previewProxyIndex);
        }
        if (previewProxyQueueChanged) {
          setPreviewProxyWorkerPass((value) => value + 1);
        }
        playbackAssetRegistryRef.current = { ...playbackAssetRegistryRef.current, ...nextAssets };
        setPlaybackAssetById((prev) => ({ ...prev, ...nextAssets }));
        setPreferredPlaybackAssetIdByVideoId((prev) => ({ ...prev, ...nextPreferred }));
        setPreferredPlaybackAssetIdsByPlaybackKey(nextPreferredByPlaybackKey);
      } catch (error) {
        throw error;
      }
    };
    loadVideos().catch((e: any) => {
      if (cancelled) return;
      setAssetError(e?.message || String(e));
      setToast(e?.message || String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [
    requestedVideoIds,
    state,
    currentTransition,
    workingManifest,
    draftPresentation,
    clipById,
    projectDir,
    getFileForPath,
    selectedSlideIndex,
    derivedMediaAssetRefreshPass,
  ]);

  useEffect(() => {
    return () => {
      revokeUrls(stillUrlRegistryRef.current);
      revokeUrls(annotatedUrlRegistryRef.current);
      revokeUrls(thumbnailUrlRegistryRef.current);
      revokeUrls(retrievalDirectVideoUrlByVideoIdRef.current);
      playbackAssetObjectUrlRegistry.dispose();
    };
  }, [playbackAssetObjectUrlRegistry]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isFullscreen) {
        setIsPresentMode(false);
        setPresentModePolicy(null);
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

  const computePresentClosureState = useCallback(async (): Promise<{
    evaluation: PresentClosureEvaluation;
    statusRecord: PresentationPreparationStatusRecord;
  }> => {
    const closureVideoIds = collectPresentClosureVideoIds(draftPresentation, workingManifest, clipById);
    const sourceFingerprintByVideoId: Record<string, string> = {};
    for (const videoId of closureVideoIds) {
      const video = workingManifest.videos.find((entry) => entry.id === videoId);
      if (!video) continue;
      const file = await getFileForPath(projectDir, video.file);
      sourceFingerprintByVideoId[videoId] = buildWeakSourceFingerprint({
        projectRelativeVideoPath: video.file,
        byteSize: file.size,
        lastModifiedMs: file.lastModified,
      });
    }
    const jobQueue = await readPresentationDerivedMediaJobQueue(projectDir, draftPresentation.id);
    await syncExactMotionIndexWithFailedJobs(projectDir, draftPresentation.id, jobQueue);
    let exactMotionIndex = await validateExactMotionAssetIndex(projectDir, draftPresentation.id);
    const requirements = collectPresentClosureRequirements({
      presentation: draftPresentation,
      manifest: workingManifest,
      clipById,
      sourceFingerprintByVideoId,
      exactMotionIndex,
    });
    const referencedGenerationKeys = new Set(
      requirements
        .map((requirement) => requirement.generationKey)
        .filter((generationKey): generationKey is string => !!generationKey),
    );
    const reconciledIndexResult = await reconcileExactMotionIndexWithCurrentGenerationKeys(
      projectDir,
      draftPresentation.id,
      exactMotionIndex,
      referencedGenerationKeys,
    );
    if (reconciledIndexResult.changed) {
      exactMotionIndex = reconciledIndexResult.index;
      await writeExactMotionAssetIndex(projectDir, draftPresentation.id, exactMotionIndex);
    }
    const reconciledRequirements = reconciledIndexResult.changed
      ? collectPresentClosureRequirements({
          presentation: draftPresentation,
          manifest: workingManifest,
          clipById,
          sourceFingerprintByVideoId,
          exactMotionIndex,
        })
      : requirements;
    const evaluation = evaluatePresentClosureRequirements(reconciledRequirements);
    const queuedJobCount = jobQueue.jobs.filter((job) => (
      job.executionMode === 'prepare_presentation'
      && job.snapshot.presentationId === draftPresentation.id
      && !isTerminalDerivedMediaJobStatus(job.snapshot.status)
    )).length;
    const statusRecord = buildPresentationPreparationStatusRecord(evaluation, queuedJobCount);
    await writePresentationPreparationStatus(projectDir, draftPresentation.id, {
      schema: 1,
      preparation: statusRecord,
    });
    return {
      evaluation,
      statusRecord,
    };
  }, [draftPresentation, workingManifest, clipById, projectDir, getFileForPath]);

  useEffect(() => {
    let cancelled = false;
    const loadPresentClosureEvaluation = async () => {
      await computePresentClosureState();
    };
    void loadPresentClosureEvaluation().catch(() => {
      if (!cancelled) {
        setToast('Unable to refresh presentation playback readiness');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [computePresentClosureState]);

  const assetIndex = useMemo(() => buildPresentationAssetIndex(taggingSchema, workingManifest), [taggingSchema, workingManifest]);
  const selectedSlide = selectedSlideIndex >= 0 ? draftPresentation.slides[selectedSlideIndex] ?? null : null;
  const selectedStillId = selectedSlide?.kind === 'still' ? selectedSlide.stillId : null;
  const selectedClipId = selectedSlide?.kind === 'clip' ? selectedSlide.clipId : null;
  const selectedStillSourceMarkId = state.mode === 'still' ? state.still.sourceMarkId ?? null : null;

  const previewMark = useCallback((mark: ProjectManifestV1['marks'][number]) => {
    if (isPresentMode && presentModePolicy === 'exact') {
      setIsRetrievalBrowserOpen(false);
      setToast('Mark retrieval is unavailable during exact presentation playback');
      return;
    }
    setSelectedMarkId(mark.id);
    if (isPresentMode) {
      setIsRetrievalBrowserOpen(false);
    }
    retrieveMark(mark);
  }, [isPresentMode, presentModePolicy, retrieveMark]);

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
          ? (isPresentMode ? 'Transition' : 'Transition preview')
          : 'Retrieved mark preview'
        : state.mode === 'missing'
          ? 'Missing asset'
          : 'Empty presentation';

  const activeBrowserMarkId = selectedMarkId ?? selectedStillSourceMarkId;

  const isRetrievalVideoState = state.mode === 'video' && state.source === 'retrieval';
  const directRetrievalVideoUrl = isRetrievalVideoState
    ? retrievalDirectVideoUrlByVideoIdRef.current[state.videoId] ?? null
    : null;
  const presentStateSource = state.mode === 'video' ? state.source : null;

  const refreshPresentClosureState = useCallback(async () => {
    await computePresentClosureState();
  }, [computePresentClosureState]);

  const requestPreviewProxyWorkerPass = useCallback(() => {
    setPreviewProxyWorkerPass((value) => value + 1);
  }, []);

  const schedulePreviewProxyWorkerPoll = useCallback((delayMs: number = PREVIEW_PROXY_POLL_MS) => {
    if (previewProxyPollTimerRef.current) {
      return;
    }
    previewProxyPollTimerRef.current = setTimeout(() => {
      previewProxyPollTimerRef.current = null;
      requestPreviewProxyWorkerPass();
    }, delayMs);
  }, [requestPreviewProxyWorkerPass]);

  const requestExactMotionWorkerPass = useCallback(() => {
    setExactMotionWorkerPass((value) => value + 1);
  }, []);

  const requestDerivedMediaAssetRefresh = useCallback(() => {
    setDerivedMediaAssetRefreshPass((value) => value + 1);
  }, []);

  const ensureDerivedMediaVideoRef = useCallback(async (videoPath: string) => {
    const existing = derivedMediaVideoRefByPathRef.current[videoPath];
    if (existing) {
      return existing;
    }
    const file = await getFileForPath(projectDir, videoPath);
    const registration = await registerVideoFile(file);
    derivedMediaVideoRefByPathRef.current[videoPath] = registration.videoRef;
    return registration.videoRef;
  }, [getFileForPath, projectDir]);

  const processNextPreviewProxyJob = useCallback(async () => {
    if (previewProxyWorkerRunningRef.current) {
      return false;
    }
    previewProxyWorkerRunningRef.current = true;
    try {
      let jobQueue = await readPreviewProxyDerivedMediaJobQueue(projectDir);
      const nextJob = jobQueue.jobs.find((job) => (
        job.request.kind === 'preview_proxy_generate'
        && job.snapshot.kind === 'preview_proxy_generate'
        && !isTerminalDerivedMediaJobStatus(job.snapshot.status)
      ));
      if (!nextJob || nextJob.request.kind !== 'preview_proxy_generate') {
        return false;
      }

      const sourceVideo = workingManifest.videos.find((video) => video.id === nextJob.request.sourceVideoId);
      if (!sourceVideo) {
        throw new Error(`Source video not found: ${nextJob.request.sourceVideoId}`);
      }
      const relativePath = nextJob.request.outputPath.replace('derived-media/preview-proxies/', '');

      const writePreviewProxyQueueStatus = async ({
        status,
        label,
        error,
        remoteJobId,
      }: {
        status: 'queued' | 'running' | 'finalizing' | 'ready' | 'failed' | 'cancelled' | 'obsolete';
        label: string;
        error?: string;
        remoteJobId?: string;
      }) => {
        jobQueue = {
          schema: jobQueue.schema,
          jobs: jobQueue.jobs.map((job) => job.snapshot.jobId !== nextJob.snapshot.jobId
            ? job
            : {
                ...job,
                snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
                  status,
                  error,
                  remoteJobId,
                  progress: {
                    ...job.snapshot.progress,
                    status,
                    label,
                    durationMs: sourceVideo.durationMs ?? job.snapshot.progress?.durationMs,
                  },
                }),
              }),
        };
        await writePreviewProxyDerivedMediaJobQueue(projectDir, jobQueue);
      };

      const writePreviewProxyIndexStatus = async ({
        status,
        error,
        byteSize,
      }: {
        status: 'queued' | 'running' | 'ready' | 'failed' | 'stale';
        error?: string;
        byteSize?: number;
      }) => {
        const previewProxyIndex = await validatePreviewProxyIndex(projectDir);
        const existingEntry = getPreviewProxyIndexEntryByGenerationKey(previewProxyIndex, nextJob.snapshot.generationKey);
        await writePreviewProxyIndex(projectDir, upsertPreviewProxyIndexEntry(previewProxyIndex, {
          assetId: existingEntry?.assetId ?? buildPreviewProxyAssetId(nextJob.request.sourceVideoId, nextJob.snapshot.generationKey),
          generationKey: nextJob.snapshot.generationKey,
          sourceVideoId: nextJob.request.sourceVideoId,
          sourceFingerprint: nextJob.request.sourceFingerprint,
          relativePath: existingEntry?.relativePath ?? relativePath,
          status,
          profileVersion: nextJob.request.profileVersion,
          createdAt: existingEntry?.createdAt ?? nextJob.queuedAt,
          lastUsedAt: existingEntry?.lastUsedAt,
          byteSize: byteSize ?? existingEntry?.byteSize,
          durationMs: sourceVideo.durationMs ?? existingEntry?.durationMs,
          error,
        }));
      };

      let activeRemoteJobId = nextJob.snapshot.remoteJobId;
      let remoteJob: Awaited<ReturnType<typeof getDerivedMediaJobStatus>> | null = null;
      if (!activeRemoteJobId) {
        const videoRef = await ensureDerivedMediaVideoRef(sourceVideo.file);
        console.info('[PresentationAuthoringEditor] Starting preview-proxy encode', {
          sourceVideoId: nextJob.request.sourceVideoId,
          generationKey: nextJob.snapshot.generationKey,
          outputPath: nextJob.request.outputPath,
          videoRef,
        });
        remoteJob = await startPreviewProxyEncodeJob({ videoRef });
        activeRemoteJobId = remoteJob.jobId;
        if (!(remoteJob.status === 'ready' && remoteJob.outputAvailable)) {
          await writePreviewProxyQueueStatus({
            status: remoteJob.status === 'queued' ? 'queued' : remoteJob.status === 'finalizing' ? 'finalizing' : 'running',
            label: remoteJob.label ?? 'Encoding preview proxy',
            error: undefined,
            remoteJobId: remoteJob.jobId,
          });
          await writePreviewProxyIndexStatus({
            status: remoteJob.status === 'queued' ? 'queued' : 'running',
            error: undefined,
          });
          schedulePreviewProxyWorkerPoll();
          return false;
        }
      }

      if (!activeRemoteJobId) {
        schedulePreviewProxyWorkerPoll();
        return false;
      }

      if (!remoteJob) {
        try {
          remoteJob = await getDerivedMediaJobStatus(activeRemoteJobId);
        } catch (error) {
          if (isMissingDerivedMediaJobError(error)) {
            await writePreviewProxyQueueStatus({
              status: 'queued',
              label: 'Queued for retry',
              error: undefined,
              remoteJobId: undefined,
            });
            await writePreviewProxyIndexStatus({
              status: 'queued',
              error: undefined,
            });
            console.warn('[PresentationAuthoringEditor] Preview-proxy remote job missing; re-queueing', {
              sourceVideoId: nextJob.request.sourceVideoId,
              generationKey: nextJob.snapshot.generationKey,
              outputPath: nextJob.request.outputPath,
              remoteJobId: activeRemoteJobId,
            });
            return true;
          }
          throw error;
        }
      }

      if (remoteJob.status === 'queued' || remoteJob.status === 'running' || remoteJob.status === 'finalizing') {
        await writePreviewProxyQueueStatus({
          status: remoteJob.status === 'queued' ? 'queued' : remoteJob.status === 'finalizing' ? 'finalizing' : 'running',
          label: remoteJob.label ?? (remoteJob.status === 'queued' ? 'Queued' : 'Encoding preview proxy'),
          error: undefined,
          remoteJobId: remoteJob.jobId,
        });
        await writePreviewProxyIndexStatus({
          status: remoteJob.status === 'queued' ? 'queued' : 'running',
          error: undefined,
        });
        schedulePreviewProxyWorkerPoll();
        return false;
      }

      if (remoteJob.status === 'ready' && remoteJob.outputAvailable) {
        await writePreviewProxyQueueStatus({
          status: 'finalizing',
          label: 'Downloading preview proxy',
          error: undefined,
          remoteJobId: remoteJob.jobId,
        });
        await writePreviewProxyIndexStatus({
          status: 'running',
          error: undefined,
        });

        const encodedBlob = await downloadDerivedMediaJobOutput(remoteJob.jobId);
        const pendingOutputPath = buildPreviewProxyPendingOutputPath(nextJob.request.outputPath);
        await writeBlobAtRelativePath(projectDir, pendingOutputPath, encodedBlob);

        const latestQueue = await readPreviewProxyDerivedMediaJobQueue(projectDir);
        const latestIndex = await validatePreviewProxyIndex(projectDir);
        if (!isQueuedPreviewProxyJobCurrentForPromotion(latestQueue, nextJob.snapshot.jobId)) {
          const obsoletePromotion = promotePreviewProxyJobIfCurrent({
            queue: latestQueue,
            index: latestIndex,
            jobId: nextJob.snapshot.jobId,
          });
          await deleteFileAtRelativePath(projectDir, pendingOutputPath);
          await writePreviewProxyDerivedMediaJobQueue(projectDir, obsoletePromotion.queue);
          await writePreviewProxyIndex(projectDir, obsoletePromotion.index);
          await cleanupDerivedMediaJob(remoteJob.jobId);
          requestDerivedMediaAssetRefresh();
          return true;
        }

        await writeBlobAtRelativePath(projectDir, nextJob.request.outputPath, encodedBlob);
        await deleteFileAtRelativePath(projectDir, pendingOutputPath);

        const promoted = promotePreviewProxyJobIfCurrent({
          queue: latestQueue,
          index: latestIndex,
          jobId: nextJob.snapshot.jobId,
          byteSize: encodedBlob.size,
          durationMs: sourceVideo.durationMs,
        });
        await writePreviewProxyDerivedMediaJobQueue(projectDir, promoted.queue);
        await writePreviewProxyIndex(projectDir, promoted.index);
        await cleanupDerivedMediaJob(remoteJob.jobId);
        console.info('[PresentationAuthoringEditor] Preview proxy ready', {
          sourceVideoId: nextJob.request.sourceVideoId,
          generationKey: nextJob.snapshot.generationKey,
          outputPath: nextJob.request.outputPath,
          byteSize: encodedBlob.size,
        });
        requestDerivedMediaAssetRefresh();
        return true;
      }

      const failureMessage = remoteJob.error
        ?? (remoteJob.status === 'cancelled'
          ? 'Preview-proxy generation cancelled'
          : 'Preview-proxy generation failed');
      await writePreviewProxyQueueStatus({
        status: remoteJob.status === 'cancelled' ? 'cancelled' : 'failed',
        label: remoteJob.label ?? (remoteJob.status === 'cancelled' ? 'Cancelled' : 'Failed'),
        error: failureMessage,
        remoteJobId: undefined,
      });
      await writePreviewProxyIndexStatus({
        status: 'failed',
        error: failureMessage,
      });
      await cleanupDerivedMediaJob(remoteJob.jobId);
      console.error('[PresentationAuthoringEditor] Preview-proxy job failed', {
        sourceVideoId: nextJob.request.sourceVideoId,
        generationKey: nextJob.snapshot.generationKey,
        outputPath: nextJob.request.outputPath,
        remoteJob,
      });
      setToast(failureMessage);
      return true;
    } catch (error: any) {
      const message = error?.message || String(error);
      const jobQueue = await readPreviewProxyDerivedMediaJobQueue(projectDir);
      const nextJob = jobQueue.jobs.find((job) => (
        job.request.kind === 'preview_proxy_generate'
        && job.snapshot.kind === 'preview_proxy_generate'
        && !isTerminalDerivedMediaJobStatus(job.snapshot.status)
      ));
      if (!nextJob || nextJob.request.kind !== 'preview_proxy_generate') {
        setToast(message);
        return false;
      }
      const latestIndex = await validatePreviewProxyIndex(projectDir);
      const existingEntry = getPreviewProxyIndexEntryByGenerationKey(latestIndex, nextJob.snapshot.generationKey);
      const relativePath = nextJob.request.outputPath.replace('derived-media/preview-proxies/', '');
      const failedIndex = upsertPreviewProxyIndexEntry(latestIndex, {
        assetId: existingEntry?.assetId ?? buildPreviewProxyAssetId(nextJob.request.sourceVideoId, nextJob.snapshot.generationKey),
        generationKey: nextJob.snapshot.generationKey,
        sourceVideoId: nextJob.request.sourceVideoId,
        sourceFingerprint: nextJob.request.sourceFingerprint,
        relativePath: existingEntry?.relativePath ?? relativePath,
        status: 'failed',
        profileVersion: nextJob.request.profileVersion,
        createdAt: existingEntry?.createdAt ?? nextJob.queuedAt,
        lastUsedAt: existingEntry?.lastUsedAt,
        byteSize: existingEntry?.byteSize,
        durationMs: workingManifest.videos.find((video) => video.id === nextJob.request.sourceVideoId)?.durationMs ?? existingEntry?.durationMs,
        error: message,
      });
      const failedQueue = {
        schema: jobQueue.schema,
        jobs: jobQueue.jobs.map((job) => job.snapshot.jobId !== nextJob.snapshot.jobId
          ? job
          : {
              ...job,
              snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
                status: 'failed',
                error: message,
                remoteJobId: undefined,
                progress: {
                  ...job.snapshot.progress,
                  status: 'failed',
                  label: 'Failed',
                },
              }),
            }),
      };
      await writePreviewProxyDerivedMediaJobQueue(projectDir, failedQueue);
      await writePreviewProxyIndex(projectDir, failedIndex);
      console.error('[PresentationAuthoringEditor] Preview-proxy job failed', {
        sourceVideoId: nextJob.request.sourceVideoId,
        generationKey: nextJob.snapshot.generationKey,
        outputPath: nextJob.request.outputPath,
        error,
      });
      setToast(message);
      return true;
    } finally {
      previewProxyWorkerRunningRef.current = false;
    }
  }, [
    schedulePreviewProxyWorkerPoll,
    ensureDerivedMediaVideoRef,
    projectDir,
    requestDerivedMediaAssetRefresh,
    workingManifest.videos,
  ]);

  const processNextExactMotionJob = useCallback(async () => {
    if (exactMotionWorkerRunningRef.current) {
      return false;
    }
    exactMotionWorkerRunningRef.current = true;
    try {
      let jobQueue = await readPresentationDerivedMediaJobQueue(projectDir, draftPresentation.id);
      const nextJob = jobQueue.jobs.find((job) => (
        job.request.kind === 'exact_motion_generate'
        && job.snapshot.kind === 'exact_motion_generate'
        && job.snapshot.presentationId === draftPresentation.id
        && !isTerminalDerivedMediaJobStatus(job.snapshot.status)
      ));
      if (!nextJob || nextJob.request.kind !== 'exact_motion_generate') {
        return false;
      }
      const nextRequest = nextJob.request;

      const sourceVideo = workingManifest.videos.find((video) => video.id === nextRequest.sourceVideoId);
      if (!sourceVideo) {
        throw new Error(`Source video not found: ${nextRequest.sourceVideoId}`);
      }

      jobQueue = {
        schema: jobQueue.schema,
        jobs: jobQueue.jobs.map((job) => job.snapshot.jobId !== nextJob.snapshot.jobId
          ? job
          : {
              ...job,
              snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
                status: 'running',
                error: undefined,
                progress: {
                  ...job.snapshot.progress,
                  status: 'running',
                  label: 'Encoding exact motion',
                  durationMs: nextRequest.bounds.endMs - nextRequest.bounds.startMs,
                },
              }),
            }),
      };
      await writePresentationDerivedMediaJobQueue(projectDir, draftPresentation.id, jobQueue);
      await refreshPresentClosureState();

      const videoRef = await ensureDerivedMediaVideoRef(sourceVideo.file);
      console.info('[PresentationAuthoringEditor] Starting exact-motion encode', {
        sourceVideoId: nextRequest.sourceVideoId,
        generationKey: nextRequest.generationKey,
        outputPath: nextRequest.outputPath,
        bounds: nextRequest.bounds,
        videoRef,
      });
      const encodedBlob = await requestExactMotionEncode({
        videoRef,
        startMs: nextRequest.bounds.startMs,
        endMs: nextRequest.bounds.endMs,
      });
      const pendingOutputPath = buildExactMotionPendingOutputPath(nextRequest.outputPath);
      await writeBlobAtRelativePath(projectDir, pendingOutputPath, encodedBlob);

      const latestQueue = await readPresentationDerivedMediaJobQueue(projectDir, draftPresentation.id);
      const latestIndex = await validateExactMotionAssetIndex(projectDir, draftPresentation.id);
      if (!isQueuedExactMotionJobCurrentForPromotion(latestQueue, nextJob.snapshot.jobId)) {
        const obsoletePromotion = promoteExactMotionJobIfCurrent({
          presentationId: draftPresentation.id,
          queue: latestQueue,
          index: latestIndex,
          jobId: nextJob.snapshot.jobId,
        });
        await deleteFileAtRelativePath(projectDir, pendingOutputPath);
        await writePresentationDerivedMediaJobQueue(projectDir, draftPresentation.id, obsoletePromotion.queue);
        await writeExactMotionAssetIndex(projectDir, draftPresentation.id, obsoletePromotion.index);
        await refreshPresentClosureState();
        return true;
      }

      await writeBlobAtRelativePath(projectDir, nextRequest.outputPath, encodedBlob);
      await deleteFileAtRelativePath(projectDir, pendingOutputPath);

      const promoted = promoteExactMotionJobIfCurrent({
        presentationId: draftPresentation.id,
        queue: latestQueue,
        index: latestIndex,
        jobId: nextJob.snapshot.jobId,
        byteSize: encodedBlob.size,
        durationMs: nextRequest.bounds.endMs - nextRequest.bounds.startMs,
      });
      await writePresentationDerivedMediaJobQueue(projectDir, draftPresentation.id, promoted.queue);
      await writeExactMotionAssetIndex(projectDir, draftPresentation.id, promoted.index);
      await refreshPresentClosureState();
      console.info('[PresentationAuthoringEditor] Exact-motion asset ready', {
        sourceVideoId: nextRequest.sourceVideoId,
        generationKey: nextRequest.generationKey,
        outputPath: nextRequest.outputPath,
        byteSize: encodedBlob.size,
      });
      requestDerivedMediaAssetRefresh();
      return true;
    } catch (error: any) {
      const message = error?.message || String(error);
      let jobQueue = await readPresentationDerivedMediaJobQueue(projectDir, draftPresentation.id);
      const nextJob = jobQueue.jobs.find((job) => (
        job.request.kind === 'exact_motion_generate'
        && job.snapshot.kind === 'exact_motion_generate'
        && job.snapshot.presentationId === draftPresentation.id
        && !isTerminalDerivedMediaJobStatus(job.snapshot.status)
      ));
      if (!nextJob || nextJob.request.kind !== 'exact_motion_generate') {
        setToast(message);
        return false;
      }
      const nextRequest = nextJob.request;
      await deleteFileAtRelativePath(projectDir, buildExactMotionPendingOutputPath(nextRequest.outputPath));
      const latestIndex = await validateExactMotionAssetIndex(projectDir, draftPresentation.id);
      if (!isQueuedExactMotionJobCurrentForPromotion(jobQueue, nextJob.snapshot.jobId)) {
        const obsoletePromotion = promoteExactMotionJobIfCurrent({
          presentationId: draftPresentation.id,
          queue: jobQueue,
          index: latestIndex,
          jobId: nextJob.snapshot.jobId,
        });
        await writePresentationDerivedMediaJobQueue(projectDir, draftPresentation.id, obsoletePromotion.queue);
        await writeExactMotionAssetIndex(projectDir, draftPresentation.id, obsoletePromotion.index);
        await refreshPresentClosureState();
        return true;
      }
      jobQueue = {
        schema: jobQueue.schema,
        jobs: jobQueue.jobs.map((job) => job.snapshot.jobId !== nextJob.snapshot.jobId
          ? job
          : {
              ...job,
              snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
                status: 'failed',
                error: message,
                progress: {
                  ...job.snapshot.progress,
                  status: 'failed',
                  label: 'Failed',
                },
              }),
            }),
      };
      await writePresentationDerivedMediaJobQueue(projectDir, draftPresentation.id, jobQueue);
      await syncExactMotionIndexWithFailedJobs(projectDir, draftPresentation.id, jobQueue);
      await refreshPresentClosureState();
      console.error('[PresentationAuthoringEditor] Exact-motion job failed', {
        presentationId: draftPresentation.id,
        sourceVideoId: nextJob.request.sourceVideoId,
        generationKey: nextJob.snapshot.generationKey,
        outputPath: nextRequest.outputPath,
        bounds: nextRequest.bounds,
        error,
      });
      setToast(message);
      return true;
    } finally {
      exactMotionWorkerRunningRef.current = false;
    }
  }, [
    draftPresentation.id,
    ensureDerivedMediaVideoRef,
    projectDir,
    refreshPresentClosureState,
    requestDerivedMediaAssetRefresh,
    workingManifest.videos,
  ]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const didWork = await processNextPreviewProxyJob();
      if (!cancelled && didWork) {
        requestPreviewProxyWorkerPass();
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [processNextPreviewProxyJob, requestPreviewProxyWorkerPass, previewProxyWorkerPass]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const didWork = await processNextExactMotionJob();
      if (!cancelled && didWork) {
        requestExactMotionWorkerPass();
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [processNextExactMotionJob, requestExactMotionWorkerPass, exactMotionWorkerPass]);

  useEffect(() => {
    if (!isPresentMode || presentModePolicy !== 'fallback') {
      return;
    }
    if (state.mode === 'video' && presentStateSource === 'retrieval') {
      return;
    }
    let cancelled = false;
    const maybeUpgradePresentMode = async () => {
      const { evaluation } = await computePresentClosureState();
      if (cancelled || evaluation.status !== 'ready') {
        return;
      }
      setPresentModePolicy('exact');
      setToast('Exact presentation media is ready');
    };
    void maybeUpgradePresentMode().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    isPresentMode,
    presentModePolicy,
    state.mode,
    presentStateSource,
    computePresentClosureState,
    derivedMediaAssetRefreshPass,
    exactMotionWorkerPass,
  ]);

  const queuePresentationExactMotionRequests = useCallback(async (): Promise<{
    evaluation: PresentClosureEvaluation;
    statusRecord: PresentationPreparationStatusRecord;
    createdJobCount: number;
    reusedJobCount: number;
    invalidRequirementCount: number;
  }> => {
    const initial = await computePresentClosureState();
    let evaluation = initial.evaluation;
    let statusRecord = initial.statusRecord;
    let createdJobCount = 0;
    let reusedJobCount = 0;
    const queueable = [...evaluation.missingRequirements, ...evaluation.failedRequirements]
      .map((requirement) => ({
        requirement,
        request: buildPreparePresentationExactMotionRequest(draftPresentation.id, requirement),
      }))
      .filter((entry): entry is { requirement: PresentClosureEvaluation['requirements'][number]; request: NonNullable<ReturnType<typeof buildPreparePresentationExactMotionRequest>> } => !!entry.request);

    if (queueable.length > 0) {
      let jobQueue = await readPresentationDerivedMediaJobQueue(projectDir, draftPresentation.id);
      let exactMotionIndex = await validateExactMotionAssetIndex(projectDir, draftPresentation.id);
      const createdAt = new Date().toISOString();

      for (const { requirement, request } of queueable) {
        const enqueueResult = enqueueDerivedMediaGenerationRequest(jobQueue, request, 'prepare_presentation');
        jobQueue = enqueueResult.queue;
        if (enqueueResult.created) {
          createdJobCount += 1;
        } else {
          reusedJobCount += 1;
        }
        const existingEntry = getExactMotionAssetIndexEntryByGenerationKey(exactMotionIndex, request.generationKey);
        exactMotionIndex = upsertExactMotionAssetIndexEntry(exactMotionIndex, {
          assetId: requirement.assetId ?? existingEntry?.assetId ?? enqueueResult.job.snapshot.generationKey,
          generationKey: request.generationKey,
          motionKind: request.motionKind,
          transitionOrClipId: request.transitionOrClipId,
          sourceVideoId: request.sourceVideoId,
          sourceFingerprint: request.sourceFingerprint,
          relativePath: requirement.relativePath ?? existingEntry?.relativePath ?? request.outputPath.replace(`derived-media/presentations/${draftPresentation.id}/`, ''),
          status: 'queued',
          profileVersion: request.profileVersion,
          createdAt: existingEntry?.createdAt ?? createdAt,
          lastUsedAt: existingEntry?.lastUsedAt,
          byteSize: existingEntry?.byteSize,
          durationMs: existingEntry?.durationMs,
          error: undefined,
        });
      }

      await writePresentationDerivedMediaJobQueue(projectDir, draftPresentation.id, jobQueue);
      await writeExactMotionAssetIndex(projectDir, draftPresentation.id, exactMotionIndex);
      requestExactMotionWorkerPass();

      const refreshed = await computePresentClosureState();
      evaluation = refreshed.evaluation;
      statusRecord = refreshed.statusRecord;
    } else {
      evaluation = initial.evaluation;
      statusRecord = initial.statusRecord;
    }

    return {
      evaluation,
      statusRecord,
      createdJobCount,
      reusedJobCount,
      invalidRequirementCount: evaluation.invalidRequirements.length,
    };
  }, [computePresentClosureState, draftPresentation.id, projectDir, requestExactMotionWorkerPass]);

  const openPresentMode = useCallback(async (policy: 'exact' | 'fallback') => {
    if (isRetrievalVideoState) {
      stopVideoPlayback();
    }
    setIsPresentMode(true);
    setPresentModePolicy(policy);
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
  }, [isRetrievalVideoState, stopVideoPlayback]);

  const handlePresent = useCallback(async () => {
    setPresentBusy(true);
    try {
      const preparation = await queuePresentationExactMotionRequests();
      const nextPolicy = preparation.evaluation.status === 'ready' ? 'exact' : 'fallback';
      if (nextPolicy === 'fallback') {
        if (preparation.invalidRequirementCount > 0) {
          setToast(`Presenting with fallback playback; ${preparation.invalidRequirementCount} segment${preparation.invalidRequirementCount === 1 ? '' : 's'} cannot use exact playback yet`);
        } else if (preparation.createdJobCount > 0 || preparation.reusedJobCount > 0) {
          setToast('Presenting with fallback playback while exact media prepares in the background');
        } else {
          setToast('Presenting with fallback playback');
        }
      }
      await openPresentMode(nextPolicy);
    } catch (error: any) {
      setToast(error?.message || String(error));
    } finally {
      setPresentBusy(false);
    }
  }, [openPresentMode, queuePresentationExactMotionRequests]);

  const leavePresentMode = useCallback(async () => {
    setIsPresentMode(false);
    setPresentModePolicy(null);
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
        void handlePresent();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    deleteSelectedSlide,
    handlePresent,
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

  const playbackAssetBadge = useMemo(() => {
    if (state.mode !== 'video' && state.mode !== 'clip') {
      return null;
    }
    if (!resolvedPlaybackAsset) {
      return {
        className: 'border-danger text-danger',
        label: 'Playback unavailable',
      };
    }
    if (resolvedPlaybackAsset.assetClass === 'exact_motion') {
      return {
        className: 'border-info text-info',
        label: 'Exact preview',
      };
    }
    if (resolvedPlaybackAsset.assetClass === 'preview_proxy') {
      return {
        className: 'border-warning text-warning',
        label: 'Proxy preview',
      };
    }
    return {
      className: 'border-subtle text-muted',
      label: 'Original fallback',
    };
  }, [state.mode, resolvedPlaybackAsset]);

  useEffect(() => {
    recordMediaTrace('authoring_resolved_asset_changed', {
      stateMode: state.mode,
      stateSource: state.mode === 'video' ? state.source : null,
      selectedSlideIndex,
      assetId: resolvedPlaybackAsset?.assetId ?? null,
      assetClass: resolvedPlaybackAsset?.assetClass ?? null,
      generationKey: resolvedPlaybackAsset?.generationKey ?? null,
      filePath: resolvedPlaybackAsset?.filePath ?? null,
      badgeLabel: playbackAssetBadge?.label ?? null,
    });
  }, [playbackAssetBadge?.label, resolvedPlaybackAsset, selectedSlideIndex, state]);

  return (
    <div ref={rootRef} className="fullbleed">
      {isPresentMode ? (
        <div className="relative flex flex-col bg-canvas" style={{ height: '100vh' }}>
          <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 pointer-events-none">
            <div className="pointer-events-auto rounded border border-subtle bg-surface/90 px-3 py-2 backdrop-blur-sm">
              <div className="text-xs uppercase tracking-wide text-muted">Present mode</div>
              <div className="text-sm font-medium mt-1">{draftPresentation.name}</div>
              <div className="text-xs text-muted mt-1">{currentCanvasLabel}</div>
              <div className="text-xs text-muted mt-1">{presentModePolicy === 'exact' ? 'Exact playback active' : 'Fallback playback active'}</div>
            </div>
            <div className="pointer-events-auto flex items-stretch bg-surface/90 border border-subtle backdrop-blur-sm overflow-hidden">
              {state.mode === 'video' && state.source === 'retrieval' && (
                <button onClick={returnToSelectedSlide} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-sm">Return</button>
              )}
              <button
                onClick={() => setIsRetrievalBrowserOpen((prev) => !prev)}
                disabled={presentModePolicy === 'exact'}
                className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-sm disabled:opacity-50"
              >
                Marks
              </button>
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
              presentationId={draftPresentation.id}
              state={state}
              stillUrlById={stillUrlById}
              annotatedStillUrlById={annotatedStillUrlById}
              annotationsByStillId={annotationsByStillId}
              annotationDocumentsByStillId={annotationDocumentsByStillId}
              directRetrievalVideoUrl={directRetrievalVideoUrl}
              playbackAssetById={playbackAssetById}
              preferredPlaybackAssetIdByVideoId={preferredPlaybackAssetIdByVideoId}
              preferredPlaybackAssetIdsByPlaybackKey={preferredPlaybackAssetIdsByPlaybackKey}
              playbackAssetObjectUrlRegistry={playbackAssetObjectUrlRegistry}
              currentTransition={currentTransition}
              isPresenting
              allowPlaybackFallbackToOriginal={presentModePolicy !== 'exact'}
              onResolvedPlaybackAssetChange={setResolvedPlaybackAsset}
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
            <button onClick={() => void handlePresent()} disabled={presentBusy} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base disabled:opacity-50">{presentBusy ? 'Starting…' : 'Present'}</button>
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
                {playbackAssetBadge && (
                  <div className={`text-xs border px-2 py-1 bg-canvas ${playbackAssetBadge.className}`}>
                    {playbackAssetBadge.label}
                  </div>
                )}
                {captureBusyMarkId && <div className="text-sm text-muted">Creating still from mark…</div>}
              </div>

              <PresentationCanvas
                presentationId={draftPresentation.id}
                state={state}
                stillUrlById={stillUrlById}
                annotatedStillUrlById={annotatedStillUrlById}
                annotationsByStillId={annotationsByStillId}
                annotationDocumentsByStillId={annotationDocumentsByStillId}
                directRetrievalVideoUrl={directRetrievalVideoUrl}
                playbackAssetById={playbackAssetById}
                preferredPlaybackAssetIdByVideoId={preferredPlaybackAssetIdByVideoId}
                preferredPlaybackAssetIdsByPlaybackKey={preferredPlaybackAssetIdsByPlaybackKey}
                playbackAssetObjectUrlRegistry={playbackAssetObjectUrlRegistry}
                currentTransition={currentTransition}
                onResolvedPlaybackAssetChange={setResolvedPlaybackAsset}
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
