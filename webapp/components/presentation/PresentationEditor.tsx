"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectManifestV1 } from '../../lib/types/project';
import type { Presentation } from '../../lib/types/presentation';
import type { TaggingSchema } from '../../lib/tagging/schema';
import {
  mergeLoadedAnnotationDocuments,
  readAnnotationDocumentsForStill,
  type LoadedAnnotationDocument,
} from '../../lib/fs/annotationStorage';
import { ensureTaggingSelection } from '../../lib/tagging/schema';
import type { AnnotationsV1 } from '../../lib/export/d7Render';
import { renderAnnotatedPng } from '../../lib/export/d7Render';
import { usePresentationPlayerController } from '../../lib/presentation/playerController';
import PresentationCanvas from './PresentationCanvas';
import PresentationDeckStrip from './PresentationDeckStrip';
import PresentationInspector from './PresentationInspector';

export interface PresentationEditorProps {
  projectDir: FileSystemDirectoryHandle;
  manifest: ProjectManifestV1;
  presentation: Presentation;
  taggingSchema: TaggingSchema | null;
  onBack: () => void;
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
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

function revokeUrls(urls: Record<string, string>) {
  Object.values(urls).forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
}

export default function PresentationEditor({
  projectDir,
  manifest,
  presentation,
  taggingSchema,
  onBack,
}: PresentationEditorProps) {
  const [assetStatus, setAssetStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [assetError, setAssetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stillUrlById, setStillUrlById] = useState<Record<string, string>>({});
  const [annotatedStillUrlById, setAnnotatedStillUrlById] = useState<Record<string, string>>({});
  const [thumbnailUrlByStillId, setThumbnailUrlByStillId] = useState<Record<string, string>>({});
  const [annotationsByStillId, setAnnotationsByStillId] = useState<Record<string, AnnotationsV1 | null>>({});
  const [annotationDocumentsByStillId, setAnnotationDocumentsByStillId] = useState<Record<string, LoadedAnnotationDocument[]>>({});
  const [videoUrlById, setVideoUrlById] = useState<Record<string, string>>({});
  const stillUrlRegistryRef = useRef<Record<string, string>>({});
  const annotatedUrlRegistryRef = useRef<Record<string, string>>({});
  const thumbnailUrlRegistryRef = useRef<Record<string, string>>({});
  const videoUrlRegistryRef = useRef<Record<string, string>>({});

  const {
    selectedSlideIndex,
    state,
    currentTransition,
    showSlide,
    previewTransitionFrom,
    completeVideoPlayback,
    retrieveMark,
    goToPreviousSlide,
    goToNextSlide,
  } = usePresentationPlayerController(presentation, manifest);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const getFileForPath = useCallback(async (dir: FileSystemDirectoryHandle, path: string) => {
    const parts = path.split('/').filter(Boolean);
    let current: FileSystemDirectoryHandle = dir;
    for (let i = 0; i < parts.length - 1; i += 1) {
      current = await current.getDirectoryHandle(parts[i], { create: false });
    }
    const handle = await current.getFileHandle(parts[parts.length - 1], { create: false });
    return await handle.getFile();
  }, []);

  const slideStillIds = useMemo(() => {
    const ids = new Set<string>();
    for (const slide of presentation.slides) {
      if (slide.kind === 'still') ids.add(slide.stillId);
    }
    return Array.from(ids);
  }, [presentation]);

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
        const still = manifest.stills.find((entry) => entry.id === stillId);
        if (!still) continue;
        try {
          const stillFile = await getFileForPath(projectDir, still.file);
          const stillUrl = URL.createObjectURL(stillFile);
          nextStillUrls[still.id] = stillUrl;

          try {
            const thumbFile = await getFileForPath(projectDir, `thumbnails/${baseName(still.file)}`);
            nextThumbUrls[still.id] = URL.createObjectURL(thumbFile);
          } catch {}

          const annotationDocuments = await readAnnotationDocumentsForStill(projectDir, manifest, still);
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
  }, [slideStillIds, manifest, projectDir, getFileForPath]);

  useEffect(() => {
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
    const requestedVideoIds = Array.from(new Set([
      activeVideoId,
      warmedTransitionVideoId,
    ].filter((value): value is string => !!value)));
    if (requestedVideoIds.length === 0) return;
    const missingVideoIds = requestedVideoIds.filter((videoId) => !videoUrlRegistryRef.current[videoId]);
    const cachedVideoIds = requestedVideoIds.filter((videoId) => !!videoUrlRegistryRef.current[videoId]);
    if (cachedVideoIds.length > 0) {
      setVideoUrlById((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const videoId of cachedVideoIds) {
          const cachedUrl = videoUrlRegistryRef.current[videoId];
          if (cachedUrl && !next[videoId]) {
            next[videoId] = cachedUrl;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    if (missingVideoIds.length === 0) {
      return;
    }
    let cancelled = false;
    const loadVideos = async () => {
      const nextEntries: Record<string, string> = {};
      try {
        for (const videoId of missingVideoIds) {
          const video = manifest.videos.find((entry) => entry.id === videoId);
          if (!video) throw new Error(`Video not found: ${videoId}`);
          const file = await getFileForPath(projectDir, video.file);
          const url = URL.createObjectURL(file);
          if (cancelled) {
            URL.revokeObjectURL(url);
            continue;
          }
          nextEntries[videoId] = url;
        }
        if (cancelled) {
          Object.values(nextEntries).forEach((url) => {
            URL.revokeObjectURL(url);
          });
          return;
        }
        videoUrlRegistryRef.current = { ...videoUrlRegistryRef.current, ...nextEntries };
        setVideoUrlById((prev) => ({ ...prev, ...nextEntries }));
      } catch (error) {
        Object.values(nextEntries).forEach((url) => {
          URL.revokeObjectURL(url);
        });
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
  }, [state, currentTransition, manifest.videos, projectDir, getFileForPath]);

  useEffect(() => {
    return () => {
      revokeUrls(stillUrlRegistryRef.current);
      revokeUrls(annotatedUrlRegistryRef.current);
      revokeUrls(thumbnailUrlRegistryRef.current);
      revokeUrls(videoUrlRegistryRef.current);
    };
  }, []);

  const marksByVideo = useMemo(() => {
    return manifest.videos
      .map((video) => ({
        video,
        marks: manifest.marks.filter((mark) => mark.videoId === video.id).sort((a, b) => a.t_ms - b.t_ms),
      }))
      .filter((entry) => entry.marks.length > 0);
  }, [manifest]);

  const linkedStillCountByMarkId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const still of manifest.stills) {
      if (!still.sourceMarkId) continue;
      counts[still.sourceMarkId] = (counts[still.sourceMarkId] || 0) + 1;
    }
    return counts;
  }, [manifest.stills]);

  const handlePreviewTransition = useCallback(() => {
    if (selectedSlideIndex < 0) return;
    const result = previewTransitionFrom(selectedSlideIndex);
    if (!result.ok) {
      setToast(result.reason || 'Transition preview unavailable');
    }
  }, [previewTransitionFrom, selectedSlideIndex]);

  const selectedStillSourceMarkId = state.mode === 'still' ? state.still.sourceMarkId ?? null : null;

  return (
    <div className="fullbleed">
      <div className="flex flex-col" style={{ height: '100vh' }}>
        <div className="flex items-stretch bg-surface border-b border-border shrink-0">
          <button onClick={onBack} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base">← Presentations</button>
          <div className="self-stretch flex items-center px-4 text-base font-medium truncate">{presentation.name}</div>
          <span className="flex-1" />
          <button onClick={goToPreviousSlide} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Prev</button>
          <button onClick={goToNextSlide} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Next</button>
          <button onClick={handlePreviewTransition} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base">Play Transition</button>
          <div className="self-stretch flex items-center px-4 text-sm text-muted border-0 border-l border-solid border-border">
            {assetStatus === 'loading' ? 'Loading assets…' : assetStatus === 'error' ? 'Asset load error' : 'Assets ready'}
          </div>
        </div>

        {toast && <div className="shrink-0 px-3 py-1 text-xs text-warning border-b border-subtle">{toast}</div>}
        {assetError && <div className="shrink-0 px-3 py-1 text-xs text-danger border-b border-subtle">{assetError}</div>}

        <div className="flex-1 min-h-0 flex">
          <div className="w-[320px] shrink-0 border-r border-subtle bg-surface p-4 overflow-y-auto flex flex-col gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Asset browser</div>
              <div className="text-sm text-muted mt-2">
                Mark-first browser for Phase 3. Full tag-tree browsing lands in Phase 4.
              </div>
            </div>

            <div className="border border-subtle rounded p-3">
              <div className="text-xs uppercase tracking-wide text-muted">Project context</div>
              <div className="text-sm mt-2">{manifest.name}</div>
              <div className="text-sm text-muted mt-1">{manifest.videos.length} videos · {manifest.marks.length} marks · {manifest.stills.length} stills</div>
              <div className="text-sm text-muted mt-1">Tagging schema: {taggingSchema ? `v${taggingSchema.version}` : 'missing'}</div>
            </div>

            <div className="flex flex-col gap-3">
              {marksByVideo.map(({ video, marks }) => (
                <div key={video.id} className="border border-subtle rounded overflow-hidden">
                  <div className="px-3 py-2 border-b border-subtle bg-canvas text-sm font-medium truncate">{video.label}</div>
                  <div className="max-h-[240px] overflow-y-auto">
                    {marks.map((mark) => {
                      const selection = ensureTaggingSelection(mark.tags);
                      const isSelectedMark = selectedStillSourceMarkId === mark.id;
                      return (
                        <button
                          key={mark.id}
                          onClick={() => retrieveMark(mark)}
                          className={`w-full text-left px-3 py-2 border-0 border-b border-solid border-subtle ${isSelectedMark ? 'bg-selected' : 'bg-transparent hover:bg-hover'}`}
                        >
                          <div className="text-sm font-medium">{formatTimestamp(mark.t_ms)}</div>
                          <div className="text-xs text-muted mt-1">
                            {selection.primary || 'Untagged'} · {linkedStillCountByMarkId[mark.id] || 0} stills
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {marksByVideo.length === 0 && (
                <div className="text-sm text-muted">No marks yet. Create marks from the player before building a richer deck.</div>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col p-4 gap-4 bg-canvas">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">Current canvas</div>
                <div className="text-lg font-semibold mt-1">
                  {state.mode === 'still'
                    ? `Still slide ${selectedSlideIndex + 1}`
                    : state.mode === 'title'
                      ? `Title slide ${selectedSlideIndex + 1}`
                      : state.mode === 'video'
                        ? state.source === 'transition'
                          ? 'Transition preview'
                          : 'Retrieved mark preview'
                        : state.mode === 'missing'
                          ? 'Missing asset'
                          : 'Empty presentation'}
                </div>
              </div>
              {state.mode === 'still' && (
                <div className="text-sm text-muted">
                  {state.still.videoId} · {formatTimestamp(state.still.t_ms)} · {state.showAnnotations ? 'Annotations on' : 'Annotations off'}
                </div>
              )}
              {state.mode === 'video' && (
                <div className="text-sm text-muted">
                  {state.videoId} · {formatTimestamp(state.startMs)}
                  {typeof state.endMs === 'number' ? ` → ${formatTimestamp(state.endMs)}` : ''}
                </div>
              )}
            </div>

            <PresentationCanvas
              state={state}
              stillUrlById={stillUrlById}
              annotatedStillUrlById={annotatedStillUrlById}
              annotationsByStillId={annotationsByStillId}
              annotationDocumentsByStillId={annotationDocumentsByStillId}
              videoUrlById={videoUrlById}
              currentTransition={currentTransition}
              onVideoComplete={completeVideoPlayback}
            />
          </div>

          <PresentationInspector
            presentation={presentation}
            manifest={manifest}
            selectedSlideIndex={selectedSlideIndex}
            state={state}
            annotationsByStillId={annotationsByStillId}
            annotationDocumentsByStillId={annotationDocumentsByStillId}
            currentTransition={currentTransition}
            onPreviewTransition={handlePreviewTransition}
            canUseMatchVideo={!!currentTransition?.playable}
            transitionValidationMessage={currentTransition?.reason ?? null}
            onDeleteSelectedSlide={() => {}}
            onUpdateSelectedSlide={() => void 0}
            onUpdateSelectedTransition={() => void 0}
          />
        </div>

        <PresentationDeckStrip
          presentation={presentation}
          selectedSlideIndex={selectedSlideIndex}
          thumbnailUrlByStillId={thumbnailUrlByStillId}
          onSelectSlide={showSlide}
        />
      </div>
    </div>
  );
}
