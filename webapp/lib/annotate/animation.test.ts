import { describe, expect, it } from 'vitest';

import type { AnnotationAnimationStep } from '../types/annotations';
import {
  annotationAnimationClickSteps,
  compileAnnotationAnimations,
  hasPendingAnnotationAnimationClick,
  sampleAnnotationAnimations,
} from './animation';

const sequence: AnnotationAnimationStep[] = [
  { id: 'a', shapeIds: ['shape-a'], effect: 'fade', trigger: 'on_click', delayMs: 100, durationMs: 400 },
  { id: 'b', shapeIds: ['shape-b'], effect: 'grow', trigger: 'with_previous', delayMs: 50, durationMs: 300 },
  { id: 'c', shapeIds: ['shape-c'], effect: 'wipe', trigger: 'after_previous', delayMs: 25, durationMs: 200 },
  { id: 'd', shapeIds: ['shape-d'], effect: 'appear', trigger: 'on_click', delayMs: 0, durationMs: 0 },
];

describe('annotation animation timing', () => {
  it('compiles click, with-previous, and after-previous timing in sequence order', () => {
    expect(compileAnnotationAnimations(sequence).map((animation) => ({
      id: animation.id,
      clickStep: animation.clickStep,
      startAfterMs: animation.startAfterMs,
      endAfterMs: animation.endAfterMs,
    }))).toEqual([
      { id: 'a', clickStep: 1, startAfterMs: 100, endAfterMs: 500 },
      { id: 'b', clickStep: 1, startAfterMs: 150, endAfterMs: 450 },
      { id: 'c', clickStep: 1, startAfterMs: 475, endAfterMs: 675 },
      { id: 'd', clickStep: 2, startAfterMs: 0, endAfterMs: 0 },
    ]);
    expect(annotationAnimationClickSteps(sequence)).toBe(2);
  });

  it('keeps on-click targets hidden until their click and samples each effect', () => {
    expect(sampleAnnotationAnimations(sequence, 50, []).get('shape-a')).toEqual({ opacity: 0, scale: 1, reveal: 0 });

    const during = sampleAnnotationAnimations(sequence, 300, [100]);
    expect(during.get('shape-a')?.opacity).toBeCloseTo(0.25);
    expect(during.get('shape-b')?.scale).toBeGreaterThan(0.68);
    expect(during.get('shape-c')).toEqual({ opacity: 0, scale: 1, reveal: 0 });

    const wiped = sampleAnnotationAnimations(sequence, 700, [100]);
    expect(wiped.get('shape-c')?.reveal).toBeCloseTo(0.625);
    expect(wiped.get('shape-d')).toEqual({ opacity: 0, scale: 1, reveal: 0 });

    expect(sampleAnnotationAnimations(sequence, 700, [100, 700]).get('shape-d')).toEqual({ opacity: 1, scale: 1, reveal: 1 });
  });

  it('starts a leading with-previous step automatically and reports pending clicks', () => {
    const automatic: AnnotationAnimationStep[] = [{
      id: 'auto',
      shapeIds: ['shape'],
      effect: 'fade',
      trigger: 'with_previous',
      delayMs: 0,
      durationMs: 200,
    }];
    expect(sampleAnnotationAnimations(automatic, 100, []).get('shape')?.opacity).toBeCloseTo(0.5);
    expect(hasPendingAnnotationAnimationClick(automatic, [])).toBe(false);
    expect(hasPendingAnnotationAnimationClick(sequence, [100])).toBe(true);
    expect(hasPendingAnnotationAnimationClick(sequence, [100, 700])).toBe(false);
  });
});
