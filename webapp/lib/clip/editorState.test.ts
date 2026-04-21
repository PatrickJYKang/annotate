import { describe, expect, it, vi, afterEach } from "vitest";

import type { ClipAnnotation, ClipKeyframe } from "../types/clip";
import {
  createDebouncedAsyncScheduler,
  deleteSelectedClipAnnotation,
  mergeTrackedKeyframesIntoAnnotation,
  recordClipAnnotationHistoryChange,
  redoClipAnnotationHistory,
  undoClipAnnotationHistory,
} from "./editorState";

function makeBoxAnnotation(id: string, keyframes: ClipKeyframe[], source: ClipAnnotation["source"] = "manual"): ClipAnnotation {
  return {
    id,
    type: "box",
    coordMode: "image",
    source,
    style: { stroke: "#fff" },
    keyframes,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createDebouncedAsyncScheduler", () => {
  it("only saves the latest payload during rapid edits", async () => {
    vi.useFakeTimers();
    const saved: number[] = [];
    const scheduler = createDebouncedAsyncScheduler<number>(800, async (value) => {
      saved.push(value);
    });

    scheduler.schedule(1);
    vi.advanceTimersByTime(400);
    scheduler.schedule(2);
    vi.advanceTimersByTime(799);
    expect(saved).toEqual([]);

    vi.advanceTimersByTime(1);
    await Promise.resolve();

    expect(saved).toEqual([2]);
  });

  it("can cancel a pending save", async () => {
    vi.useFakeTimers();
    const saved: number[] = [];
    const scheduler = createDebouncedAsyncScheduler<number>(800, async (value) => {
      saved.push(value);
    });

    scheduler.schedule(3);
    scheduler.cancel();
    vi.advanceTimersByTime(800);
    await Promise.resolve();

    expect(saved).toEqual([]);
  });
});

describe("clip annotation history", () => {
  it("records normal changes by pushing the previous state and clearing redo history", () => {
    const previous = [makeBoxAnnotation("a", [{ tMs: 0, x: 0, y: 0, w: 10, h: 10 }])];
    const next = [...previous, makeBoxAnnotation("b", [{ tMs: 200, x: 20, y: 20, w: 10, h: 10 }])];
    const history = recordClipAnnotationHistoryChange(previous, next, []);

    expect(history.past).toHaveLength(1);
    expect(history.future).toEqual([]);
    expect(history.past[0]).toMatchObject([{ id: "a" }]);
  });

  it("supports undo and redo across import-like append and delete flows", () => {
    const initial = [makeBoxAnnotation("a", [{ tMs: 0, x: 0, y: 0, w: 10, h: 10 }])];
    const imported = [...initial, makeBoxAnnotation("imported", [{ tMs: 250, x: 5, y: 5, w: 8, h: 8 }])];
    const afterImport = recordClipAnnotationHistoryChange(initial, imported, []);

    const undoImport = undoClipAnnotationHistory({
      past: afterImport.past,
      future: afterImport.future,
      currentAnnotations: imported,
      selectedAnnotationId: "imported",
    });
    expect(undoImport.didUndo).toBe(true);
    expect(undoImport.annotations.map((annotation) => annotation.id)).toEqual(["a"]);
    expect(undoImport.selectedAnnotationId).toBe("a");

    const redoImport = redoClipAnnotationHistory({
      past: undoImport.past,
      future: undoImport.future,
      currentAnnotations: undoImport.annotations,
      selectedAnnotationId: undoImport.selectedAnnotationId,
    });
    expect(redoImport.didRedo).toBe(true);
    expect(redoImport.annotations.map((annotation) => annotation.id)).toEqual(["a", "imported"]);

    const deleted = deleteSelectedClipAnnotation(redoImport.annotations, "imported");
    const afterDelete = recordClipAnnotationHistoryChange(redoImport.annotations, deleted.annotations, redoImport.past);
    const undoDelete = undoClipAnnotationHistory({
      past: afterDelete.past,
      future: afterDelete.future,
      currentAnnotations: deleted.annotations,
      selectedAnnotationId: deleted.selectedAnnotationId,
    });
    expect(undoDelete.didUndo).toBe(true);
    expect(undoDelete.annotations.map((annotation) => annotation.id)).toEqual(["a", "imported"]);
  });
});

describe("deleteSelectedClipAnnotation", () => {
  it("removes the selected annotation and clears selection", () => {
    const annotations = [
      makeBoxAnnotation("a", [{ tMs: 0, x: 0, y: 0, w: 10, h: 10 }]),
      makeBoxAnnotation("b", [{ tMs: 100, x: 10, y: 10, w: 5, h: 5 }]),
    ];

    const result = deleteSelectedClipAnnotation(annotations, "b");

    expect(result.annotations.map((annotation) => annotation.id)).toEqual(["a"]);
    expect(result.selectedAnnotationId).toBeNull();
  });
});

