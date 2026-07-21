import { describe, expect, it } from 'vitest';

import {
  annotationScaleForVideo,
  defaultAnnotationFontSize,
  defaultAnnotationStrokeWidth,
} from './styleScale';

describe('per-video annotation defaults', () => {
  it('keeps defaults visually proportional across source resolutions', () => {
    expect(annotationScaleForVideo(1920, 1080)).toBe(1);
    expect(defaultAnnotationStrokeWidth(3840, 2160)).toBe(12);
    expect(defaultAnnotationFontSize(1280, 720)).toBe(32);
  });

  it('bounds malformed and extreme dimensions', () => {
    expect(annotationScaleForVideo(0, 0)).toBe(1);
    expect(annotationScaleForVideo(100, 100)).toBe(0.25);
    expect(annotationScaleForVideo(10000, 10000)).toBe(4);
  });
});
