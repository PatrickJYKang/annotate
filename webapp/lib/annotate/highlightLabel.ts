export interface HighlightLabelPlacementInput {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  textWidth: number;
  textHeight: number;
  frameWidth: number;
  frameHeight: number;
  gap?: number;
  padding?: number;
}

export interface HighlightLabelPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'left' | 'right';
}

let measurementContext: CanvasRenderingContext2D | null | undefined;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function measureHighlightLabelText(
  text: string,
  fontSize: number,
  fontFamily: string,
): number {
  if (measurementContext === undefined && typeof document !== 'undefined') {
    measurementContext = document.createElement('canvas').getContext('2d');
  }
  if (measurementContext) {
    measurementContext.font = `${fontSize}px ${fontFamily}`;
    return measurementContext.measureText(text).width;
  }
  return text.length * fontSize * 0.6;
}

export function placeHighlightLabel({
  centerX,
  centerY,
  radiusX,
  textWidth,
  textHeight,
  frameWidth,
  frameHeight,
  gap = Math.max(6, textHeight * 0.2),
  padding = Math.max(4, textHeight * 0.08),
}: HighlightLabelPlacementInput): HighlightLabelPlacement {
  const safeFrameWidth = Math.max(1, frameWidth);
  const safeFrameHeight = Math.max(1, frameHeight);
  const horizontalPadding = Math.min(Math.max(0, padding), safeFrameWidth / 2);
  const verticalPadding = Math.min(Math.max(0, padding), safeFrameHeight / 2);
  const availableWidth = Math.max(1, safeFrameWidth - horizontalPadding * 2);
  const availableHeight = Math.max(1, safeFrameHeight - verticalPadding * 2);
  const width = Math.min(Math.max(1, textWidth), availableWidth);
  const height = Math.min(Math.max(1, textHeight), availableHeight);
  const safeRadiusX = Math.max(0, radiusX);
  const rightX = centerX + safeRadiusX + gap;
  const leftX = centerX - safeRadiusX - gap - width;
  const rightFits = rightX + width <= safeFrameWidth - horizontalPadding;
  const leftFits = leftX >= horizontalPadding;
  const rightRoom = safeFrameWidth - horizontalPadding - rightX;
  const leftRoom = centerX - safeRadiusX - gap - horizontalPadding;
  const side: 'left' | 'right' = rightFits || (!leftFits && rightRoom >= leftRoom)
    ? 'right'
    : 'left';
  const preferredX = side === 'right' ? rightX : leftX;
  const maxX = Math.max(horizontalPadding, safeFrameWidth - horizontalPadding - width);
  const maxY = Math.max(verticalPadding, safeFrameHeight - verticalPadding - height);

  return {
    x: clamp(preferredX, horizontalPadding, maxX),
    y: clamp(centerY - height / 2, verticalPadding, maxY),
    width,
    height,
    side,
  };
}
