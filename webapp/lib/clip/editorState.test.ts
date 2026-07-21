import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClipAnnotation, ClipKeyframe } from '../types/clip';
import {
  createDebouncedAsyncScheduler,
  deleteSelectedClipAnnotation,
  mergeTrackedKeyframesIntoAnnotation,
  recordClipAnnotationHistoryChange,
  redoClipAnnotationHistory,
  undoClipAnnotationHistory,
} from './editorState';
import { frameBoundary, videoFrame } from './frameMath';

function box(frame: number, x: number, provenance?: ClipKeyframe['provenance']): ClipKeyframe {
  return { frame: videoFrame(frame), x, y: x, w: 10, h: 10, provenance };
}

function annotation(id: string, keyframes: ClipKeyframe[], source: ClipAnnotation['source'] = 'manual'): ClipAnnotation {
  return {
    id,
    type: 'box',
    coordMode: 'image',
    source,
    style: { stroke: '#fff' },
    keyframes,
  };
}

afterEach(() => vi.useRealTimers());

describe('createDebouncedAsyncScheduler', () => {
  it('runs only the latest payload and supports cancellation', async () => {
    vi.useFakeTimers();
    const saved: number[] = [];
    const scheduler = createDebouncedAsyncScheduler<number>(800, async (value) => {
      saved.push(value);
    });
    scheduler.schedule(1);
    scheduler.schedule(2);
    vi.advanceTimersByTime(800);
    await Promise.resolve();
    expect(saved).toEqual([2]);

    scheduler.schedule(3);
    scheduler.cancel();
    vi.advanceTimersByTime(800);
    expect(saved).toEqual([2]);
  });
});

describe('frame-native clip annotation history', () => {
  it('records, undoes, redoes, and deletes complete annotation states', () => {
    const initial = [annotation('a', [box(10, 0)])];
    const imported = [...initial, annotation('imported', [box(20, 5)])];
    const history = recordClipAnnotationHistoryChange(initial, imported, []);
    const undone = undoClipAnnotationHistory({
      past: history.past,
      future: history.future,
      currentAnnotations: imported,
      selectedAnnotationId: 'imported',
    });
    expect(undone.annotations.map((entry) => entry.id)).toEqual(['a']);
    expect(undone.selectedAnnotationId).toBe('a');

    const redone = redoClipAnnotationHistory({
      past: undone.past,
      future: undone.future,
      currentAnnotations: undone.annotations,
      selectedAnnotationId: undone.selectedAnnotationId,
    });
    expect(redone.annotations.map((entry) => entry.id)).toEqual(['a', 'imported']);
    expect(deleteSelectedClipAnnotation(redone.annotations, 'imported')).toMatchObject({
      annotations: [{ id: 'a' }],
      selectedAnnotationId: null,
    });
  });
});

describe('mergeTrackedKeyframesIntoAnnotation', () => {
  const clipEndFrame = frameBoundary(100);

  it('replaces all keyframes and supplies tracked provenance', () => {
    const result = mergeTrackedKeyframesIntoAnnotation(
      annotation('tracked', [box(0, 0), box(30, 3)]),
      [box(10, 1), box(20, 2)],
      { mergeMode: 'replace', currentFrame: videoFrame(10), clipEndFrame },
    );
    expect(result.source).toBe('auto');
    expect(result.keyframes.map((keyframe) => keyframe.frame)).toEqual([10, 20]);
    expect(result.keyframes.every((keyframe) => keyframe.provenance === 'tracked')).toBe(true);
  });

  it('keeps earlier frames during forward tracking', () => {
    const result = mergeTrackedKeyframesIntoAnnotation(
      annotation('tracked', [box(0, 0, 'manual'), box(30, 3, 'tracked'), box(70, 7, 'tracked')]),
      [box(30, 30, 'tracked'), box(50, 50, 'tracked'), box(90, 90, 'tracked')],
      { mergeMode: 'forward', currentFrame: videoFrame(30), clipEndFrame },
    );
    expect(result.source).toBe('corrected');
    expect(result.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 30, 50, 90]);
    expect(result.keyframes[0]).toMatchObject({ frame: 0, x: 0, provenance: 'manual' });
  });

  it('normalizes backwards range bounds', () => {
    const result = mergeTrackedKeyframesIntoAnnotation(
      annotation('tracked', [box(10, 1, 'manual'), box(50, 5, 'tracked'), box(90, 9, 'correction')]),
      [box(30, 30, 'tracked'), box(40, 40, 'tracked'), box(80, 80, 'tracked')],
      {
        mergeMode: 'range',
        currentFrame: videoFrame(80),
        rangeEndFrame: videoFrame(30),
        clipEndFrame,
      },
    );
    expect(result.keyframes.map((keyframe) => keyframe.frame)).toEqual([10, 30, 40, 80, 90]);
  });

  it('preserves the correction at an exclusive tracking boundary', () => {
    const result = mergeTrackedKeyframesIntoAnnotation(
      annotation('tracked', [
        box(10, 1, 'manual'),
        box(30, 3, 'tracked'),
        box(70, 7, 'correction'),
        box(90, 9, 'tracked'),
      ]),
      [box(30, 30, 'tracked'), box(50, 50, 'tracked'), box(70, 70, 'tracked')],
      {
        mergeMode: 'to_correction',
        currentFrame: videoFrame(30),
        rangeEndFrame: videoFrame(70),
        clipEndFrame,
      },
    );
    expect(result.keyframes).toMatchObject([
      { frame: 10, x: 1, provenance: 'manual' },
      { frame: 30, x: 30, provenance: 'tracked' },
      { frame: 50, x: 50, provenance: 'tracked' },
      { frame: 70, x: 7, provenance: 'correction' },
      { frame: 90, x: 9, provenance: 'tracked' },
    ]);
  });
});
