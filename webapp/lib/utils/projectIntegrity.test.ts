import { describe, expect, it } from "vitest";
import type { ProjectManifestV1 } from "../types/project";
import {
  findCanonicalStillForMark,
  findLinkedStillsForMark,
  findMarkAtTimestamp,
  hasDuplicateMarkTimestamp,
  repairManifestIntegrity,
  summarizeManifestRepairIssues,
} from "./projectIntegrity";

function makeManifest(overrides: Partial<ProjectManifestV1> = {}): ProjectManifestV1 {
  return {
    schema: "project.v1",
    name: "Test",
    created: "2026-03-09T00:00:00.000Z",
    videos: [{ id: "vid-1", label: "Video 1", file: "media/video.mp4" }],
    marks: [],
    stills: [],
    annotations: [],
    reports: [],
    thumbnails: [],
    ...overrides,
  };
}

describe("findMarkAtTimestamp / hasDuplicateMarkTimestamp", () => {
  const marks: ProjectManifestV1["marks"] = [
    { id: "mark-a", videoId: "vid-1", t_ms: 1000 },
    { id: "mark-b", videoId: "vid-1", t_ms: 2000 },
    { id: "mark-c", videoId: "vid-2", t_ms: 1000 },
  ];

  it("finds an exact timestamp match within the same video", () => {
    expect(findMarkAtTimestamp(marks, "vid-1", 1000)?.id).toBe("mark-a");
    expect(findMarkAtTimestamp(marks, "vid-2", 1000)?.id).toBe("mark-c");
  });

  it("respects the excluded mark id", () => {
    expect(findMarkAtTimestamp(marks, "vid-1", 1000, "mark-a")).toBeNull();
  });

  it("reports duplicate presence through the same exact-match rule", () => {
    expect(hasDuplicateMarkTimestamp(marks, "vid-1", 1000)).toBe(true);
    expect(hasDuplicateMarkTimestamp(marks, "vid-1", 1500)).toBe(false);
  });
});

