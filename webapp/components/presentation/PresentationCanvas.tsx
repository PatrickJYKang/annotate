"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationPayload } from '../../lib/annotate/documentPayload';
import { annotationPayloadFromDocument } from '../../lib/annotate/documentPayload';
import {
  frameTemporalAdapter,
  renderClipAnnotationsToCanvas,
} from '../../lib/clip/renderClipAnnotations';
import { frameToMs, videoFrame } from '../../lib/clip/frameMath';
import { resolveUsableHomographyAtTime } from '../../lib/clip/homographyInterpolation';
import { renderAnnotatedPng } from '../../lib/export/d7Render';
import type { PreparedPresentationAsset } from '../../lib/fs/presentationMedia';
import { preparedPresentationAssetKey } from '../../lib/fs/presentationMedia';
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
import type {
  ClipPauseCue,
  PresentationSlide,
  PresentationTransition,
  Presentation,
} from '../../lib/types/presentation';
import type { ProjectManifest, VideoEntry } from '../../lib/types/project';
import { useLocale, type Translate } from '../../lib/i18n';

export interface PresentationVideoResource {
  video: VideoEntry;
  file: File;
  url: string;
}

export interface PreparedPresentationResource {
  entry: PreparedPresentationAsset;
  url: string;
}

export type PresentationScene =
  | { kind: 'slide'; index: number }
  | { kind: 'transition'; index: number };

interface PresentationCanvasProps {
  projectDir: FileSystemDirectoryHandle;
  manifest: ProjectManifest;
  presentation: Presentation;
  clips: readonly Clip[];
  scene: PresentationScene;
  videoResources: ReadonlyMap<string, PresentationVideoResource>;
  preparedResources: ReadonlyMap<string, PreparedPresentationResource>;
  isPresenting: boolean;
  onComplete: () => void;
}

type ResolvedScene = {
  sceneKey: string;
  slide: PresentationSlide | null;
  clip: Clip | null;
  pin: ClipPin | null;
  transition: PresentationTransition | null;
  video: VideoEntry | null;
  range: { startFrame: number; endFrame: number } | null;
  preparedOwnerId: string | null;
  hideAnimatedAnnotations: boolean;
  error: string | null;
};

function transitionOwnerId(from: PresentationSlide, to: PresentationSlide): string {
  return `edge-${from.id}-${to.id}`;
}

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
      return { sceneKey: `missing-transition-${scene.index}`, slide: null, clip: null, pin: null, transition: null, video: null, range: null, preparedOwnerId: null, hideAnimatedAnnotations: true, error: t('presentation.sceneMissingTransition') };
    }
    const valid = validateMatchVideoEdge(from, to, transition, clips, manifest);
    if (!valid.ok) {
      return { sceneKey: `invalid-transition-${scene.index}`, slide: null, clip: null, pin: null, transition, video: null, range: null, preparedOwnerId: null, hideAnimatedAnnotations: true, error: t(`presentation.validation.${valid.code}`) };
    }
    return {
      sceneKey: `transition-${scene.index}-${from.id}-${to.id}`,
      slide: null,
      clip: null,
      pin: null,
      transition,
      video: valid.video,
      range: valid.range,
      preparedOwnerId: transitionOwnerId(from, to),
      hideAnimatedAnnotations: transition.mode === 'match_video' && transition.hideAnnotationsDuringPlayback,
      error: null,
    };
  }

  const slide = presentation.slides[scene.index] ?? null;
  if (!slide) {
    return { sceneKey: `missing-slide-${scene.index}`, slide: null, clip: null, pin: null, transition: null, video: null, range: null, preparedOwnerId: null, hideAnimatedAnnotations: false, error: t('presentation.sceneMissingSlide') };
  }
  if (slide.kind === 'title') {
    return { sceneKey: `slide-${slide.id}`, slide, clip: null, pin: null, transition: null, video: null, range: null, preparedOwnerId: null, hideAnimatedAnnotations: false, error: null };
  }
  const clip = clipsById.get(slide.clipId) ?? null;
  if (!clip) {
    return { sceneKey: `slide-${slide.id}`, slide, clip: null, pin: null, transition: null, video: null, range: null, preparedOwnerId: null, hideAnimatedAnnotations: false, error: t('presentation.sceneMissingClip', { id: slide.clipId }) };
  }
  const video = manifest.videos.find((candidate) => candidate.id === clip.videoId) ?? null;
  if (!video) {
    return { sceneKey: `slide-${slide.id}`, slide, clip, pin: null, transition: null, video: null, range: null, preparedOwnerId: null, hideAnimatedAnnotations: false, error: t('presentation.sceneMissingVideo', { id: clip.videoId }) };
  }
  if (slide.kind === 'pin') {
    const pin = clip.pins.find((candidate) => candidate.id === slide.pinId) ?? null;
    return {
      sceneKey: `slide-${slide.id}`,
      slide,
      clip,
      pin,
      transition: null,
      video,
      range: pin ? { startFrame: pin.frame, endFrame: pin.frame + 1 } : null,
      preparedOwnerId: null,
      hideAnimatedAnnotations: false,
      error: pin ? null : t('presentation.sceneMissingPin', { id: slide.pinId }),
    };
  }
  return {
    sceneKey: `slide-${slide.id}`,
    slide,
    clip,
    pin: null,
    transition: null,
    video,
    range: { startFrame: clip.startFrame, endFrame: clip.endFrame },
    preparedOwnerId: slide.id,
    hideAnimatedAnnotations: false,
    error: null,
  };
}

