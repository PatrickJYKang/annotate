"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import VideoPlayerUnit, { type VideoPlayerHandle } from '../player/VideoPlayerUnit';
import type { AnnotationsV1 } from '../../lib/export/d7Render';
import { renderAnnotatedPng } from '../../lib/export/d7Render';
import { mergeLoadedAnnotationDocuments, type LoadedAnnotationDocument } from '../../lib/fs/annotationStorage';
import type { PlaybackAssetRegistry, PreferredPlaybackAssetIdByVideoId, ResolvedPlaybackAsset } from '../../lib/presentation/derivedMediaTypes';
import {
  buildPlaybackAssetLeaseKey,
  detachVideoElementIfUsingUrl,
  type PlaybackAssetObjectUrlRegistry,
} from '../../lib/presentation/playbackAssetObjectUrls';
import { getBlobUrlId, recordMediaTrace } from '../../lib/presentation/mediaTrace';
import type { PresentationPlayerState, PresentationTransitionPreview } from '../../lib/presentation/playerController';
import {
  buildClipPlaybackPreferenceKey,
  buildOriginalPlaybackAssetId,
  buildTransitionPlaybackPreferenceKey,
  getPlaybackWorkflowForState,
  getTransitionWarmupWorkflow,
  resolveAuthoringClipPreviewPlaybackAsset,
  resolveAuthoringRetrievalPlaybackAsset,
  resolveAuthoringTransitionPreviewPlaybackAsset,
  resolvePresentClipPlaybackAsset,
  resolvePresentTransitionPlaybackAsset,
  resolvePlaybackAssetForVideoId,
} from '../../lib/presentation/playbackAssetResolver';

export interface PresentationCanvasProps {
  presentationId?: string | null;
  state: PresentationPlayerState;
  stillUrlById: Record<string, string>;
  annotatedStillUrlById: Record<string, string>;
  annotationsByStillId: Record<string, AnnotationsV1 | null>;
  annotationDocumentsByStillId: Record<string, LoadedAnnotationDocument[]>;
  directRetrievalVideoUrl?: string | null;
  playbackAssetById: PlaybackAssetRegistry;
  preferredPlaybackAssetIdByVideoId: PreferredPlaybackAssetIdByVideoId;
  preferredPlaybackAssetIdsByPlaybackKey?: Record<string, string[]>;
  playbackAssetObjectUrlRegistry?: PlaybackAssetObjectUrlRegistry | null;
  currentTransition?: PresentationTransitionPreview | null;
  isPresenting?: boolean;
  allowPlaybackFallbackToOriginal?: boolean;
  onResolvedPlaybackAssetChange?: (asset: ResolvedPlaybackAsset | null) => void;
  onVideoComplete: () => void;
}

function filterAnnotations(annotations: AnnotationsV1, visibleIds: Set<string>): AnnotationsV1 {
  return {
    ...annotations,
    shapes: annotations.shapes.filter((shape) => visibleIds.has(shape.id)),
  };
}

