declare const videoFrameBrand: unique symbol;
declare const frameBoundaryBrand: unique symbol;
declare const millisecondsBrand: unique symbol;

/** Index of an existing, displayable frame. */
export type VideoFrame = number & { readonly [videoFrameBrand]: 'VideoFrame' };

/** Exclusive frame-range boundary. May equal a video's frame count. */
export type FrameBoundary = number & { readonly [frameBoundaryBrand]: 'FrameBoundary' };

/** Milliseconds used only at an explicit time-based boundary. */
export type Milliseconds = number & { readonly [millisecondsBrand]: 'Milliseconds' };

export type FrameRange = {
  startFrame: VideoFrame;
  endFrame: FrameBoundary;
};

const FRAME_INDEX_EPSILON = 1e-7;

function requirePositiveFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('fps must be a positive finite number');
  }
}

function requireFrameCount(frameCount: number): void {
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new RangeError('frameCount must be a positive integer');
  }
}

function requireFrameIndex(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

export function videoFrame(value: number): VideoFrame {
  requireFrameIndex(value, 'VideoFrame');
  return value as VideoFrame;
}

export function frameBoundary(value: number): FrameBoundary {
  requireFrameIndex(value, 'FrameBoundary');
  return value as FrameBoundary;
}

export function milliseconds(value: number): Milliseconds {
  if (!Number.isFinite(value)) {
    throw new RangeError('Milliseconds must be finite');
  }
  return value as Milliseconds;
}

export function assertFrameRange(range: FrameRange): void {
  requireFrameIndex(range.startFrame, 'startFrame');
  requireFrameIndex(range.endFrame, 'endFrame');
  if (range.endFrame <= range.startFrame) {
    throw new RangeError('endFrame must be greater than startFrame');
  }
}

/**
 * Maps media time for the frame currently presented by a video element.
 * `requestVideoFrameCallback().mediaTime` should be preferred by callers.
 */
export function mediaTimeToVideoFrame(
  mediaTimeSeconds: number,
  fps: number,
  frameCount: number,
): VideoFrame {
  requirePositiveFps(fps);
  requireFrameCount(frameCount);
  const finiteSeconds = Number.isFinite(mediaTimeSeconds) ? mediaTimeSeconds : 0;
  const frame = Math.floor(finiteSeconds * fps + FRAME_INDEX_EPSILON);
  return videoFrame(Math.max(0, Math.min(frameCount - 1, frame)));
}

/** Maps a timestamp returned by the sidecar to the nearest source frame. */
export function timestampMsToNearestFrame(
  timestampMs: number | Milliseconds,
  fps: number,
  frameCount: number,
): VideoFrame {
  requirePositiveFps(fps);
  requireFrameCount(frameCount);
  const finiteMs = Number.isFinite(timestampMs) ? timestampMs : 0;
  const frame = Math.round((finiteMs * fps) / 1000);
  return videoFrame(Math.max(0, Math.min(frameCount - 1, frame)));
}

export function frameToMs(
  frame: VideoFrame | FrameBoundary,
  fps: number,
): Milliseconds {
  requirePositiveFps(fps);
  requireFrameIndex(frame, 'frame');
  return milliseconds((frame * 1000) / fps);
}

export function frameToSeconds(
  frame: VideoFrame | FrameBoundary,
  fps: number,
): number {
  requirePositiveFps(fps);
  requireFrameIndex(frame, 'frame');
  return frame / fps;
}

/**
 * Seeks into the middle of a displayable frame so decoder timestamp rounding
 * cannot resolve the requested frame as the preceding one.
 */
export function frameToCenterSeconds(
  frame: VideoFrame,
  fps: number,
): number {
  requirePositiveFps(fps);
  requireFrameIndex(frame, 'frame');
  return (frame + 0.5) / fps;
}

export function clampFrame(frame: number, frameCount: number): VideoFrame {
  requireFrameCount(frameCount);
  const finiteFrame = Number.isFinite(frame) ? Math.trunc(frame) : 0;
  return videoFrame(Math.max(0, Math.min(frameCount - 1, finiteFrame)));
}

export function frameRangeDuration(range: FrameRange): number {
  assertFrameRange(range);
  return range.endFrame - range.startFrame;
}

export function lastFrameOfRange(range: FrameRange): VideoFrame {
  assertFrameRange(range);
  return videoFrame(range.endFrame - 1);
}

/**
 * The sidecar sampler includes `endMs`, so send the final real frame rather
 * than the range's exclusive boundary.
 */
export function sidecarSampleEndMs(range: FrameRange, videoFps: number): Milliseconds {
  return frameToMs(lastFrameOfRange(range), videoFps);
}

/** Duration supplied to encoders, which consume the half-open range. */
export function encodeDurationMs(range: FrameRange, videoFps: number): Milliseconds {
  requirePositiveFps(videoFps);
  return milliseconds((frameRangeDuration(range) * 1000) / videoFps);
}

export function canRunRangeSidecarAction(range: FrameRange): boolean {
  assertFrameRange(range);
  return frameRangeDuration(range) >= 2;
}