describe("mergeTrackedKeyframesIntoAnnotation", () => {
  it("replaces all keyframes during a full track", () => {
    const annotation = makeBoxAnnotation("tracked", [
      { tMs: 0, x: 0, y: 0, w: 10, h: 10 },
      { tMs: 300, x: 3, y: 3, w: 10, h: 10 },
    ]);
    const tracked = [
      { tMs: 100, x: 1, y: 1, w: 10, h: 10 },
      { tMs: 200, x: 2, y: 2, w: 10, h: 10 },
    ] satisfies ClipKeyframe[];

    const result = mergeTrackedKeyframesIntoAnnotation(annotation, tracked, {
      mergeMode: "replace",
      currentTMs: 100,
      clipDurationMs: 1000,
    });

    expect(result.source).toBe("auto");
    expect(result.keyframes.map((keyframe) => keyframe.tMs)).toEqual([100, 200]);
    expect(result.keyframes.every((keyframe) => keyframe.provenance === "tracked")).toBe(true);
  });

  it("keeps earlier keyframes and replaces only later ones during forward re-track", () => {
    const annotation = makeBoxAnnotation("tracked", [
      { tMs: 0, x: 0, y: 0, w: 10, h: 10, provenance: "manual" },
      { tMs: 300, x: 3, y: 3, w: 10, h: 10, provenance: "tracked" },
      { tMs: 700, x: 7, y: 7, w: 10, h: 10, provenance: "tracked" },
    ]);
    const tracked = [
      { tMs: 300, x: 30, y: 30, w: 10, h: 10, provenance: "tracked" },
      { tMs: 500, x: 50, y: 50, w: 10, h: 10, provenance: "tracked" },
      { tMs: 900, x: 90, y: 90, w: 10, h: 10, provenance: "tracked" },
    ] satisfies ClipKeyframe[];

    const result = mergeTrackedKeyframesIntoAnnotation(annotation, tracked, {
      mergeMode: "forward",
      currentTMs: 300,
      clipDurationMs: 1000,
    });

    expect(result.source).toBe("corrected");
    expect(result.keyframes.map((keyframe) => keyframe.tMs)).toEqual([0, 300, 500, 900]);
    expect(result.keyframes[0]?.provenance).toBe("manual");
    expect(result.keyframes[1]?.provenance).toBe("tracked");
    expect(result.keyframes[0]).toMatchObject({ tMs: 0, x: 0, y: 0, provenance: "manual" });
    expect(result.keyframes.slice(1)).toMatchObject([
      { tMs: 300, x: 30, y: 30, provenance: "tracked" },
      { tMs: 500, x: 50, y: 50, provenance: "tracked" },
      { tMs: 900, x: 90, y: 90, provenance: "tracked" },
    ]);
  });

  it("normalizes backwards-selected range bounds before replacing the middle span", () => {
    const annotation = makeBoxAnnotation("tracked", [
      { tMs: 100, x: 1, y: 1, w: 10, h: 10, provenance: "manual" },
      { tMs: 500, x: 5, y: 5, w: 10, h: 10, provenance: "tracked" },
      { tMs: 900, x: 9, y: 9, w: 10, h: 10, provenance: "correction" },
    ]);
    const tracked = [
      { tMs: 300, x: 30, y: 30, w: 10, h: 10, provenance: "tracked" },
      { tMs: 400, x: 40, y: 40, w: 10, h: 10, provenance: "tracked" },
      { tMs: 800, x: 80, y: 80, w: 10, h: 10, provenance: "tracked" },
    ] satisfies ClipKeyframe[];

    const result = mergeTrackedKeyframesIntoAnnotation(annotation, tracked, {
      mergeMode: "range",
      currentTMs: 800,
      rangeEndMs: 300,
      clipDurationMs: 1000,
    });

    expect(result.source).toBe("corrected");
    expect(result.keyframes.map((keyframe) => keyframe.tMs)).toEqual([100, 300, 400, 800, 900]);
    expect(result.keyframes).toMatchObject([
      { tMs: 100, x: 1, y: 1, provenance: "manual" },
      { tMs: 300, x: 30, y: 30, provenance: "tracked" },
      { tMs: 400, x: 40, y: 40, provenance: "tracked" },
      { tMs: 800, x: 80, y: 80, provenance: "tracked" },
      { tMs: 900, x: 9, y: 9, provenance: "correction" },
    ]);
  });

  it("can re-track from here to the next correction while preserving the boundary correction point", () => {
    const annotation = makeBoxAnnotation("tracked", [
      { tMs: 100, x: 1, y: 1, w: 10, h: 10, provenance: "manual" },
      { tMs: 300, x: 3, y: 3, w: 10, h: 10, provenance: "tracked" },
      { tMs: 700, x: 7, y: 7, w: 10, h: 10, provenance: "correction" },
      { tMs: 900, x: 9, y: 9, w: 10, h: 10, provenance: "tracked" },
    ]);
    const tracked = [
      { tMs: 300, x: 30, y: 30, w: 10, h: 10, provenance: "tracked" },
      { tMs: 500, x: 50, y: 50, w: 10, h: 10, provenance: "tracked" },
      { tMs: 700, x: 70, y: 70, w: 10, h: 10, provenance: "tracked" },
    ] satisfies ClipKeyframe[];

    const result = mergeTrackedKeyframesIntoAnnotation(annotation, tracked, {
      mergeMode: "to_correction",
      currentTMs: 300,
      rangeEndMs: 700,
      clipDurationMs: 1000,
    });

    expect(result.source).toBe("corrected");
    expect(result.keyframes).toMatchObject([
      { tMs: 100, x: 1, y: 1, provenance: "manual" },
      { tMs: 300, x: 30, y: 30, provenance: "tracked" },
      { tMs: 500, x: 50, y: 50, provenance: "tracked" },
      { tMs: 700, x: 7, y: 7, provenance: "correction" },
      { tMs: 900, x: 9, y: 9, provenance: "tracked" },
    ]);
  });
});
