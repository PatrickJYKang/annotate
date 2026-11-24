"use client";

import type { ProjectDirectory } from "../../lib/host/contracts";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  hasPendingAnnotationAnimationClick,
  sampleAnnotationAnimations,
} from '../../lib/annotate/animation';
import { annotationPayloadFromDocument } from '../../lib/annotate/documentPayload';
import {
  frameTemporalAdapter,
  renderClipAnnotationsToCanvas,
} from '../../lib/clip/renderClipAnnotations';
import { frameToCenterSeconds, frameToMs, videoFrame } from '../../lib/clip/frameMath';
import { resolveUsableHomographyAtTime } from '../../lib/clip/homographyInterpolation';
import { paintAnnotationPayloadToCanvas } from '../../lib/export/d7Render';
import { findOverlappingCache, type HomographyFrame } from '../../lib/fs/homographyCache';
import { readPinAnnotationDocument } from '../../lib/fs/pinAnnotationStorage';
import { createFrameRasterQueue } from '../../lib/media/frameRaster';
import {
  effectivePausePins as resolveEffectivePausePins,
  validateMatchVideoEdge,
} from '../../lib/presentation/authoring';
import {
  advancePinPauseMachine,
  resumePinPauseMachine,
  seekPinPauseMachine,
  sourceFrameToMediaSeconds,
  startPinPauseMachine,
  toSourceFrame,
  visibleAnnotationIds,
  type PinPauseMachine,
  type PresentationPlaybackAsset,
} from '../../lib/presentation/playback';
import type { ClipPin, Clip } from '../../lib/types/clip';
import type { Annotations } from '../../lib/types/annotations';
import type { ClickTiming } from '../../lib/types/recording';
import type {
  ClipPauseCue,
  PresentationSlide,
  PresentationTransition,
  Presentation,
} from '../../lib/types/presentation';
import type { ProjectManifest, VideoEntry } from '../../lib/types/project';
import { useLocale, type Translate } from '../../lib/i18n';
import TimelineStrip from '../clip/TimelineStrip';
import PresentationTitleSlide from './PresentationTitleSlide';

export interface PresentationVideoResource {
  video: VideoEntry;
  file: File;
  url: string;
}

export type PresentationScene =
  | { kind: 'slide'; index: number }
  | { kind: 'transition'; index: number };

interface PresentationCanvasProps {
  projectDir: ProjectDirectory;
  manifest: ProjectManifest;
  presentation: Presentation;
  clips: readonly Clip[];
  scene: PresentationScene;
  videoResources: ReadonlyMap<string, PresentationVideoResource>;
  isPresenting: boolean;
  onComplete: () => void;
  studio?: boolean;
  recordingRange?: {
    first: number | null;
    last: number | null;
    setFirst: (frame: number) => void;
    setLast: (frame: number) => void;
    useFullClip: () => void;
  };
  onHold?: (pinId: string | null, timing: ClickTiming) => void;
}

export interface PresentationCanvasHandle {
  advance: () => boolean;
}

type ResolvedScene = {
  sceneKey: string;
  slide: PresentationSlide | null;
  clip: Clip | null;
  pin: ClipPin | null;
  transition: PresentationTransition | null;
  video: VideoEntry | null;
  range: { startFrame: number; endFrame: number } | null;
  hideAnimatedAnnotations: boolean;
  error: string | null;
};

