"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import VideoPlayerUnit, { type VideoPlayerHandle } from '../player/VideoPlayerUnit';
import type { AnnotationsV1 } from '../../lib/export/d7Render';
import { renderAnnotatedPng } from '../../lib/export/d7Render';
import { mergeLoadedAnnotationDocuments, type LoadedAnnotationDocument } from '../../lib/fs/annotationStorage';
import type { PresentationPlayerState, PresentationTransitionPreview } from '../../lib/presentation/playerController';

export interface PresentationCanvasProps {
  state: PresentationPlayerState;
  stillUrlById: Record<string, string>;
  annotatedStillUrlById: Record<string, string>;
  annotationsByStillId: Record<string, AnnotationsV1 | null>;
  annotationDocumentsByStillId: Record<string, LoadedAnnotationDocument[]>;
  videoUrlById: Record<string, string>;
  currentTransition?: PresentationTransitionPreview | null;
  isPresenting?: boolean;
  onVideoComplete: () => void;
}

function filterAnnotations(annotations: AnnotationsV1, visibleIds: Set<string>): AnnotationsV1 {
  return {
    ...annotations,
    shapes: annotations.shapes.filter((shape) => visibleIds.has(shape.id)),
  };
}

export default function PresentationCanvas({
  state,
  stillUrlById,
  annotatedStillUrlById,
  annotationsByStillId,
  annotationDocumentsByStillId,
  videoUrlById,
  currentTransition = null,
  isPresenting = false,
  onVideoComplete,
}: PresentationCanvasProps) {
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const completionKeyRef = useRef<string | null>(null);
  const timedAnnotatedStillUrlRef = useRef<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [stillPlaybackElapsedMs, setStillPlaybackElapsedMs] = useState(0);
  const [timedAnnotatedStillUrl, setTimedAnnotatedStillUrl] = useState<string | null>(null);

  const baseStillUrl = useMemo(() => {
    if (state.mode !== 'still') return null;
    return stillUrlById[state.still.id] ?? null;
  }, [state, stillUrlById]);

  const activeStillAnnotations = useMemo(() => {
    if (state.mode !== 'still') return null;
    return annotationsByStillId[state.still.id] ?? null;
  }, [state, annotationsByStillId]);

  const activeStillAnnotationDocuments = useMemo(() => {
    if (state.mode !== 'still') return [] as LoadedAnnotationDocument[];
    return annotationDocumentsByStillId[state.still.id] ?? [];
  }, [state, annotationDocumentsByStillId]);

  const usesAnnotationSetSelection = useMemo(() => {
    return state.mode === 'still'
      && (state.slide.annotationSetIds !== undefined || (state.slide.annotationSetCues?.length ?? 0) > 0);
  }, [state]);

  const visibleAnnotationSetIds = useMemo(() => {
    if (state.mode !== 'still' || !state.showAnnotations || !usesAnnotationSetSelection) return null;
    const selectedIds = new Set(
      state.slide.annotationSetIds !== undefined
        ? state.slide.annotationSetIds
        : activeStillAnnotationDocuments.map((entry) => entry.entry.id),
    );
    const visibleEntries = activeStillAnnotationDocuments.filter((entry) => selectedIds.has(entry.entry.id));
    if (!isPresenting || (state.slide.annotationSetCues?.length ?? 0) === 0) {
      return visibleEntries.map((entry) => entry.entry.id);
    }
    const cueBySetId = new Map((state.slide.annotationSetCues ?? []).map((cue) => [cue.annotationSetId, cue] as const));
    return visibleEntries
      .filter((entry) => {
        const cue = cueBySetId.get(entry.entry.id);
        if (!cue) return true;
        if (cue.enterAtMs != null && stillPlaybackElapsedMs < cue.enterAtMs) return false;
        if (cue.exitAtMs != null && stillPlaybackElapsedMs >= cue.exitAtMs) return false;
        return true;
      })
      .map((entry) => entry.entry.id);
  }, [state, usesAnnotationSetSelection, activeStillAnnotationDocuments, isPresenting, stillPlaybackElapsedMs]);

  const timedAnnotationIds = useMemo(() => {
    if (state.mode !== 'still' || !state.showAnnotations || !activeStillAnnotations || usesAnnotationSetSelection) return null;
    const cues = state.slide.annotationCues ?? [];
    if (!isPresenting || cues.length === 0) return null;
    const cueById = new Map(cues.map((cue) => [cue.annotationId, cue] as const));
    return activeStillAnnotations.shapes
      .filter((shape) => {
        const cue = cueById.get(shape.id);
        if (!cue) return true;
        if (cue.enterAtMs != null && stillPlaybackElapsedMs < cue.enterAtMs) return false;
        if (cue.exitAtMs != null && stillPlaybackElapsedMs >= cue.exitAtMs) return false;
        return true;
      })
      .map((shape) => shape.id);
  }, [state, activeStillAnnotations, usesAnnotationSetSelection, isPresenting, stillPlaybackElapsedMs]);

  const dynamicStillAnnotations = useMemo(() => {
    if (state.mode !== 'still' || !state.showAnnotations) return null;
    if (usesAnnotationSetSelection) {
      if (!visibleAnnotationSetIds) return null;
      const visibleSetIdSet = new Set(visibleAnnotationSetIds);
      return mergeLoadedAnnotationDocuments(
        activeStillAnnotationDocuments.filter((entry) => visibleSetIdSet.has(entry.entry.id)),
      );
    }
    if (timedAnnotationIds) {
      return activeStillAnnotations ? filterAnnotations(activeStillAnnotations, new Set(timedAnnotationIds)) : null;
    }
    return null;
  }, [state, usesAnnotationSetSelection, visibleAnnotationSetIds, activeStillAnnotationDocuments, timedAnnotationIds, activeStillAnnotations]);

  const stillPlaybackKey = state.mode === 'still' ? state.slide.id : state.mode;
  const timedAnnotationKey = usesAnnotationSetSelection
    ? visibleAnnotationSetIds?.join('|') ?? null
    : timedAnnotationIds
      ? timedAnnotationIds.join('|')
      : null;

  const activeStillUrl = useMemo(() => {
    if (state.mode !== 'still') return null;
    if (!baseStillUrl) return null;
    if (!state.showAnnotations) {
      return baseStillUrl;
    }
    if (usesAnnotationSetSelection || timedAnnotationIds) {
      const dynamicShapeCount = dynamicStillAnnotations?.shapes?.length ?? 0;
      if (dynamicShapeCount === 0) {
        return baseStillUrl;
      }
      return timedAnnotatedStillUrl ?? baseStillUrl;
    }
    if (annotatedStillUrlById[state.still.id]) {
      return annotatedStillUrlById[state.still.id];
    }
    return baseStillUrl;
  }, [state, baseStillUrl, usesAnnotationSetSelection, timedAnnotationIds, timedAnnotatedStillUrl, dynamicStillAnnotations, annotatedStillUrlById]);

  const activeVideoState = useMemo(() => {
    if (state.mode === 'video') {
      return {
        key: state.source === 'retrieval'
          ? `retrieval:${state.videoId}`
          : `${state.videoId}:${state.startMs}:${state.endMs ?? 'none'}:${state.source}`,
        videoId: state.videoId,
        startMs: state.startMs,
        endMs: state.endMs,
        autoplay: state.autoplay,
        playbackRate: state.playbackRate,
        label: state.label || (state.source === 'transition' ? 'Transition preview' : state.source === 'retrieval' ? 'Retrieved mark' : 'Clip slide'),
        preload: state.source === 'retrieval' ? 'metadata' as const : 'auto' as const,
        showLoadingLabel: state.source !== 'clip',
        showPausedAtMarkLabel: state.source === 'retrieval',
      };
    }
    if (state.mode === 'clip') {
      return {
        key: `${state.clip.videoId}:${state.clip.startMs}:${state.clip.endMs}:${state.slide.id}`,
        videoId: state.clip.videoId,
        startMs: state.clip.startMs,
        endMs: state.clip.endMs,
        autoplay: isPresenting,
        playbackRate: 1,
        label: 'Clip slide',
        preload: 'auto' as const,
        showLoadingLabel: false,
        showPausedAtMarkLabel: false,
      };
    }
    return null;
  }, [state, isPresenting]);

  const warmedTransitionState = useMemo(() => {
    if (activeVideoState) return null;
    if (!currentTransition || currentTransition.transition.mode !== 'match_video') return null;
    if (!currentTransition.playable || !currentTransition.videoId || currentTransition.startMs == null || currentTransition.endMs == null) {
      return null;
    }
    return {
      key: `warm:${currentTransition.fromSlideIndex}:${currentTransition.videoId}:${currentTransition.startMs}:${currentTransition.endMs}`,
      videoId: currentTransition.videoId,
      startMs: currentTransition.startMs,
      endMs: currentTransition.endMs,
      autoplay: false,
      playbackRate: currentTransition.playbackRate,
      label: 'Transition preview',
      preload: 'auto' as const,
      showLoadingLabel: false,
      showPausedAtMarkLabel: false,
    };
  }, [activeVideoState, currentTransition]);

  const playerVideoState = activeVideoState ?? warmedTransitionState;

  const playerVideoUrl = useMemo(() => {
    if (!playerVideoState) return null;
    return videoUrlById[playerVideoState.videoId] ?? null;
  }, [playerVideoState, videoUrlById]);

  const showVideoPlayer = state.mode === 'video' || state.mode === 'clip';

  useEffect(() => {
    if (state.mode !== 'still' || !isPresenting) {
      setStillPlaybackElapsedMs(0);
      return;
    }
    const startedAt = performance.now();
    setStillPlaybackElapsedMs(0);
    const intervalId = window.setInterval(() => {
      setStillPlaybackElapsedMs(performance.now() - startedAt);
    }, 80);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [stillPlaybackKey, isPresenting, state.mode]);

  useEffect(() => {
    let cancelled = false;
    const revokeTimedUrl = () => {
      if (timedAnnotatedStillUrlRef.current) {
        try {
          URL.revokeObjectURL(timedAnnotatedStillUrlRef.current);
        } catch {}
        timedAnnotatedStillUrlRef.current = null;
      }
      setTimedAnnotatedStillUrl(null);
    };

    if (state.mode !== 'still' || !baseStillUrl || !state.showAnnotations || !dynamicStillAnnotations || !timedAnnotationKey) {
      revokeTimedUrl();
      return;
    }
    if ((dynamicStillAnnotations.shapes?.length ?? 0) === 0) {
      revokeTimedUrl();
      return;
    }

    const renderTimedStill = async () => {
      const response = await fetch(baseStillUrl);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      try {
        const annotatedBlob = await renderAnnotatedPng({
          bmp: bitmap,
          ann: dynamicStillAnnotations,
        });
        const url = URL.createObjectURL(annotatedBlob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (timedAnnotatedStillUrlRef.current) {
          try {
            URL.revokeObjectURL(timedAnnotatedStillUrlRef.current);
          } catch {}
        }
        timedAnnotatedStillUrlRef.current = url;
        setTimedAnnotatedStillUrl(url);
      } finally {
        bitmap.close();
      }
    };

    void renderTimedStill().catch(() => {
      if (!cancelled) {
        revokeTimedUrl();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [state, baseStillUrl, dynamicStillAnnotations, timedAnnotationKey]);

  useEffect(() => {
    return () => {
      if (timedAnnotatedStillUrlRef.current) {
        try {
          URL.revokeObjectURL(timedAnnotatedStillUrlRef.current);
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    setVideoReady(false);
    completionKeyRef.current = null;
  }, [state, playerVideoState?.key]);

  useEffect(() => {
    if (!playerVideoState || !playerVideoUrl) return;
    const element = playerRef.current?.getVideoElement() ?? null;
    if (!element) return;

    let cancelled = false;
    const syncPlayback = async () => {
      if (cancelled) return;
      try {
        const targetSeconds = playerVideoState.startMs / 1000;
        if (Number.isFinite(targetSeconds) && Math.abs(element.currentTime - targetSeconds) > 0.05) {
          element.currentTime = targetSeconds;
        }
      } catch {}
      try {
        element.playbackRate = playerVideoState.playbackRate ?? 1;
      } catch {}
      if (cancelled) return;
      if (playerVideoState.autoplay) {
        try {
          await element.play();
        } catch {}
      } else {
        element.pause();
      }
      if (!cancelled) setVideoReady(true);
    };

    if (element.readyState >= 1) {
      void syncPlayback();
    } else {
      const onLoadedMetadata = () => {
        void syncPlayback();
      };
      element.addEventListener('loadedmetadata', onLoadedMetadata);
      return () => {
        cancelled = true;
        element.removeEventListener('loadedmetadata', onLoadedMetadata);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [playerVideoState, playerVideoUrl]);

  const handleVideoTimeUpdate = () => {
    if (!activeVideoState || activeVideoState.endMs == null) return;
    const element = playerRef.current?.getVideoElement() ?? null;
    if (!element) return;
    if (element.currentTime * 1000 < activeVideoState.endMs) return;
    const key = `${activeVideoState.videoId}:${activeVideoState.startMs}:${activeVideoState.endMs}:${state.mode === 'video' ? state.transitionToSlideIndex ?? '' : state.selectedSlideIndex}`;
    if (completionKeyRef.current === key) return;
    completionKeyRef.current = key;
    element.pause();
    try {
      element.currentTime = activeVideoState.endMs / 1000;
    } catch {}
    if (state.mode === 'video') {
      onVideoComplete();
    }
  };

  if (state.mode === 'empty') {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-surface rounded border border-subtle">
        <div className="text-sm text-muted">No slides in this presentation yet.</div>
      </div>
    );
  }

  if (state.mode === 'missing') {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-surface rounded border border-subtle">
        <div className="text-sm text-danger">{state.message}</div>
      </div>
    );
  }

  let slideContent: React.ReactNode = null;

  if (state.mode === 'title') {
    const templateClassName = state.slide.template === 'divider'
      ? 'items-center justify-center'
      : state.slide.template === 'section'
        ? 'items-start justify-center'
        : 'items-center justify-center';
    slideContent = (
      <div className={`relative z-10 w-full h-full flex ${templateClassName} p-12`}>
        <div className="max-w-3xl w-full">
          <div className="text-xs uppercase tracking-[0.2em] text-muted mb-4">{state.slide.template}</div>
          <div className="text-5xl font-semibold leading-tight mb-4">{state.slide.title}</div>
          {state.slide.body && (
            <div className="text-xl text-muted leading-relaxed whitespace-pre-wrap">{state.slide.body}</div>
          )}
        </div>
      </div>
    );
  } else if (state.mode === 'still') {
    slideContent = activeStillUrl ? (
      <img src={activeStillUrl} alt="Presentation slide" className="relative z-10 max-w-full max-h-full object-contain" />
    ) : (
      <div className="relative z-10 text-sm text-muted">Still image unavailable</div>
    );
  }

  return (
    <div className="flex-1 min-h-0 rounded border border-subtle bg-surface overflow-hidden relative flex items-center justify-center">
      {slideContent}
      {playerVideoUrl && playerVideoState ? (
        <div className={`absolute inset-0 ${showVideoPlayer ? 'z-20' : 'z-0 opacity-0 pointer-events-none'}`}>
          <VideoPlayerUnit
            ref={playerRef}
            src={playerVideoUrl}
            preload={playerVideoState.preload}
            initialTime={playerVideoState.startMs / 1000}
            externalSeekMs={playerVideoState.startMs}
            allowFullscreen={!isPresenting}
            showAddMarkButton={false}
            enableMarkHotkey={false}
            className="w-full h-full"
            onTimeUpdate={handleVideoTimeUpdate}
            onLoadedMetadata={() => setVideoReady(true)}
            onLoadedData={() => setVideoReady(true)}
          />
        </div>
      ) : showVideoPlayer ? (
        <div className="text-sm text-muted">Video unavailable for this preview</div>
      ) : null}
      {!isPresenting && activeVideoState && (
        <div className="absolute left-3 top-3 px-2 py-1 rounded bg-black/60 text-xs text-white">
          {activeVideoState.label}
          {activeVideoState.showPausedAtMarkLabel && ' · paused at mark'}
          {activeVideoState.showLoadingLabel && !videoReady && ' · loading'}
        </div>
      )}
    </div>
  );
}
