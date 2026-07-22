export function framePositionX(
  frame: number,
  startFrame: number,
  endFrame: number,
  laneWidth: number,
): number {
  const frameCount = Math.max(1, endFrame - startFrame);
  const clampedFrame = Math.max(startFrame, Math.min(endFrame - 1, Math.round(frame)));
  if (frameCount === 1) return 0;
  return ((clampedFrame - startFrame) / (frameCount - 1)) * laneWidth;
}

export function timelineXToFrame(
  x: number,
  startFrame: number,
  endFrame: number,
  laneWidth: number,
): number {
  const frameCount = Math.max(1, endFrame - startFrame);
  const safeWidth = Math.max(1, laneWidth);
  const relativeFrame = Math.round(
    (Math.max(0, Math.min(safeWidth, x)) / safeWidth) * Math.max(0, frameCount - 1),
  );
  return Math.max(startFrame, Math.min(endFrame - 1, startFrame + relativeFrame));
}

/** Choose readable grid spacing while showing every frame once there is room. */
export function frameGridStep(frameSpacingPx: number, minimumGridSpacingPx = 8): number {
  if (!Number.isFinite(frameSpacingPx) || frameSpacingPx <= 0) return 1;
  const requiredStep = minimumGridSpacingPx / frameSpacingPx;
  if (requiredStep <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(requiredStep));
  for (const multiplier of [1, 2, 5, 10]) {
    const step = multiplier * magnitude;
    if (step >= requiredStep) return Math.max(1, Math.round(step));
  }
  return Math.max(1, Math.ceil(requiredStep));
}

export function isDeliberateKeyframeDrag(
  startClientX: number,
  currentClientX: number,
  thresholdPx = 6,
): boolean {
  return Math.abs(currentClientX - startClientX) >= thresholdPx;
}