describe("repairManifestIntegrity", () => {
  it("backfills sourceMarkId from an exact videoId/timestamp match", () => {
    const manifest = makeManifest({
      marks: [{ id: "mark-a", videoId: "vid-1", t_ms: 1000 }],
      stills: [{ id: "still-a", videoId: "vid-1", t_ms: 1000, file: "stills/000001.png" }],
    });

    const repaired = repairManifestIntegrity(manifest);

    expect(repaired.changed).toBe(true);
    expect(repaired.issues).toHaveLength(0);
    expect(repaired.manifest.stills[0].sourceMarkId).toBe("mark-a");
  });

  it("preserves an already valid linked source mark", () => {
    const manifest = makeManifest({
      marks: [{ id: "mark-a", videoId: "vid-1", t_ms: 1000 }],
      stills: [{ id: "still-a", videoId: "vid-1", t_ms: 1000, file: "stills/000001.png", sourceMarkId: "mark-a" }],
    });

    const repaired = repairManifestIntegrity(manifest);

    expect(repaired.changed).toBe(false);
    expect(repaired.issues).toHaveLength(0);
    expect(repaired.manifest).toBe(manifest);
  });

  it("creates a canonical backfilled mark when a legacy still has no exact mark match", () => {
    const manifest = makeManifest({
      marks: [{ id: "mark-a", videoId: "vid-1", t_ms: 1500 }],
      stills: [{ id: "still-a", videoId: "vid-1", t_ms: 1000, file: "stills/000001.png" }],
    });

    const repaired = repairManifestIntegrity(manifest);

    expect(repaired.changed).toBe(true);
    expect(repaired.issues).toEqual([]);
    expect(repaired.manifest.marks).toHaveLength(2);
    expect(repaired.manifest.marks[1]).toEqual({
      id: "mark_backfill_still-a",
      videoId: "vid-1",
      t_ms: 1000,
    });
    expect(repaired.manifest.stills[0].sourceMarkId).toBe("mark_backfill_still-a");
  });

  it("flags duplicate marks at the same timestamp and does not backfill an ambiguous still", () => {
    const manifest = makeManifest({
      marks: [
        { id: "mark-a", videoId: "vid-1", t_ms: 1000 },
        { id: "mark-b", videoId: "vid-1", t_ms: 1000 },
      ],
      stills: [{ id: "still-a", videoId: "vid-1", t_ms: 1000, file: "stills/000001.png" }],
    });

    const repaired = repairManifestIntegrity(manifest);

    expect(repaired.issues).toHaveLength(2);
    expect(repaired.issues[0]).toEqual({
      kind: "duplicate_mark_timestamp",
      videoId: "vid-1",
      t_ms: 1000,
      markIds: ["mark-a", "mark-b"],
    });
    expect(repaired.issues[1]).toEqual({
      kind: "unresolved_still_source_mark",
      stillId: "still-a",
      videoId: "vid-1",
      t_ms: 1000,
      sourceMarkId: null,
    });
    expect(repaired.manifest.stills[0].sourceMarkId).toBeNull();
  });

  it("replaces an invalid cross-video sourceMarkId with a canonical backfilled mark when needed", () => {
    const manifest = makeManifest({
      videos: [
        { id: "vid-1", label: "Video 1", file: "media/v1.mp4" },
        { id: "vid-2", label: "Video 2", file: "media/v2.mp4" },
      ],
      marks: [{ id: "mark-a", videoId: "vid-2", t_ms: 1000 }],
      stills: [{ id: "still-a", videoId: "vid-1", t_ms: 1000, file: "stills/000001.png", sourceMarkId: "mark-a" }],
    });

    const repaired = repairManifestIntegrity(manifest);

    expect(repaired.issues).toHaveLength(0);
    expect(repaired.manifest.marks).toHaveLength(2);
    expect(repaired.manifest.stills[0].sourceMarkId).toBe("mark_backfill_still-a");
  });
});

describe("canonical still helpers", () => {
  it("finds all linked stills for a mark", () => {
    const stills: ProjectManifestV1["stills"] = [
      { id: "still-a", videoId: "vid-1", t_ms: 1000, file: "stills/1.png", sourceMarkId: "mark-a" },
      { id: "still-b", videoId: "vid-1", t_ms: 1100, file: "stills/2.png", sourceMarkId: "mark-a" },
      { id: "still-c", videoId: "vid-1", t_ms: 1200, file: "stills/3.png", sourceMarkId: "mark-b" },
    ];

    expect(findLinkedStillsForMark(stills, "mark-a").map((still) => still.id)).toEqual(["still-a", "still-b"]);
  });

  it("prefers an exact timestamp match as the canonical still", () => {
    const manifest = makeManifest({
      marks: [{ id: "mark-a", videoId: "vid-1", t_ms: 1000 }],
      stills: [
        { id: "still-a", videoId: "vid-1", t_ms: 1010, file: "stills/1.png", sourceMarkId: "mark-a" },
        { id: "still-b", videoId: "vid-1", t_ms: 1000, file: "stills/2.png", sourceMarkId: "mark-a" },
      ],
    });

    expect(findCanonicalStillForMark(manifest, "mark-a")?.id).toBe("still-b");
  });
});

describe("summarizeManifestRepairIssues", () => {
  it("summarizes the first few issues", () => {
    const summary = summarizeManifestRepairIssues([
      { kind: "duplicate_mark_timestamp", videoId: "vid-1", t_ms: 1000, markIds: ["mark-a", "mark-b"] },
      { kind: "unresolved_still_source_mark", stillId: "still-a", videoId: "vid-1", t_ms: 2000, sourceMarkId: null },
    ]);

    expect(summary).toContain("Duplicate marks at vid-1 1000ms");
    expect(summary).toContain("Still still-a at vid-1 2000ms could not be linked to a mark");
  });
});