export default function PresentationCanvas({
  presentationId = null,
  state,
  stillUrlById,
  annotatedStillUrlById,
  annotationsByStillId,
  annotationDocumentsByStillId,
  directRetrievalVideoUrl = null,
  playbackAssetById,
  preferredPlaybackAssetIdByVideoId,
  preferredPlaybackAssetIdsByPlaybackKey = {},
  playbackAssetObjectUrlRegistry = null,
  currentTransition = null,
  isPresenting = false,
  allowPlaybackFallbackToOriginal = true,
  onResolvedPlaybackAssetChange,
  onVideoComplete,
}: PresentationCanvasProps) {
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const completionKeyRef = useRef<string | null>(null);
  const timedAnnotatedStillUrlRef = useRef<string | null>(null);
  const playerVideoUrlRef = useRef<string | null>(null);
  const playerVideoErrorCountRef = useRef<Record<string, number>>({});
  const [videoReady, setVideoReady] = useState(false);
  const [playerVideoUrl, setPlayerVideoUrl] = useState<string | null>(null);
  const [playerVideoReloadNonce, setPlayerVideoReloadNonce] = useState(0);
  const [blockedPlaybackAssetIds, setBlockedPlaybackAssetIds] = useState<string[]>([]);
  const [stillPlaybackElapsedMs, setStillPlaybackElapsedMs] = useState(0);
  const [timedAnnotatedStillUrl, setTimedAnnotatedStillUrl] = useState<string | null>(null);
  const effectivePlayerVideoUrl = directRetrievalVideoUrl ?? playerVideoUrl;

  useEffect(() => {
    playerVideoUrlRef.current = effectivePlayerVideoUrl;
  }, [effectivePlayerVideoUrl]);

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
        label: state.source === 'transition' && isPresenting
          ? 'Transition'
          : state.label || (state.source === 'transition' ? 'Transition preview' : state.source === 'retrieval' ? 'Retrieved mark' : 'Clip slide'),
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

  const playerPlaybackPreferenceKey = useMemo(() => {
    if (!presentationId) {
      return playerVideoState?.key ?? null;
    }
    if (activeVideoState) {
      if (state.mode === 'video' && state.source === 'transition') {
        return buildTransitionPlaybackPreferenceKey({
          presentationId,
          slotKey: state.source,
          videoId: state.videoId,
          startMs: state.startMs,
          endMs: state.endMs ?? null,
        });
      }
      if (state.mode === 'clip') {
        return buildClipPlaybackPreferenceKey({
          presentationId,
          slideId: state.slide.id,
          videoId: state.clip.videoId,
          startMs: state.clip.startMs,
          endMs: state.clip.endMs,
        });
      }
      return activeVideoState.key;
    }
    if (
      warmedTransitionState
      && currentTransition?.transition.mode === 'match_video'
      && currentTransition.videoId
      && currentTransition.startMs != null
      && currentTransition.endMs != null
    ) {
      return buildTransitionPlaybackPreferenceKey({
        presentationId,
        slotKey: `warm:${currentTransition.fromSlideIndex}`,
        videoId: currentTransition.videoId,
        startMs: currentTransition.startMs,
        endMs: currentTransition.endMs,
      });
    }
    return warmedTransitionState?.key ?? null;
  }, [presentationId, playerVideoState, activeVideoState, warmedTransitionState, state, currentTransition]);

  const playerVideoWorkflow = useMemo(() => {
    if (activeVideoState) {
      return getPlaybackWorkflowForState(state, isPresenting);
    }
    if (warmedTransitionState) {
      return getTransitionWarmupWorkflow(isPresenting);
    }
    return null;
  }, [activeVideoState, warmedTransitionState, state, isPresenting]);

  const blockedPlaybackAssetIdSet = useMemo(() => {
    return new Set(blockedPlaybackAssetIds);
  }, [blockedPlaybackAssetIds]);

  const playerPlaybackAsset = useMemo(() => {
    if (!playerVideoState || !playerVideoWorkflow) return null;
    const preferredAssetIds = (playerPlaybackPreferenceKey
      ? preferredPlaybackAssetIdsByPlaybackKey[playerPlaybackPreferenceKey] ?? []
      : [])
      .filter((assetId) => !blockedPlaybackAssetIdSet.has(assetId));
    const effectivePreferredPlaybackAssetIdByVideoId = (() => {
      const preferredAssetId = preferredPlaybackAssetIdByVideoId[playerVideoState.videoId];
      if (!preferredAssetId || !blockedPlaybackAssetIdSet.has(preferredAssetId)) {
        return preferredPlaybackAssetIdByVideoId;
      }
      return {
        ...preferredPlaybackAssetIdByVideoId,
        [playerVideoState.videoId]: buildOriginalPlaybackAssetId(playerVideoState.videoId),
      };
    })();
    const resolveArgs = {
      videoId: playerVideoState.videoId,
      playbackAssetById,
      preferredPlaybackAssetIdByVideoId: effectivePreferredPlaybackAssetIdByVideoId,
      preferredAssetIds,
      allowFallbackToOriginal: allowPlaybackFallbackToOriginal,
    };
    if (playerVideoWorkflow === 'authoring_retrieval') {
      return resolveAuthoringRetrievalPlaybackAsset(resolveArgs);
    }
    if (playerVideoWorkflow === 'authoring_clip_preview') {
      return resolveAuthoringClipPreviewPlaybackAsset(resolveArgs);
    }
    if (playerVideoWorkflow === 'authoring_transition_preview') {
      return resolveAuthoringTransitionPreviewPlaybackAsset(resolveArgs);
    }
    if (playerVideoWorkflow === 'present_transition') {
      return resolvePresentTransitionPlaybackAsset(resolveArgs);
    }
    if (playerVideoWorkflow === 'present_clip') {
      return resolvePresentClipPlaybackAsset(resolveArgs);
    }
    return resolvePlaybackAssetForVideoId({
      ...resolveArgs,
      workflow: playerVideoWorkflow,
    });
  }, [
    playerVideoState,
    playerVideoWorkflow,
    playbackAssetById,
    preferredPlaybackAssetIdByVideoId,
    preferredPlaybackAssetIdsByPlaybackKey,
    playerPlaybackPreferenceKey,
    blockedPlaybackAssetIdSet,
    allowPlaybackFallbackToOriginal,
  ]);

  const playerPlaybackAssetLeaseKey = useMemo(() => {
    return buildPlaybackAssetLeaseKey(playerPlaybackAsset);
  }, [playerPlaybackAsset]);

  const playerVideoErrorKey = useMemo(() => {
    return `${playerVideoState?.key ?? 'none'}|${playerPlaybackAssetLeaseKey ?? 'none'}`;
  }, [playerVideoState?.key, playerPlaybackAssetLeaseKey]);

  const showVideoPlayer = state.mode === 'video' || state.mode === 'clip';

  useEffect(() => {
    onResolvedPlaybackAssetChange?.(playerPlaybackAsset);
    recordMediaTrace('canvas_resolved_playback_asset_changed', {
      stateKey: playerVideoState?.key ?? null,
      workflow: playerVideoWorkflow,
      assetId: playerPlaybackAsset?.assetId ?? null,
      assetClass: playerPlaybackAsset?.assetClass ?? null,
      generationKey: playerPlaybackAsset?.generationKey ?? null,
      filePath: playerPlaybackAsset?.filePath ?? null,
      leaseKey: playerPlaybackAssetLeaseKey,
    });
  }, [playerPlaybackAsset, onResolvedPlaybackAssetChange]);

  useEffect(() => {
    let cancelled = false;
    let effectResolvedUrl: string | null = null;
    setPlayerVideoUrl(null);
    setVideoReady(false);
    if (directRetrievalVideoUrl) {
      return;
    }
    if (!playerPlaybackAsset) {
      return;
    }
    recordMediaTrace('canvas_bind_start', {
      stateKey: playerVideoState?.key ?? null,
      workflow: playerVideoWorkflow,
      assetId: playerPlaybackAsset.assetId,
      assetClass: playerPlaybackAsset.assetClass,
      generationKey: playerPlaybackAsset.generationKey ?? null,
      filePath: playerPlaybackAsset.filePath ?? null,
      leaseKey: playerPlaybackAssetLeaseKey,
    });
    const releaseLease = playbackAssetObjectUrlRegistry?.acquireLease(playerPlaybackAsset) ?? (() => {});
    const playerElement = playerRef.current?.getVideoElement() ?? null;
    const loadPlayerVideoUrl = async () => {
      try {
        const nextUrl = playbackAssetObjectUrlRegistry
          ? await playbackAssetObjectUrlRegistry.ensureObjectUrl(playerPlaybackAsset)
          : playerPlaybackAsset.objectUrl ?? null;
        if (!cancelled) {
          effectResolvedUrl = nextUrl;
          recordMediaTrace('canvas_bind_resolved_url', {
            stateKey: playerVideoState?.key ?? null,
            workflow: playerVideoWorkflow,
            assetId: playerPlaybackAsset.assetId,
            assetClass: playerPlaybackAsset.assetClass,
            generationKey: playerPlaybackAsset.generationKey ?? null,
            filePath: playerPlaybackAsset.filePath ?? null,
            blobUrl: nextUrl,
            leaseKey: playerPlaybackAssetLeaseKey,
          });
          setPlayerVideoUrl(nextUrl);
        }
      } catch (error) {
        recordMediaTrace('canvas_bind_failed', {
          stateKey: playerVideoState?.key ?? null,
          workflow: playerVideoWorkflow,
          assetId: playerPlaybackAsset.assetId,
          assetClass: playerPlaybackAsset.assetClass,
          generationKey: playerPlaybackAsset.generationKey ?? null,
          filePath: playerPlaybackAsset.filePath ?? null,
          leaseKey: playerPlaybackAssetLeaseKey,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        }, 'error');
        console.error('[PresentationCanvas] Failed to resolve playback URL', {
          assetId: playerPlaybackAsset.assetId,
          assetClass: playerPlaybackAsset.assetClass,
          filePath: playerPlaybackAsset.filePath ?? null,
          generationKey: playerPlaybackAsset.generationKey ?? null,
          workflow: playerVideoWorkflow,
          error,
        });
        if (!cancelled) {
          setPlayerVideoUrl(null);
        }
      }
    };
    void loadPlayerVideoUrl();
    return () => {
      cancelled = true;
      const didDetach = detachVideoElementIfUsingUrl(playerElement, effectResolvedUrl);
      recordMediaTrace('canvas_bind_cleanup', {
        stateKey: playerVideoState?.key ?? null,
        workflow: playerVideoWorkflow,
        assetId: playerPlaybackAsset.assetId,
        assetClass: playerPlaybackAsset.assetClass,
        generationKey: playerPlaybackAsset.generationKey ?? null,
        filePath: playerPlaybackAsset.filePath ?? null,
        blobUrl: effectResolvedUrl,
        leaseKey: playerPlaybackAssetLeaseKey,
        didDetachVideoElement: didDetach,
      }, didDetach ? 'warn' : 'info');
      releaseLease();
    };
  }, [directRetrievalVideoUrl, playerPlaybackAssetLeaseKey, playbackAssetObjectUrlRegistry, playerVideoReloadNonce, playerVideoWorkflow, playerVideoState?.key]);
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
    setPlayerVideoReloadNonce(0);
    setBlockedPlaybackAssetIds([]);
    playerVideoErrorCountRef.current = {};
  }, [state, playerVideoState?.key]);

  useEffect(() => {
    if (!playerVideoState || !effectivePlayerVideoUrl) return;
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
        } catch (error) {
          const isAbortDuringTeardown = error instanceof DOMException && error.name === 'AbortError';
          if (cancelled || isAbortDuringTeardown) {
            return;
          }
          console.warn('[PresentationCanvas] Video autoplay was rejected', {
            key: playerVideoState.key,
            assetId: playerPlaybackAsset?.assetId ?? null,
            workflow: playerVideoWorkflow,
            error,
          });
        }
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
  }, [playerVideoState, effectivePlayerVideoUrl, playerVideoWorkflow]);

  useEffect(() => {
    if (!playerVideoState || !effectivePlayerVideoUrl) {
      return;
    }
    const element = playerRef.current?.getVideoElement() ?? null;
    if (!element) {
      return;
    }
    const logVideoEvent = (eventName: string, level: 'info' | 'warn' | 'error' = 'info') => {
      recordMediaTrace(`video_${eventName}`, {
        stateKey: playerVideoState.key,
        workflow: playerVideoWorkflow,
        assetId: playerPlaybackAsset?.assetId ?? null,
        assetClass: playerPlaybackAsset?.assetClass ?? null,
        generationKey: playerPlaybackAsset?.generationKey ?? null,
        currentSrc: element.currentSrc ?? null,
        currentSrcBlobUrlId: getBlobUrlId(element.currentSrc),
        boundBlobUrlId: getBlobUrlId(effectivePlayerVideoUrl),
        readyState: element.readyState,
        networkState: element.networkState,
        paused: element.paused,
        currentTime: element.currentTime,
      }, level);
    };
    const eventMap: Array<[keyof HTMLMediaElementEventMap, 'info' | 'warn' | 'error']> = [
      ['loadstart', 'info'],
      ['loadedmetadata', 'info'],
      ['loadeddata', 'info'],
      ['canplay', 'info'],
      ['play', 'info'],
      ['playing', 'info'],
      ['pause', 'info'],
      ['abort', 'warn'],
      ['emptied', 'warn'],
      ['error', 'error'],
    ];
    const listeners = eventMap.map(([eventName, level]) => {
      const handler = () => logVideoEvent(eventName, level);
      element.addEventListener(eventName, handler);
      return [eventName, handler] as const;
    });
    return () => {
      listeners.forEach(([eventName, handler]) => {
        element.removeEventListener(eventName, handler);
      });
    };
  }, [playerVideoState, effectivePlayerVideoUrl, playerPlaybackAsset, playerVideoWorkflow]);

  const handlePlayerVideoError = useCallback((event: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const mediaError = event.currentTarget.error;
    const mediaErrorSummary = mediaError
      ? {
          code: mediaError.code,
          message: 'message' in mediaError ? (mediaError as MediaError & { message?: string }).message ?? null : null,
        }
      : null;
    console.error('[PresentationCanvas] Video element reported a playback error', {
      key: playerVideoState?.key ?? null,
      workflow: playerVideoWorkflow,
      assetId: playerPlaybackAsset?.assetId ?? null,
      assetClass: playerPlaybackAsset?.assetClass ?? null,
      assetFilePath: playerPlaybackAsset?.filePath ?? null,
      assetGenerationKey: playerPlaybackAsset?.generationKey ?? null,
      currentUrl: playerVideoUrlRef.current,
      mediaError: mediaErrorSummary,
    });
    setVideoReady(false);
    if (!playerPlaybackAsset) {
      return;
    }
    const nextErrorCount = (playerVideoErrorCountRef.current[playerVideoErrorKey] ?? 0) + 1;
    playerVideoErrorCountRef.current[playerVideoErrorKey] = nextErrorCount;

    if (nextErrorCount === 1 && playbackAssetObjectUrlRegistry) {
      recordMediaTrace('canvas_invalidate_after_error', {
        key: playerVideoState?.key ?? null,
        workflow: playerVideoWorkflow,
        assetId: playerPlaybackAsset.assetId,
        assetClass: playerPlaybackAsset.assetClass,
        generationKey: playerPlaybackAsset.generationKey ?? null,
        blobUrl: playerVideoUrlRef.current,
        mediaError: mediaErrorSummary,
        errorCount: nextErrorCount,
      }, 'warn');
      const invalidated = playbackAssetObjectUrlRegistry.invalidateObjectUrl(
        playerPlaybackAsset,
        playerVideoUrlRef.current,
      );
      if (invalidated) {
        console.warn('[PresentationCanvas] Retrying playback with a fresh blob URL', {
          key: playerVideoState?.key ?? null,
          assetId: playerPlaybackAsset.assetId,
          assetClass: playerPlaybackAsset.assetClass,
        });
        setPlayerVideoUrl(null);
        setPlayerVideoReloadNonce((value) => value + 1);
        return;
      }
    }

    const canFallbackToAuthoringOriginal = !isPresenting
      && playerVideoWorkflow != null
      && playerVideoWorkflow.startsWith('authoring')
      && playerPlaybackAsset.assetClass !== 'original';
    if (canFallbackToAuthoringOriginal) {
      console.warn('[PresentationCanvas] Falling back from a failed derived asset to original playback', {
        key: playerVideoState?.key ?? null,
        failedAssetId: playerPlaybackAsset.assetId,
        failedAssetClass: playerPlaybackAsset.assetClass,
        fallbackAssetId: playerPlaybackAsset.sourceVideoId
          ? buildOriginalPlaybackAssetId(playerPlaybackAsset.sourceVideoId)
          : null,
      });
      setBlockedPlaybackAssetIds((current) => (
        current.includes(playerPlaybackAsset.assetId)
          ? current
          : [...current, playerPlaybackAsset.assetId]
      ));
    }
  }, [isPresenting, playbackAssetObjectUrlRegistry, playerPlaybackAsset, playerVideoErrorKey, playerVideoState?.key, playerVideoWorkflow]);

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
      {effectivePlayerVideoUrl && playerVideoState ? (
        <div className={`absolute inset-0 ${showVideoPlayer ? 'z-20' : 'z-0 opacity-0 pointer-events-none'}`}>
          <VideoPlayerUnit
            ref={playerRef}
            src={effectivePlayerVideoUrl}
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
            onError={handlePlayerVideoError}
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
