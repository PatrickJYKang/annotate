import { describe, it, expect } from "vitest";
import { formatRawTime, formatMatchTimestamp } from "./timeDisplay";
import type { MatchPeriod } from "../types/project";

// ---------------------------------------------------------------------------
// formatRawTime
// ---------------------------------------------------------------------------

describe("formatRawTime", () => {
  it("formats zero", () => {
    expect(formatRawTime(0)).toBe("0:00.000");
  });

  it("formats sub-minute", () => {
    expect(formatRawTime(34120)).toBe("0:34.120");
  });

  it("formats minutes and seconds", () => {
    expect(formatRawTime(125_500)).toBe("2:05.500");
  });

  it("formats hours", () => {
    expect(formatRawTime(3_661_000)).toBe("1:01:01.000");
  });

  it("handles negative input (clamps to 0)", () => {
    expect(formatRawTime(-5000)).toBe("0:00.000");
  });
});

// ---------------------------------------------------------------------------
// formatMatchTimestamp — with complete boundaries
// ---------------------------------------------------------------------------

const VIDEO_ID = "vid1";

function makePeriods(overrides?: Partial<MatchPeriod>[]): MatchPeriod[] {
  const defaults: MatchPeriod[] = [
    { id: "p1", label: "1st Half", videoId: VIDEO_ID, startMs: 500, endMs: 2_700_000 },
    { id: "p2", label: "2nd Half", videoId: VIDEO_ID, startMs: 2_800_000, endMs: 5_500_000 },
  ];
  if (!overrides) return defaults;
  return defaults.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
}

describe("formatMatchTimestamp — complete boundaries", () => {
  const periods = makePeriods();

  it("formats a timestamp in the 1st half", () => {
    // 500ms offset from start (0:00:500) → 34 min 12 sec into 1st half
    const t = 500 + 34 * 60_000 + 12_000; // 2_052_500
    const result = formatMatchTimestamp(t, VIDEO_ID, periods);
    expect(result.periodAware).toBe(true);
    expect(result.display).toBe("1H 34:12");
  });

  it("formats start of 1st half as 00:00", () => {
    const result = formatMatchTimestamp(500, VIDEO_ID, periods);
    expect(result.periodAware).toBe(true);
    expect(result.display).toBe("1H 00:00");
  });

  it("formats a timestamp in the 2nd half", () => {
    const t = 2_800_000 + 7 * 60_000 + 40_000; // 3_260_000
    const result = formatMatchTimestamp(t, VIDEO_ID, periods);
    expect(result.periodAware).toBe(true);
    expect(result.display).toBe("2H 07:40");
  });

  it("falls back to raw time for timestamps between periods", () => {
    // Between 1st half end (2_700_000) and 2nd half start (2_800_000)
    const t = 2_750_000;
    const result = formatMatchTimestamp(t, VIDEO_ID, periods);
    expect(result.periodAware).toBe(false);
    expect(result.display).toBe(formatRawTime(t));
  });

  it("falls back to raw time for timestamps before first period", () => {
    const result = formatMatchTimestamp(100, VIDEO_ID, periods);
    expect(result.periodAware).toBe(false);
  });

  it("falls back to raw time for timestamps after last period", () => {
    const result = formatMatchTimestamp(6_000_000, VIDEO_ID, periods);
    expect(result.periodAware).toBe(false);
  });

  it("falls back for a different videoId", () => {
    const result = formatMatchTimestamp(1_000_000, "other_video", periods);
    expect(result.periodAware).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatMatchTimestamp — missing boundaries (fallback)
// ---------------------------------------------------------------------------

describe("formatMatchTimestamp — missing boundaries", () => {
  it("falls back when periods array is empty", () => {
    const result = formatMatchTimestamp(60_000, VIDEO_ID, []);
    expect(result.periodAware).toBe(false);
    expect(result.display).toBe("1:00.000");
  });

  it("falls back when startMs is null", () => {
    const periods = makePeriods([{ startMs: null }]);
    const result = formatMatchTimestamp(1_000_000, VIDEO_ID, periods);
    // First period is incomplete, second is complete but timestamp may not fall in it
    expect(result.periodAware).toBe(false);
  });

  it("falls back when endMs is null", () => {
    const periods = makePeriods([{ endMs: null }]);
    const result = formatMatchTimestamp(1_000_000, VIDEO_ID, periods);
    expect(result.periodAware).toBe(false);
  });

  it("falls back when both startMs and endMs are null on all periods", () => {
    const periods: MatchPeriod[] = [
      { id: "p1", label: "1st Half", videoId: VIDEO_ID, startMs: null, endMs: null },
      { id: "p2", label: "2nd Half", videoId: VIDEO_ID, startMs: null, endMs: null },
    ];
    const result = formatMatchTimestamp(60_000, VIDEO_ID, periods);
    expect(result.periodAware).toBe(false);
    expect(result.display).toBe("1:00.000");
  });
});

// ---------------------------------------------------------------------------
// Custom period labels
// ---------------------------------------------------------------------------

describe("formatMatchTimestamp — custom labels", () => {
  it("uses short label for Extra Time 1", () => {
    const periods: MatchPeriod[] = [
      { id: "et1", label: "Extra Time 1", videoId: VIDEO_ID, startMs: 0, endMs: 1_800_000 },
    ];
    const result = formatMatchTimestamp(300_000, VIDEO_ID, periods);
    expect(result.periodAware).toBe(true);
    expect(result.display).toBe("ET1 05:00");
  });

  it("uses raw label for unknown period names", () => {
    const periods: MatchPeriod[] = [
      { id: "x", label: "Penalties", videoId: VIDEO_ID, startMs: 0, endMs: 600_000 },
    ];
    const result = formatMatchTimestamp(120_000, VIDEO_ID, periods);
    expect(result.periodAware).toBe(true);
    expect(result.display).toBe("Penalties 02:00");
  });
});
