export function getFrameDurationMs(fps: number): number {
  return fps > 0 ? 1000 / fps : 1;
}

export function roundAbsoluteMsToVideoFrame(absMs: number, fps: number): number {
  if (!Number.isFinite(absMs)) return 0;
  if (!(fps > 0)) return Math.round(absMs);
  const frameDurationMs = getFrameDurationMs(fps);
  return Math.round(absMs / frameDurationMs) * frameDurationMs;
}

export function snapClipRelativeMsToVideoFrame(
  clipStartMs: number,
  tMs: number,
  fps: number,
  clipDurationMs?: number,
): number {
  if (!Number.isFinite(tMs)) return 0;
  const snapped = roundAbsoluteMsToVideoFrame(clipStartMs + tMs, fps) - clipStartMs;
  if (!Number.isFinite(clipDurationMs)) return snapped;
  return Math.max(0, Math.min(clipDurationMs!, snapped));
}

export function stepClipRelativeFrame(
  clipStartMs: number,
  currentTMs: number,
  direction: 1 | -1,
  fps: number,
  clipDurationMs: number,
): number {
  if (!(fps > 0)) {
    return Math.max(0, Math.min(clipDurationMs, currentTMs + direction));
  }
  const frameDurationMs = getFrameDurationMs(fps);
  const currentAbsoluteMs = clipStartMs + currentTMs;
  const currentFrameIndex = Math.round(currentAbsoluteMs / frameDurationMs);
  const nextAbsoluteMs = (currentFrameIndex + direction) * frameDurationMs;
  return Math.max(0, Math.min(clipDurationMs, nextAbsoluteMs - clipStartMs));
}
