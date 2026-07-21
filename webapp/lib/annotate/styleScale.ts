const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 1080;

export function annotationScaleForVideo(width: number, height: number): number {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return 1;
  return Math.max(0.25, Math.min(4, Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT)));
}

export function defaultAnnotationStrokeWidth(width: number, height: number): number {
  return Math.max(1, 6 * annotationScaleForVideo(width, height));
}

export function defaultAnnotationFontSize(width: number, height: number): number {
  return Math.max(12, 48 * annotationScaleForVideo(width, height));
}
