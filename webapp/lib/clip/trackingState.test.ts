import { describe, expect, it } from "vitest";

import type { ClipAnnotation } from "../types/clip";
import {
  countCorrectionKeyframes,
  getDerivedHiddenGapSpans,
  getCurrentKeyframeAtTime,
  getFrameTrackingState,
  getHiddenSpans,
  getKeyframeProvenance,
  getLossSpans,
  getNextCorrectionKeyframe,
  getTrackingGapThresholdMs,
  isTimeWithinHiddenSpan,
} from "./trackingState";

describe("trackingState", () => {
  const trackedAnnotation: ClipAnnotation = {
    id: "ann-1",
    type: "box",
    coordMode: "image",
    source: "corrected",
    style: {},
    keyframes: [
      { tMs: 0, x: 10, y: 10, w: 20, h: 20, provenance: "tracked" },
      { tMs: 100, x: 12, y: 12, w: 20, h: 20, provenance: "correction" },
      { tMs: 200, x: 14, y: 14, w: 20, h: 20, provenance: "tracked" },
      { tMs: 300, x: 0, y: 0, w: 0, h: 0, visible: false, provenance: "lost" },
      { tMs: 450, x: 20, y: 20, w: 20, h: 20, provenance: "tracked" },
    ],
  };

  it("returns explicit provenance when present", () => {
    expect(getKeyframeProvenance(trackedAnnotation, trackedAnnotation.keyframes[1])).toBe("correction");
    expect(getKeyframeProvenance(trackedAnnotation, trackedAnnotation.keyframes[3])).toBe("lost");
  });

  it("falls back to annotation source when provenance is missing", () => {
    expect(getKeyframeProvenance(
      { source: "manual" },
      {},
    )).toBe("manual");
    expect(getKeyframeProvenance(
      { source: "auto" },
      {},
    )).toBe("tracked");
  });

  it("counts correction points", () => {
    expect(countCorrectionKeyframes(trackedAnnotation)).toBe(1);
  });

  it("derives lost spans from lost keyframes", () => {
    expect(getLossSpans(trackedAnnotation, 600)).toEqual([{ startMs: 300, endMs: 450 }]);
  });

  it("uses a conservative tracked-gap threshold", () => {
    expect(getTrackingGapThresholdMs(30)).toBeCloseTo(200, 5);
    expect(getTrackingGapThresholdMs(5)).toBeCloseTo(250, 5);
  });

  it("derives hidden spans for long tracked gaps but not short ones", () => {
    const longGap: ClipAnnotation = {
      id: "ann-long",
      type: "box",
      coordMode: "image",
      source: "corrected",
      style: {},
      keyframes: [
        { tMs: 0, x: 0, y: 0, w: 10, h: 10, provenance: "tracked" },
        { tMs: 400, x: 40, y: 40, w: 10, h: 10, provenance: "tracked" },
      ],
    };
    const shortGap: ClipAnnotation = {
      ...longGap,
      id: "ann-short",
      keyframes: [
        { tMs: 0, x: 0, y: 0, w: 10, h: 10, provenance: "tracked" },
        { tMs: 150, x: 15, y: 15, w: 10, h: 10, provenance: "tracked" },
      ],
    };

    expect(getDerivedHiddenGapSpans(longGap, 30)).toEqual([{ startMs: 0, endMs: 400 }]);
    expect(getDerivedHiddenGapSpans(shortGap, 30)).toEqual([]);
  });

  it("combines explicit loss and derived hidden spans", () => {
    const annotation: ClipAnnotation = {
      id: "ann-hidden",
      type: "box",
      coordMode: "image",
      source: "corrected",
      style: {},
      keyframes: [
        { tMs: 0, x: 0, y: 0, w: 10, h: 10, provenance: "tracked" },
        { tMs: 400, x: 40, y: 40, w: 10, h: 10, provenance: "tracked" },
        { tMs: 600, x: 0, y: 0, w: 0, h: 0, visible: false, provenance: "lost" },
        { tMs: 800, x: 80, y: 80, w: 10, h: 10, provenance: "correction" },
      ],
    };

    expect(getHiddenSpans(annotation, 1000, 30)).toEqual([
      { startMs: 0, endMs: 400 },
      { startMs: 600, endMs: 800 },
    ]);
    expect(isTimeWithinHiddenSpan(getHiddenSpans(annotation, 1000, 30), 200)).toBe(true);
    expect(isTimeWithinHiddenSpan(getHiddenSpans(annotation, 1000, 30), 800)).toBe(false);
  });

  it("finds current keyed frame with tolerance", () => {
    expect(getCurrentKeyframeAtTime(trackedAnnotation, 102, 4)?.tMs).toBe(100);
    expect(getCurrentKeyframeAtTime(trackedAnnotation, 107, 4)).toBeNull();
  });

  it("derives current frame state across tracked, correction, and lost spans", () => {
    expect(getFrameTrackingState(trackedAnnotation, 0, 1)).toBe("tracked");
    expect(getFrameTrackingState(trackedAnnotation, 100, 1)).toBe("correction");
    expect(getFrameTrackingState(trackedAnnotation, 160, 1)).toBe("correction");
    expect(getFrameTrackingState(trackedAnnotation, 320, 1)).toBe("lost");
  });

  it("treats a long tracked gap before a correction point as hidden until the correction", () => {
    const annotation: ClipAnnotation = {
      id: "ann-correction-gap",
      type: "box",
      coordMode: "image",
      source: "corrected",
      style: {},
      keyframes: [
        { tMs: 100, x: 10, y: 10, w: 10, h: 10, provenance: "tracked" },
        { tMs: 700, x: 70, y: 70, w: 10, h: 10, provenance: "correction" },
      ],
    };

    expect(getFrameTrackingState(annotation, 400, 1, 900, 30)).toBe("lost");
    expect(getFrameTrackingState(annotation, 700, 1, 900, 30)).toBe("correction");
  });

  it("finds the next correction point after the current frame", () => {
    expect(getNextCorrectionKeyframe(trackedAnnotation, 0, 1)?.tMs).toBe(100);
    expect(getNextCorrectionKeyframe(trackedAnnotation, 100, 1)).toBeNull();
  });
});
