import {
  frameToSeconds,
  mediaTimeToVideoFrame,
  videoFrame,
  type FrameBoundary,
  type VideoFrame,
} from '../clip/frameMath';
import type { ClipPin } from '../types/clip';
import type { PinAnnotationCue } from '../types/presentation';
import type { VideoEntry } from '../types/project';

export interface PresentationPlaybackAsset {
  id: string;
  kind: 'original' | 'exact_motion';
  videoId: string;
  url: string;
  sourceStartFrame: VideoFrame;
  sourceEndFrame: FrameBoundary;
}

export interface PinPauseMachine {
  previousFrame: VideoFrame;
  pausedPinId: string | null;
  consumedPinIds: ReadonlySet<string>;
}

export interface PinPauseStep {
  state: PinPauseMachine;
  triggeredPinId: string | null;
}

function clampToAsset(frame: number, asset: PresentationPlaybackAsset): VideoFrame {
  return videoFrame(Math.max(asset.sourceStartFrame, Math.min(asset.sourceEndFrame - 1, frame)));
}

export function toSourceFrame(
  asset: PresentationPlaybackAsset,
  mediaTimeSeconds: number,
  video: VideoEntry,
): VideoFrame {
  if (asset.videoId !== video.id) throw new Error('Playback asset does not belong to the supplied video.');
  if (asset.kind === 'original') {
    return clampToAsset(
      mediaTimeToVideoFrame(mediaTimeSeconds, video.fps, video.frameCount),
      asset,
    );
  }
  const localFrame = mediaTimeToVideoFrame(
    mediaTimeSeconds,
    video.fps,
    Math.max(1, asset.sourceEndFrame - asset.sourceStartFrame),
  );
  return clampToAsset(asset.sourceStartFrame + localFrame, asset);
}

export function sourceFrameToMediaSeconds(
  asset: PresentationPlaybackAsset,
  frame: VideoFrame,
  video: VideoEntry,
): number {
  if (asset.videoId !== video.id) throw new Error('Playback asset does not belong to the supplied video.');
  const clamped = clampToAsset(frame, asset);
  return frameToSeconds(
    asset.kind === 'exact_motion' ? videoFrame(clamped - asset.sourceStartFrame) : clamped,
    video.fps,
  );
}

function sortedPins(pins: readonly ClipPin[]): ClipPin[] {
  return pins.slice().sort((left, right) => left.frame - right.frame || left.id.localeCompare(right.id));
}

export function startPinPauseMachine(
  startFrame: VideoFrame,
  pins: readonly ClipPin[],
): PinPauseStep {
  const startPin = sortedPins(pins).find((pin) => pin.frame === startFrame) ?? null;
  const consumed = new Set<string>();
  if (startPin) consumed.add(startPin.id);
  return {
    state: {
      previousFrame: startFrame,
      pausedPinId: startPin?.id ?? null,
      consumedPinIds: consumed,
    },
    triggeredPinId: startPin?.id ?? null,
  };
}

export function advancePinPauseMachine(
  state: PinPauseMachine,
  currentFrame: VideoFrame,
  pins: readonly ClipPin[],
): PinPauseStep {
  if (state.pausedPinId) return { state, triggeredPinId: null };
  if (currentFrame <= state.previousFrame) {
    return { state: { ...state, previousFrame: currentFrame }, triggeredPinId: null };
  }
  const pin = sortedPins(pins).find((candidate) => (
    candidate.frame > state.previousFrame
    && candidate.frame <= currentFrame
    && !state.consumedPinIds.has(candidate.id)
  )) ?? null;
  if (!pin) {
    return { state: { ...state, previousFrame: currentFrame }, triggeredPinId: null };
  }
  const consumed = new Set(state.consumedPinIds);
  consumed.add(pin.id);
  return {
    state: {
      previousFrame: pin.frame,
      pausedPinId: pin.id,
      consumedPinIds: consumed,
    },
    triggeredPinId: pin.id,
  };
}

export function resumePinPauseMachine(state: PinPauseMachine): PinPauseMachine {
  return state.pausedPinId ? { ...state, pausedPinId: null } : state;
}

export function seekPinPauseMachine(
  state: PinPauseMachine,
  targetFrame: VideoFrame,
  pins: readonly ClipPin[],
): PinPauseMachine {
  const consumed = new Set<string>();
  for (const pin of pins) {
    if (pin.frame <= targetFrame) consumed.add(pin.id);
  }
  return {
    ...state,
    previousFrame: targetFrame,
    pausedPinId: null,
    consumedPinIds: consumed,
  };
}

export function visibleAnnotationIds(
  availableIds: readonly string[],
  selectedIds: readonly string[] | null | undefined,
  cues: readonly PinAnnotationCue[] | undefined,
  elapsedMs: number,
): string[] {
  const selected = selectedIds == null ? new Set(availableIds) : new Set(selectedIds);
  const cueById = new Map((cues ?? []).map((cue) => [cue.annotationId, cue]));
  return availableIds.filter((id) => {
    if (!selected.has(id)) return false;
    const cue = cueById.get(id);
    if (!cue) return true;
    const entered = cue.enterAtMs === undefined || elapsedMs >= cue.enterAtMs;
    const notExited = cue.exitAtMs === undefined || elapsedMs < cue.exitAtMs;
    return entered && notExited;
  });
}