function resolveScene(
  scene: PresentationScene,
  presentation: Presentation,
  clips: readonly Clip[],
  manifest: ProjectManifest,
  t: Translate,
): ResolvedScene {
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  if (scene.kind === 'transition') {
    const from = presentation.slides[scene.index];
    const to = presentation.slides[scene.index + 1];
    const transition = presentation.transitions[scene.index];
    if (!from || !to || !transition) {
      return { sceneKey: `missing-transition-${scene.index}`, slide: null, clip: null, pin: null, transition: null, video: null, range: null, hideAnimatedAnnotations: true, error: t('presentation.sceneMissingTransition') };
    }
    const valid = validateMatchVideoEdge(from, to, transition, clips, manifest);
    if (!valid.ok) {
      return { sceneKey: `invalid-transition-${scene.index}-${valid.code}`, slide: null, clip: null, pin: null, transition, video: null, range: null, hideAnimatedAnnotations: true, error: t(`presentation.validation.${valid.code}`) };
    }
    return {
      sceneKey: `transition-${scene.index}-${from.id}-${to.id}-${valid.video.id}-${valid.range.startFrame}-${valid.range.endFrame}`,
      slide: null,
      clip: null,
      pin: null,
      transition,
      video: valid.video,
      range: valid.range,
      hideAnimatedAnnotations: transition.mode === 'match_video' && transition.hideAnnotationsDuringPlayback,
      error: null,
    };
  }

  const slide = presentation.slides[scene.index] ?? null;
  if (!slide) {
    return { sceneKey: `missing-slide-${scene.index}`, slide: null, clip: null, pin: null, transition: null, video: null, range: null, hideAnimatedAnnotations: false, error: t('presentation.sceneMissingSlide') };
  }
  if (slide.kind === 'title') {
    return { sceneKey: `slide-${slide.id}`, slide, clip: null, pin: null, transition: null, video: null, range: null, hideAnimatedAnnotations: false, error: null };
  }
  const clip = clipsById.get(slide.clipId) ?? null;
  if (!clip) {
    return { sceneKey: `missing-clip-${slide.id}-${slide.clipId}`, slide, clip: null, pin: null, transition: null, video: null, range: null, hideAnimatedAnnotations: false, error: t('presentation.sceneMissingClip', { id: slide.clipId }) };
  }
  const video = manifest.videos.find((candidate) => candidate.id === clip.videoId) ?? null;
  if (!video) {
    return { sceneKey: `missing-video-${slide.id}-${clip.videoId}`, slide, clip, pin: null, transition: null, video: null, range: null, hideAnimatedAnnotations: false, error: t('presentation.sceneMissingVideo', { id: clip.videoId }) };
  }
  if (slide.kind === 'pin') {
    const pin = clip.pins.find((candidate) => candidate.id === slide.pinId) ?? null;
    return {
      sceneKey: pin
        ? `slide-${slide.id}-${clip.id}-${pin.id}-${pin.frame}-${video.id}`
        : `missing-pin-${slide.id}-${slide.pinId}`,
      slide,
      clip,
      pin,
      transition: null,
      video,
      range: pin ? { startFrame: pin.frame, endFrame: pin.frame + 1 } : null,
      hideAnimatedAnnotations: false,
      error: pin ? null : t('presentation.sceneMissingPin', { id: slide.pinId }),
    };
  }
  const range = slide.range ?? clip;
  return {
    sceneKey: `slide-${slide.id}-${clip.id}-${range.startFrame}-${range.endFrame}-${video.id}`,
    slide,
    clip,
    pin: null,
    transition: null,
    video,
    range: { startFrame: range.startFrame, endFrame: range.endFrame },
    hideAnimatedAnnotations: false,
    error: range.endFrame > video.frameCount ? t('presentation.validation.outsideVideo') : null,
  };
}

