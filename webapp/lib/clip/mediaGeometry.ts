export type ContainedMediaRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function fitContainedMediaRect(
  containerWidth: number,
  containerHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): ContainedMediaRect {
  if (
    containerWidth <= 0
    || containerHeight <= 0
    || mediaWidth <= 0
    || mediaHeight <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const scale = Math.min(containerWidth / mediaWidth, containerHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}