function mergePayloads(payloads: readonly AnnotationPayload[], width: number, height: number): AnnotationPayload {
  return {
    image: { width, height },
    shapes: payloads.flatMap((payload) => payload.shapes),
    perspective: payloads.find((payload) => payload.perspective)?.perspective,
  };
}

export default function PresentationCanvas({
  projectDir,
  manifest,
  presentation,
  clips,
  scene,
  videoResources,
  preparedResources,
  isPresenting,
  onComplete,
}: PresentationCanvasProps) {
  const { t, formatNumber } = useLocale();
  const resolved = useMemo(
    () => resolveScene(scene, presentation, clips, manifest, t),
    [clips, manifest, presentation, scene, t],
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
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
  const [message, setMessage] = useState<string | null>(null);
  const [staticElapsedMs, setStaticElapsedMs] = useState(0);
  const [homographyFrames, setHomographyFrames] = useState<HomographyFrame[]>([]);
  const staticStartedAtRef = useRef(Date.now());

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
  const preparedKey = useMemo(() => {
    if (!resolved.preparedOwnerId || !resolved.video || !resolved.range) return null;
    return preparedPresentationAssetKey({
      kind: scene.kind === 'transition' ? 'transition' : 'clip_slide',
      ownerId: resolved.preparedOwnerId,
      videoId: resolved.video.id,
      sourceStartFrame: resolved.range.startFrame,
      sourceEndFrame: resolved.range.endFrame,
    });
  }, [resolved.preparedOwnerId, resolved.range, resolved.video, scene.kind]);
  const prepared = preparedKey ? preparedResources.get(preparedKey) ?? null : null;

  const playbackAsset = useMemo<PresentationPlaybackAsset | null>(() => {
    if (!resolved.video || !resolved.range || !resource) return null;
    return {
      id: prepared?.entry.key ?? `original-${resolved.video.id}-${resolved.range.startFrame}-${resolved.range.endFrame}`,
      kind: prepared ? 'exact_motion' : 'original',
      videoId: resolved.video.id,
      url: prepared?.url ?? resource.url,
      sourceStartFrame: videoFrame(resolved.range.startFrame),
      sourceEndFrame: resolved.range.endFrame as PresentationPlaybackAsset['sourceEndFrame'],
    };
  }, [prepared, resolved.range, resolved.video, resource]);

  const effectivePausePins = useMemo(() => (
    resolved.slide?.kind === 'clip' && resolved.clip
      ? resolveEffectivePausePins(resolved.clip, resolved.slide)
      : []
  ), [resolved.clip, resolved.slide]);

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
    videoRef.current?.pause();
    playIntentRef.current = false;
    setPlaying(false);
    setPausedPin(pin);
    staticStartedAtRef.current = Date.now();
    setStaticElapsedMs(0);
  }, []);

  const sampleVideoFrame = useCallback((mediaTime: number) => {
    if (!playbackAsset || !resolved.video) return;
    const frame = toSourceFrame(playbackAsset, mediaTime, resolved.video);
    if (pendingSeekFrameRef.current !== null && frame !== pendingSeekFrameRef.current) return;
    if (pendingSeekFrameRef.current === frame) pendingSeekFrameRef.current = null;
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
    if (
      playbackAsset.kind === 'original'
      && frame >= playbackAsset.sourceEndFrame - 1
      && !pausedPin
    ) {
      completeVideo();
    }
  }, [completeVideo, effectivePausePins, pauseAtPin, pausedPin, playbackAsset, resolved.slide?.kind, resolved.video]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackAsset || !resolved.video || resolved.slide?.kind === 'pin' || resolved.slide?.kind === 'title') return;
    let cancelled = false;
    let frameRequest = 0;
    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (cancelled) return;
      sampleVideoFrame(metadata.mediaTime);
      frameRequest = video.requestVideoFrameCallback(onFrame);
    };
    const onTimeUpdate = () => sampleVideoFrame(video.currentTime);
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
      staticStartedAtRef.current = Date.now();
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
  const staticSelection = resolved.slide?.kind === 'pin'
    ? resolved.slide.showAnnotations ? resolved.slide.annotationIds : []
    : activePauseCue?.annotationIds;
  const staticCues = resolved.slide?.kind === 'pin'
    ? resolved.slide.annotationCues
    : activePauseCue?.annotationCues;
  const visibleStaticIds = activeStaticPin
    ? visibleAnnotationIds(
        activeStaticPin.annotations.map((reference) => reference.id),
        staticSelection,
        staticCues,
        staticElapsedMs,
      )
    : [];
  const visibleStaticKey = visibleStaticIds.join('|');

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
        const visibleDocumentIds = visibleStaticKey ? visibleStaticKey.split('|') : [];
        const raster = await queue.rasterize({
          frame: activeStaticPin.frame,
          fps: resolved.video!.fps,
          outputWidth: resolved.video!.width,
        });
        let blob = raster.blob;
        if (visibleDocumentIds.length > 0) {
          const documents = await Promise.all(visibleDocumentIds.map((annotationId) => (
            readPinAnnotationDocument(projectDir, resolved.clip!.id, annotationId)
          )));
          const payloads = documents
            .filter((entry) => entry.document)
            .map((entry) => annotationPayloadFromDocument(entry.document!));
          if (payloads.length > 0) {
            const bitmap = await createImageBitmap(raster.blob);
            try {
              blob = await renderAnnotatedPng({ bmp: bitmap, payload: mergePayloads(payloads, raster.width, raster.height) });
            } finally {
              bitmap.close();
            }
          }
        }
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
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
  }, [activeStaticPin, projectDir, resolved.clip, resolved.sceneKey, resolved.video, resource, visibleStaticKey]);

  useEffect(() => {
    if (!activeStaticPin) return;
    const timer = window.setInterval(() => setStaticElapsedMs(Date.now() - staticStartedAtRef.current), 50);
    return () => window.clearInterval(timer);
  }, [activeStaticPin, resolved.sceneKey]);

  const resumeFromPin = useCallback(() => {
    if (!pausedPin || !pauseMachineRef.current) return;
    const wasFinalFrame = playbackAsset && pausedPin.frame >= playbackAsset.sourceEndFrame - 1;
    pauseMachineRef.current = resumePinPauseMachine(pauseMachineRef.current);
    setPausedPin(null);
    if (wasFinalFrame) {
      completeVideo();
      return;
    }
    playIntentRef.current = true;
    if (videoRef.current) requestPlayback(videoRef.current);
  }, [completeVideo, pausedPin, playbackAsset, requestPlayback]);

  useEffect(() => {
    if (!pausedPin || activePauseCue?.holdMs === undefined) return;
    const timer = window.setTimeout(resumeFromPin, activePauseCue.holdMs);
    return () => window.clearTimeout(timer);
  }, [activePauseCue?.holdMs, pausedPin, resumeFromPin]);

  useEffect(() => {
    if (!isPresenting || scene.kind !== 'slide' || !resolved.slide) return;
    if (resolved.slide.kind === 'clip') return;
    if (resolved.slide.holdMs === undefined) return;
    const timer = window.setTimeout(onComplete, resolved.slide.holdMs);
    return () => window.clearTimeout(timer);
  }, [isPresenting, onComplete, resolved.slide, scene.kind]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || pausedPin) return;
    if (!playIntentRef.current) {
      playIntentRef.current = true;
      requestPlayback(video);
    } else {
      playIntentRef.current = false;
      video.pause();
      setPlaying(false);
    }
  }, [pausedPin, requestPlayback]);

  const seekSourceFrame = useCallback((frame: number) => {
    if (!playbackAsset || !resolved.video) return;
    const target = videoFrame(Math.max(playbackAsset.sourceStartFrame, Math.min(playbackAsset.sourceEndFrame - 1, Math.round(frame))));
    requestedSourceFrameRef.current = target;
    pendingSeekFrameRef.current = target;
    setSourceFrame(target);
    if (pauseMachineRef.current) pauseMachineRef.current = seekPinPauseMachine(pauseMachineRef.current, target, effectivePausePins);
    setPausedPin(null);
    if (videoRef.current) videoRef.current.currentTime = sourceFrameToMediaSeconds(playbackAsset, target, resolved.video);
  }, [effectivePausePins, playbackAsset, resolved.video]);

  if (resolved.error || !resolved.slide && scene.kind === 'slide') {
    return <div className="flex h-full items-center justify-center bg-black text-sm text-danger" data-testid="presentation-missing-reference">{resolved.error || t('presentation.missingSlide')}</div>;
  }
  if (resolved.slide?.kind === 'title') {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#0b0d10] px-12 text-center text-[#f4f1e8]" data-testid="presentation-title-slide">
        <p className="text-xs text-[#8d968f]">{t(`presentation.template${resolved.slide.template[0].toUpperCase()}${resolved.slide.template.slice(1)}`)}</p>
        <h1 className="m-0 max-w-4xl text-5xl leading-tight">{resolved.slide.title}</h1>
        {resolved.slide.body && <p className="mt-5 max-w-3xl text-xl text-[#b8c0ba]">{resolved.slide.body}</p>}
      </div>
    );
  }

  const videoVisible = scene.kind === 'transition' || resolved.slide?.kind === 'clip';
  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-black" data-testid="presentation-canvas" data-source-frame={sourceFrame} data-playback-asset={playbackAsset?.kind ?? 'none'}>
      <div className="relative max-h-full max-w-full" style={{ width: resolved.video?.width ?? 640, aspectRatio: `${resolved.video?.width ?? 16}/${resolved.video?.height ?? 9}` }}>
        {videoVisible && playbackAsset && (
          <video
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
      </div>

      {(videoVisible || pausedPin) && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded border border-white/20 bg-black/80 px-3 py-2 text-xs text-white">
          {pausedPin ? (
            <button onClick={resumeFromPin}>{t('presentation.resumeFrom', { label: pausedPin.label || `f${formatNumber(pausedPin.frame)}` })}</button>
          ) : (
            <button onClick={togglePlayback}>{playing ? t('presentation.pausePreview') : t('presentation.playPreview')}</button>
          )}
          {playbackAsset && scene.kind === 'slide' && resolved.slide?.kind === 'clip' && (
            <input
              aria-label={t('presentation.sourceFrame')}
              type="range"
              min={playbackAsset.sourceStartFrame}
              max={playbackAsset.sourceEndFrame - 1}
              step={1}
              value={sourceFrame}
              onInput={(event) => seekSourceFrame(Number(event.currentTarget.value))}
            />
          )}
          <span className="font-mono">f{formatNumber(sourceFrame)}</span>
        </div>
      )}
      {message && <div className="absolute right-3 top-3 max-w-sm rounded bg-black/80 px-3 py-2 text-xs text-warning">{message}</div>}
    </div>
  );
}

export { transitionOwnerId };