const PresentationCanvas = forwardRef<PresentationCanvasHandle, PresentationCanvasProps>(function PresentationCanvas({
  projectDir,
  manifest,
  presentation,
  clips,
  scene,
  videoResources,
  isPresenting,
  onComplete,
  studio = false,
  recordingRange,
  onHold,
}: PresentationCanvasProps, ref) {
  const { t, formatNumber } = useLocale();
  const resolved = useMemo(
    () => resolveScene(scene, presentation, clips, manifest, t),
    [clips, manifest, presentation, scene, t],
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const staticOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const pauseMachineRef = useRef<PinPauseMachine | null>(null);
  const completionKeyRef = useRef<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourceFrame, setSourceFrame] = useState(resolved.range?.startFrame ?? 0);
  const requestedSourceFrameRef = useRef(resolved.range?.startFrame ?? 0);
  const pendingSeekFrameRef = useRef<number | null>(null);
  const activeSceneKeyRef = useRef<string | null>(null);
  const playIntentRef = useRef(isPresenting);
  const [playing, setPlaying] = useState(false);
  const [pausedPin, setPausedPin] = useState<ClipPin | null>(null);
  const [staticFrameUrl, setStaticFrameUrl] = useState<string | null>(null);
  const [staticDocuments, setStaticDocuments] = useState<Map<string, Annotations>>(() => new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [staticElapsedMs, setStaticElapsedMs] = useState(0);
  const [staticAnimationClickTimesMs, setStaticAnimationClickTimesMs] = useState<number[]>([]);
  const [homographyFrames, setHomographyFrames] = useState<HomographyFrame[]>([]);
  const staticStartedAtRef = useRef(0);
  const staticAnimationClickTimesRef = useRef<number[]>([]);
  const holdReadyRef = useRef(false);
  const autoResumeRef = useRef(false);

  const requestPlayback = useCallback((video: HTMLVideoElement) => {
    const attempt = (retries: number) => {
      if (!playIntentRef.current || videoRef.current !== video) return;
      void video.play().then(() => setPlaying(true)).catch((error) => {
        if (
          error instanceof DOMException
          && error.name === 'AbortError'
          && retries > 0
          && playIntentRef.current
        ) {
          setPlaying(false);
          window.setTimeout(() => attempt(retries - 1), 75);
          return;
        }
        playIntentRef.current = false;
        setPlaying(false);
        setMessage(error instanceof Error ? error.message : String(error));
      });
    };
    attempt(3);
  }, []);

  const resource = resolved.video ? videoResources.get(resolved.video.id) ?? null : null;
  const playbackAsset = useMemo<PresentationPlaybackAsset | null>(() => {
    if (!resolved.video || !resolved.range || !resource) return null;
    return {
      id: `${resolved.sceneKey}-original-${resolved.video.id}-${resolved.range.startFrame}-${resolved.range.endFrame}`,
      kind: 'original',
      videoId: resolved.video.id,
      url: resource.url,
      sourceStartFrame: videoFrame(resolved.range.startFrame),
      sourceEndFrame: resolved.range.endFrame as PresentationPlaybackAsset['sourceEndFrame'],
    };
  }, [resolved.range, resolved.sceneKey, resolved.video, resource]);

  const choosingRange = !!recordingRange;
  const previewLast = recordingRange?.last ?? (playbackAsset?.sourceEndFrame ?? 1) - 1;
  const effectivePausePins = useMemo(() => (
    !choosingRange && resolved.slide?.kind === 'clip' && resolved.clip
      ? resolveEffectivePausePins(resolved.clip, resolved.slide)
      : []
  ), [choosingRange, resolved.clip, resolved.slide]);

  useEffect(() => {
    if (!resolved.clip || !resolved.video || resolved.slide?.kind !== 'clip') {
      setHomographyFrames([]);
      return;
    }
    let active = true;
    void findOverlappingCache(
      projectDir,
      resolved.video.id,
      Number(frameToMs(resolved.clip.startFrame, resolved.video.fps)),
      Number(frameToMs(videoFrame(resolved.clip.endFrame - 1), resolved.video.fps)),
    ).then((frames) => {
      if (active) setHomographyFrames(frames ?? []);
    });
    return () => { active = false; };
  }, [projectDir, resolved.clip, resolved.slide?.kind, resolved.video]);

  const paintAnimatedAnnotations = useCallback((frame: number) => {
    const canvas = overlayRef.current;
    const clip = resolved.clip;
    const video = resolved.video;
    if (!canvas || !clip || !video) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (resolved.hideAnimatedAnnotations || pausedPin || resolved.slide?.kind !== 'clip') return;
    renderClipAnnotationsToCanvas({
      canvas,
      annotations: clip.annotations,
      sample: frame,
      temporalAdapter: frameTemporalAdapter(clip.endFrame),
      homographyLookup: (sample) => resolveUsableHomographyAtTime(
        homographyFrames,
        Number(frameToMs(videoFrame(sample), video.fps)),
      ),
      size: { width: canvas.width, height: canvas.height, sourceWidth: video.width, sourceHeight: video.height },
    });
  }, [homographyFrames, pausedPin, resolved.clip, resolved.hideAnimatedAnnotations, resolved.slide?.kind, resolved.video]);

  useEffect(() => {
    paintAnimatedAnnotations(sourceFrame);
  }, [paintAnimatedAnnotations, sourceFrame]);

  const completeVideo = useCallback(() => {
    if (completionKeyRef.current === resolved.sceneKey) return;
    completionKeyRef.current = resolved.sceneKey;
    playIntentRef.current = false;
    setPlaying(false);
    videoRef.current?.pause();
    if (!isPresenting) return;
    const holdMs = resolved.slide?.kind === 'clip' ? resolved.slide.holdMs : undefined;
    if (holdMs && holdMs > 0) {
      holdTimerRef.current = setTimeout(onComplete, holdMs);
    } else {
      onComplete();
    }
  }, [isPresenting, onComplete, resolved.sceneKey, resolved.slide]);

  const pauseAtPin = useCallback((pin: ClipPin) => {
    autoResumeRef.current = playIntentRef.current;
    videoRef.current?.pause();
    playIntentRef.current = false;
    setPlaying(false);
    requestedSourceFrameRef.current = pin.frame;
    setSourceFrame(pin.frame);
    setPausedPin(pin);
    staticStartedAtRef.current = performance.now();
    staticAnimationClickTimesRef.current = [];
    setStaticAnimationClickTimesMs([]);
    setStaticElapsedMs(0);
  }, []);

  const sampleVideoFrame = useCallback((mediaTime: number, timestamp: 'clock' | 'presented') => {
    if (!playbackAsset || !resolved.video || videoRef.current?.seeking ||
        pendingSeekFrameRef.current !== null || pauseMachineRef.current?.pausedPinId) return;
    const frame = toSourceFrame(playbackAsset, mediaTime, resolved.video, timestamp);
    if (choosingRange && playIntentRef.current && frame >= previewLast) {
      const video = videoRef.current;
      playIntentRef.current = false;
      video?.pause();
      setPlaying(false);
      requestedSourceFrameRef.current = previewLast;
      pendingSeekFrameRef.current = previewLast;
      setSourceFrame(previewLast);
      if (video) video.currentTime = frameToCenterSeconds(videoFrame(previewLast), resolved.video.fps);
      return;
    }
    requestedSourceFrameRef.current = frame;
    setSourceFrame(frame);
    if (resolved.slide?.kind === 'clip' && pauseMachineRef.current) {
      const step = advancePinPauseMachine(pauseMachineRef.current, frame, effectivePausePins);
      pauseMachineRef.current = step.state;
      if (step.triggeredPinId) {
        const pin = effectivePausePins.find((candidate) => candidate.id === step.triggeredPinId);
        if (pin) {
          pauseAtPin(pin);
          return;
        }
      }
    }
    if (frame >= playbackAsset.sourceEndFrame - 1 && !pausedPin) {
      completeVideo();
    }
  }, [choosingRange, completeVideo, effectivePausePins, pauseAtPin, pausedPin, playbackAsset, previewLast, resolved.slide?.kind, resolved.video]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackAsset || !resolved.video || resolved.slide?.kind === 'pin' || resolved.slide?.kind === 'title') return;
    let cancelled = false;
    let frameRequest = 0;
    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (cancelled) return;
      sampleVideoFrame(metadata.mediaTime, 'presented');
      frameRequest = video.requestVideoFrameCallback(onFrame);
    };
    const onTimeUpdate = () => sampleVideoFrame(video.currentTime, 'clock');
    // A compositor may never present the exact requested frame. The media
    // element's seek completion, not an equality check on its next sample,
    // separates frames from before and after a seek.
    const onSeeked = () => {
      if (video.seeking) return;
      pendingSeekFrameRef.current = null;
      onTimeUpdate();
    };
    video.addEventListener('seeked', onSeeked);
    const frameVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (typeof frameVideo.requestVideoFrameCallback === 'function') {
      frameRequest = frameVideo.requestVideoFrameCallback(onFrame);
    } else {
      video.addEventListener('timeupdate', onTimeUpdate);
    }
    return () => {
      cancelled = true;
      if (frameRequest && typeof frameVideo.cancelVideoFrameCallback === 'function') {
        frameVideo.cancelVideoFrameCallback(frameRequest);
      }
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [playbackAsset, resolved.slide?.kind, resolved.video, sampleVideoFrame]);

  useEffect(() => {
    const sceneChanged = activeSceneKeyRef.current !== resolved.sceneKey;
    activeSceneKeyRef.current = resolved.sceneKey;
    if (sceneChanged) {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      completionKeyRef.current = null;
      setPausedPin(null);
      setMessage(resolved.error);
      const initialSourceFrame = resolved.range?.startFrame ?? 0;
      requestedSourceFrameRef.current = initialSourceFrame;
      pendingSeekFrameRef.current = initialSourceFrame;
      setSourceFrame(initialSourceFrame);
      staticStartedAtRef.current = performance.now();
      staticAnimationClickTimesRef.current = [];
      setStaticAnimationClickTimesMs([]);
      setStaticElapsedMs(0);
      playIntentRef.current = isPresenting;
    } else if (isPresenting) {
      playIntentRef.current = true;
    }
    const video = videoRef.current;
    if (!video || !playbackAsset || !resolved.video || resolved.slide?.kind === 'pin' || resolved.slide?.kind === 'title') {
      setPlaying(false);
      return;
    }
    const started = sceneChanged && resolved.slide?.kind === 'clip'
      ? startPinPauseMachine(playbackAsset.sourceStartFrame, effectivePausePins)
      : null;
    if (sceneChanged) pauseMachineRef.current = started?.state ?? null;
    if (started?.triggeredPinId) {
      const pin = effectivePausePins.find((candidate) => candidate.id === started.triggeredPinId);
      if (pin) {
        pauseAtPin(pin);
        return;
      }
    }
    const seekAndMaybePlay = () => {
      pendingSeekFrameRef.current = requestedSourceFrameRef.current;
      video.currentTime = sourceFrameToMediaSeconds(
        playbackAsset,
        videoFrame(requestedSourceFrameRef.current),
        resolved.video!,
      );
      video.playbackRate = resolved.transition?.mode === 'match_video' ? resolved.transition.playbackRate ?? 1 : 1;
      if (playIntentRef.current) {
        requestPlayback(video);
      } else {
        video.pause();
        setPlaying(false);
      }
    };
    if (video.readyState >= 1) seekAndMaybePlay();
    else video.addEventListener('loadedmetadata', seekAndMaybePlay, { once: true });
    return () => video.removeEventListener('loadedmetadata', seekAndMaybePlay);
  }, [effectivePausePins, isPresenting, pauseAtPin, playbackAsset, requestPlayback, resolved.error, resolved.range?.startFrame, resolved.sceneKey, resolved.slide?.kind, resolved.transition, resolved.video]);

  const activeStaticPin = resolved.slide?.kind === 'pin' ? resolved.pin : pausedPin;
  const activePauseCue: ClipPauseCue | undefined = pausedPin && resolved.slide?.kind === 'clip'
    ? resolved.slide.pauseCues?.find((cue) => cue.pinId === pausedPin.id)
    : undefined;
  const staticSelection = useMemo(() => resolved.slide?.kind === 'pin'
    ? resolved.slide.showAnnotations ? resolved.slide.annotationIds : []
    : activePauseCue?.annotationIds, [activePauseCue?.annotationIds, resolved.slide]);
  const staticCues = useMemo(() => resolved.slide?.kind === 'pin'
    ? resolved.slide.annotationCues
    : activePauseCue?.annotationCues, [activePauseCue?.annotationCues, resolved.slide]);
  const visibleStaticIds = useMemo(() => activeStaticPin
    ? visibleAnnotationIds(
        activeStaticPin.annotations.map((reference) => reference.id),
        staticSelection,
        staticCues,
        staticElapsedMs,
      )
    : [], [activeStaticPin, staticCues, staticElapsedMs, staticSelection]);
  const visibleStaticIdSet = useMemo(() => new Set(visibleStaticIds), [visibleStaticIds]);
  const staticCueById = useMemo(() => new Map(
    (staticCues ?? []).map((cue) => [cue.annotationId, cue]),
  ), [staticCues]);
  const activeStaticAnnotationKey = activeStaticPin?.annotations.map((reference) => reference.id).join('|') ?? '';
  const recordedClicks = resolved.slide?.kind === 'pin' ? resolved.slide.clickTimesMs : activePauseCue?.clickTimesMs;

  useEffect(() => {
    if (!activeStaticPin || !resolved.clip) {
      setStaticDocuments(new Map());
      return;
    }
    let active = true;
    void Promise.all(activeStaticPin.annotations.map(async (reference) => {
      const result = await readPinAnnotationDocument(projectDir, resolved.clip!.id, reference.id);
      if (!result.document && studio) throw new Error(result.error ?? t('presentation.missingSlide'));
      return result.document ? [reference.id, result.document] as const : null;
    })).then((entries) => {
      if (!active) return;
      setStaticDocuments(new Map(
        entries.filter((entry): entry is readonly [string, Annotations] => entry !== null),
      ));
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [activeStaticAnnotationKey, activeStaticPin, projectDir, resolved.clip, studio, t]);

  useEffect(() => {
    if (!activeStaticPin || !resolved.clip || !resolved.video || !resource) {
      setStaticFrameUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    const queue = createFrameRasterQueue(resource.file);
    void (async () => {
      try {
        const raster = await queue.rasterize({
          frame: activeStaticPin.frame,
          fps: resolved.video!.fps,
          outputWidth: resolved.video!.width,
        });
        if (!active) return;
        objectUrl = URL.createObjectURL(raster.blob);
        setStaticFrameUrl(objectUrl);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      active = false;
      queue.dispose();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeStaticPin, resolved.clip, resolved.sceneKey, resolved.video, resource]);

  const staticReady = !!activeStaticPin && !!staticFrameUrl &&
    (!studio || activeStaticPin.annotations.every(reference => staticDocuments.has(reference.id)));
  useEffect(() => {
    holdReadyRef.current = staticReady;
    if (!activeStaticPin?.id || !staticReady) {
      staticAnimationClickTimesRef.current = [];
      setStaticAnimationClickTimesMs([]);
      setStaticElapsedMs(0);
      return;
    }
    const startedAt = performance.now();
    staticStartedAtRef.current = startedAt;
    staticAnimationClickTimesRef.current = [];
    setStaticAnimationClickTimesMs([]);
    setStaticElapsedMs(0);
    let frameRequest = 0;
    const update = () => {
      setStaticElapsedMs(Math.max(0, performance.now() - startedAt));
      frameRequest = requestAnimationFrame(update);
    };
    frameRequest = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRequest);
  }, [activeStaticPin?.id, resolved.sceneKey, staticReady]);

  const relativeStaticClickTimes = useCallback((annotationId: string, clickTimes: readonly number[]) => {
    const enterAtMs = staticCueById.get(annotationId)?.enterAtMs ?? 0;
    return clickTimes
      .filter((clickTime) => clickTime >= enterAtMs)
      .map((clickTime) => clickTime - enterAtMs);
  }, [staticCueById]);

  const staticAnimationHasNextClick = Array.from(staticDocuments).some(([annotationId, document]) => (
    visibleStaticIdSet.has(annotationId)
    && hasPendingAnnotationAnimationClick(
      document.animations,
      relativeStaticClickTimes(annotationId, staticAnimationClickTimesMs),
    )
  ));

  const advanceStaticAnimation = useCallback(() => {
    if (!activeStaticPin) return false;
    if (!holdReadyRef.current) return true;
    if (recordedClicks) return false;
    const clickTimes = staticAnimationClickTimesRef.current;
    const hasPending = Array.from(staticDocuments).some(([annotationId, document]) => (
      visibleStaticIdSet.has(annotationId)
      && hasPendingAnnotationAnimationClick(
        document.animations,
        relativeStaticClickTimes(annotationId, clickTimes),
      )
    ));
    if (!hasPending) return false;
    const elapsedMs = Math.max(0, performance.now() - staticStartedAtRef.current);
    const nextClickTimes = [...clickTimes, elapsedMs];
    staticAnimationClickTimesRef.current = nextClickTimes;
    setStaticAnimationClickTimesMs(nextClickTimes);
    setStaticElapsedMs(elapsedMs);
    return true;
  }, [activeStaticPin, recordedClicks, relativeStaticClickTimes, staticDocuments, visibleStaticIdSet]);

  useEffect(() => {
    const canvas = staticOverlayRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!activeStaticPin) return;
    for (const [annotationId, document] of staticDocuments) {
      if (!visibleStaticIdSet.has(annotationId)) continue;
      const enterAtMs = staticCueById.get(annotationId)?.enterAtMs ?? 0;
      paintAnnotationPayloadToCanvas({
        context,
        payload: annotationPayloadFromDocument(document),
        visuals: sampleAnnotationAnimations(
          document.animations,
          Math.max(0, staticElapsedMs - enterAtMs),
          relativeStaticClickTimes(annotationId, recordedClicks ?? staticAnimationClickTimesMs),
        ),
      });
    }
  }, [activeStaticPin, recordedClicks, relativeStaticClickTimes, staticAnimationClickTimesMs, staticCueById, staticDocuments, staticElapsedMs, visibleStaticIdSet]);

  const captureHold = useCallback((pinId: string | null) => {
    if (!onHold) return;
    const clickTimesMs = recordedClicks ?? staticAnimationClickTimesRef.current;
    onHold(pinId, {
      holdMs: recordedClicks && activePauseCue?.holdMs !== undefined ? activePauseCue.holdMs
        : Math.max(clickTimesMs.at(-1) ?? 0, Math.round(performance.now() - staticStartedAtRef.current)),
      clickTimesMs: clickTimesMs.map(Math.round),
    });
  }, [activePauseCue?.holdMs, onHold, recordedClicks]);

  const resumeFromPin = useCallback(() => {
    if (!pausedPin || !pauseMachineRef.current) return;
    captureHold(pausedPin.id);
    const wasFinalFrame = playbackAsset && pausedPin.frame >= playbackAsset.sourceEndFrame - 1;
    pauseMachineRef.current = resumePinPauseMachine(pauseMachineRef.current);
    setPausedPin(null);
    if (wasFinalFrame) {
      completeVideo();
      return;
    }
    playIntentRef.current = true;
    if (videoRef.current && playbackAsset && resolved.video) {
      const video=videoRef.current;
      requestedSourceFrameRef.current=pausedPin.frame;
      pendingSeekFrameRef.current=pausedPin.frame;
      video.currentTime=sourceFrameToMediaSeconds(playbackAsset,pausedPin.frame,resolved.video);
      requestPlayback(video);
    }
  }, [captureHold, completeVideo, pausedPin, playbackAsset, requestPlayback, resolved.video]);

  useEffect(() => {
    if (!autoResumeRef.current || !staticReady || !pausedPin || activePauseCue?.holdMs === undefined || (!recordedClicks && staticAnimationHasNextClick)) return;
    const timer = window.setTimeout(resumeFromPin, activePauseCue.holdMs);
    return () => window.clearTimeout(timer);
  }, [activePauseCue?.holdMs, pausedPin, recordedClicks, resumeFromPin, staticAnimationHasNextClick, staticReady]);

  useEffect(() => {
    if (!isPresenting || scene.kind !== 'slide' || !resolved.slide) return;
    if (resolved.slide.kind === 'clip') return;
    if (resolved.slide.kind === 'pin' && !staticReady) return;
    if (resolved.slide.holdMs === undefined || (!recordedClicks && staticAnimationHasNextClick)) return;
    const timer = window.setTimeout(onComplete, resolved.slide.holdMs);
    return () => window.clearTimeout(timer);
  }, [isPresenting, onComplete, recordedClicks, resolved.slide, scene.kind, staticAnimationHasNextClick, staticReady]);

  const seekSourceFrame = useCallback((frame: number) => {
    if (!playbackAsset || !resolved.video) return;
    const target = videoFrame(Math.max(playbackAsset.sourceStartFrame, Math.min(playbackAsset.sourceEndFrame - 1, Math.round(frame))));
    requestedSourceFrameRef.current = target;
    pendingSeekFrameRef.current = target;
    setSourceFrame(target);
    if (pauseMachineRef.current) pauseMachineRef.current = seekPinPauseMachine(pauseMachineRef.current, target, effectivePausePins);
    setPausedPin(null);
    const video = videoRef.current;
    if (!video) return;
    if (choosingRange) {
      playIntentRef.current = false;
      video.pause();
      setPlaying(false);
      video.currentTime = frameToCenterSeconds(target, resolved.video.fps);
    } else video.currentTime = sourceFrameToMediaSeconds(playbackAsset, target, resolved.video);
  }, [choosingRange, effectivePausePins, playbackAsset, resolved.video]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || pausedPin) return;
    if (!playIntentRef.current) {
      if (recordingRange && playbackAsset) {
        const first = recordingRange.first ?? playbackAsset.sourceStartFrame;
        const frame = requestedSourceFrameRef.current;
        if (frame < first || frame >= previewLast) seekSourceFrame(first);
        if (first === previewLast) return;
      }
      playIntentRef.current = true;
      requestPlayback(video);
    } else {
      playIntentRef.current = false;
      video.pause();
      setPlaying(false);
    }
  }, [pausedPin, playbackAsset, previewLast, recordingRange, requestPlayback, seekSourceFrame]);

  const advancePresentationMedia = useCallback(() => {
    if (studio && pausedPin && recordedClicks) return true;
    if (advanceStaticAnimation()) return true;
    if (pausedPin) {
      resumeFromPin();
      return true;
    }
    if (studio) {
      if (resolved.slide?.kind === 'pin' || resolved.slide?.kind === 'title') {
        captureHold(null);
        onComplete();
      }
      return true;
    }
    return false;
  }, [advanceStaticAnimation, captureHold, onComplete, pausedPin, recordedClicks, resolved.slide?.kind, resumeFromPin, studio]);

  const toggleOrResumePlayback = useCallback(() => {
    if (advancePresentationMedia()) return;
    togglePlayback();
  }, [advancePresentationMedia, togglePlayback]);

  const handleCanvasAdvance = useCallback(() => {
    if (advancePresentationMedia()) return;
    if (resolved.slide?.kind === 'pin') {
      if (isPresenting) onComplete();
      return;
    }
    if (resolved.slide?.kind === 'clip') togglePlayback();
  }, [advancePresentationMedia, isPresenting, onComplete, resolved.slide?.kind, togglePlayback]);

  useImperativeHandle(ref, () => ({ advance: advancePresentationMedia }), [advancePresentationMedia]);

  useEffect(() => {
    if (!isPresenting || (resolved.slide?.kind !== 'clip' && resolved.slide?.kind !== 'pin' && !(studio && resolved.slide?.kind === 'title'))) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      event.preventDefault();
      handleCanvasAdvance();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCanvasAdvance, isPresenting, resolved.slide?.kind, studio]);

  if (resolved.error || !resolved.slide && scene.kind === 'slide') {
    return <div className="flex h-full items-center justify-center bg-black text-sm text-danger" data-testid="presentation-missing-reference">{resolved.error || t('presentation.missingSlide')}</div>;
  }
  if (resolved.slide?.kind === 'title') {
    return studio ? <div className="h-full" onClick={handleCanvasAdvance}><PresentationTitleSlide slide={resolved.slide} /></div> : <PresentationTitleSlide slide={resolved.slide} />;
  }

  const videoVisible = scene.kind === 'transition' || resolved.slide?.kind === 'clip';
  const aspect = resolved.video ? resolved.video.width / resolved.video.height : 16 / 9;
  const timelinePinId = resolved.clip?.pins.find((pin) => pin.frame === sourceFrame)?.id ?? null;
  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-black"
      data-testid="presentation-canvas"
      data-scene-key={resolved.sceneKey}
      data-source-frame={sourceFrame}
      data-playback-asset={playbackAsset?.kind ?? 'none'}
      data-static-animation-clicks={staticAnimationClickTimesMs.length}
      data-static-animation-pending-click={staticAnimationHasNextClick ? 'true' : 'false'}
    >
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ containerType: 'size' }}
        onClick={resolved.slide?.kind === 'clip' || resolved.slide?.kind === 'pin' ? handleCanvasAdvance : undefined}
      >
        <div className="relative flex-none" style={{ width: `min(100%, ${aspect * 100}cqh)`, aspectRatio: aspect }}>
          {videoVisible && playbackAsset && (
            <video
              crossOrigin="anonymous"
              ref={videoRef}
              key={playbackAsset.id}
              src={playbackAsset.url}
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-contain"
              onEnded={completeVideo}
            />
          )}
          {videoVisible && resolved.video && (
            <canvas
              ref={overlayRef}
              key={resolved.sceneKey}
              width={resolved.video.width}
              height={resolved.video.height}
              className="pointer-events-none absolute inset-0 h-full w-full"
              data-testid="presentation-animated-overlay"
            />
          )}
          {activeStaticPin && staticFrameUrl && (
            <div
              role="img"
              aria-label={t('presentation.annotatedPinFrame')}
              className="absolute inset-0 h-full w-full bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${JSON.stringify(staticFrameUrl)})` }}
              data-testid="presentation-pin-frame"
            />
          )}
          {activeStaticPin && resolved.video && (
            <canvas
              ref={staticOverlayRef}
              key={`static-overlay-${resolved.sceneKey}-${activeStaticPin.id}`}
              width={resolved.video.width}
              height={resolved.video.height}
              className="pointer-events-none absolute inset-0 h-full w-full"
              data-testid="presentation-pin-annotation-overlay"
            />
          )}
        </div>

        {isPresenting && pausedPin && !(studio && recordedClicks) && (
          <button
            className="absolute bottom-4 left-1/2 -translate-x-1/2 border-white/20 bg-black/80 text-white"
            onClick={(event) => {
              event.stopPropagation();
              if (!advanceStaticAnimation()) resumeFromPin();
            }}
          >
            {staticAnimationHasNextClick
              ? t('presentation.next')
              : t('presentation.resumeFrom', { label: pausedPin.label || `f${formatNumber(pausedPin.frame)}` })}
          </button>
        )}
      </div>

      {recordingRange && playbackAsset && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-2 py-1 text-xs">
          <button type="button" disabled={sourceFrame > previewLast} onClick={() => { seekSourceFrame(sourceFrame); recordingRange.setFirst(sourceFrame); }}>
            {t('record.setFirst')}
          </button>
          <span className="min-w-10 font-mono">{recordingRange.first ?? '—'}</span>
          <button type="button" disabled={sourceFrame < (recordingRange.first ?? playbackAsset.sourceStartFrame)} onClick={() => { seekSourceFrame(sourceFrame); recordingRange.setLast(sourceFrame); }}>
            {t('record.setLast')}
          </button>
          <span className="min-w-10 font-mono">{recordingRange.last ?? '—'}</span>
          <button type="button" className="ml-auto" onClick={() => { recordingRange.useFullClip(); seekSourceFrame(playbackAsset.sourceStartFrame); }}>
            {t('record.fullClip')}
          </button>
        </div>
      )}
      {!isPresenting && playbackAsset && resolved.slide?.kind === 'clip' && resolved.clip && resolved.video && (
        <div className="h-[104px] shrink-0 border-t border-border">
          <TimelineStrip
            key={resolved.sceneKey}
            clip={resolved.slide.range ? { ...resolved.clip, startFrame: playbackAsset.sourceStartFrame, endFrame: playbackAsset.sourceEndFrame } : resolved.clip}
            currentFrame={sourceFrame}
            selectedAnnotationIds={[]}
            selectedPinId={timelinePinId}
            selectedKeyframe={null}
            isPlaying={playing}
            onSkipBack={() => seekSourceFrame(sourceFrame - Math.round(resolved.video!.fps * 2))}
            onPrevious={() => seekSourceFrame(sourceFrame - 1)}
            onTogglePlayback={toggleOrResumePlayback}
            onNext={() => seekSourceFrame(sourceFrame + 1)}
            onSkipForward={() => seekSourceFrame(sourceFrame + Math.round(resolved.video!.fps * 2))}
            onSeek={seekSourceFrame}
            onSelectAnnotation={() => undefined}
            onSelectPin={(_pinId, frame) => seekSourceFrame(frame)}
            onSelectKeyframe={() => undefined}
            onMoveKeyframe={() => undefined}
            variant="pins"
            testIdPrefix={recordingRange ? 'recording-timeline' : 'presentation-timeline'}
            recordingEdges={recordingRange && {
              startFrame: recordingRange.first ?? playbackAsset.sourceStartFrame,
              endFrame: previewLast + 1,
              onStartFrameChange: frame => {
                const first = Math.max(playbackAsset.sourceStartFrame, Math.min(previewLast, frame));
                recordingRange.setFirst(first);
                seekSourceFrame(first);
              },
              onEndFrameChange: exclusive => {
                const last = Math.min(playbackAsset.sourceEndFrame - 1, Math.max(recordingRange.first ?? playbackAsset.sourceStartFrame, exclusive - 1));
                recordingRange.setLast(last);
                seekSourceFrame(last);
              },
            }}
          />
        </div>
      )}
      {message && <div className="absolute right-3 top-3 max-w-sm rounded bg-black/80 px-3 py-2 text-xs text-warning">{message}</div>}
    </div>
  );
});

export default PresentationCanvas;
