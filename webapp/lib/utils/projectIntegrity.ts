import type { ProjectManifestV1 } from "../types/project";

type ProjectMark = ProjectManifestV1["marks"][number];
type ProjectStill = ProjectManifestV1["stills"][number];

export type ManifestRepairIssue =
  | {
      kind: "duplicate_mark_timestamp";
      videoId: string;
      t_ms: number;
      markIds: string[];
    }
  | {
      kind: "unresolved_still_source_mark";
      stillId: string;
      videoId: string;
      t_ms: number;
      sourceMarkId: string | null;
    };

export type ManifestRepairResult = {
  manifest: ProjectManifestV1;
  changed: boolean;
  issues: ManifestRepairIssue[];
};

function keyFor(videoId: string, t_ms: number) {
  return `${videoId}::${t_ms}`;
}

function normalizeSourceMarkId(sourceMarkId: unknown): string | null {
  return typeof sourceMarkId === "string" && sourceMarkId.trim().length > 0 ? sourceMarkId : null;
}

function createBackfilledMarkId(stillId: string, markById: Map<string, ProjectMark>): string {
  const baseId = `mark_backfill_${stillId}`;
  if (!markById.has(baseId)) {
    return baseId;
  }
  let suffix = 2;
  let nextId = `${baseId}_${suffix}`;
  while (markById.has(nextId)) {
    suffix += 1;
    nextId = `${baseId}_${suffix}`;
  }
  return nextId;
}

export function findMarkAtTimestamp(
  marks: ProjectManifestV1["marks"],
  videoId: string,
  t_ms: number,
  excludeMarkId?: string | null,
): ProjectMark | null {
  for (const mark of marks) {
    if (mark.videoId !== videoId) continue;
    if (mark.t_ms !== t_ms) continue;
    if (excludeMarkId && mark.id === excludeMarkId) continue;
    return mark;
  }
  return null;
}

export function hasDuplicateMarkTimestamp(
  marks: ProjectManifestV1["marks"],
  videoId: string,
  t_ms: number,
  excludeMarkId?: string | null,
): boolean {
  return findMarkAtTimestamp(marks, videoId, t_ms, excludeMarkId) !== null;
}

export function findLinkedStillsForMark(
  stills: ProjectManifestV1["stills"],
  markId: string,
): ProjectStill[] {
  return stills.filter((still) => normalizeSourceMarkId(still.sourceMarkId) === markId);
}

export function findCanonicalStillForMark(
  manifest: ProjectManifestV1,
  markId: string,
): ProjectStill | null {
  const mark = manifest.marks.find((entry) => entry.id === markId);
  if (!mark) return null;
  const linked = findLinkedStillsForMark(manifest.stills, markId);
  if (linked.length === 0) return null;
  return [...linked].sort((a, b) => {
    const aExact = a.t_ms === mark.t_ms ? 0 : 1;
    const bExact = b.t_ms === mark.t_ms ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aDist = Math.abs(a.t_ms - mark.t_ms);
    const bDist = Math.abs(b.t_ms - mark.t_ms);
    if (aDist !== bDist) return aDist - bDist;
    if (a.t_ms !== b.t_ms) return a.t_ms - b.t_ms;
    return a.id.localeCompare(b.id);
  })[0];
}

export function repairManifestIntegrity(manifest: ProjectManifestV1): ManifestRepairResult {
  const issues: ManifestRepairIssue[] = [];
  const markIdsByTimestamp = new Map<string, string[]>();
  const markById = new Map<string, ProjectMark>();
  const nextMarks = [...manifest.marks];

  for (const mark of manifest.marks) {
    markById.set(mark.id, mark);
    const key = keyFor(mark.videoId, mark.t_ms);
    const ids = markIdsByTimestamp.get(key);
    if (ids) {
      ids.push(mark.id);
    } else {
      markIdsByTimestamp.set(key, [mark.id]);
    }
  }

  const uniqueMarkByTimestamp = new Map<string, ProjectMark>();
  for (const mark of manifest.marks) {
    const key = keyFor(mark.videoId, mark.t_ms);
    const ids = markIdsByTimestamp.get(key) ?? [];
    if (ids.length === 1) {
      uniqueMarkByTimestamp.set(key, mark);
    }
  }

  for (const [key, markIds] of markIdsByTimestamp.entries()) {
    if (markIds.length < 2) continue;
    const [videoId, tMsRaw] = key.split("::");
    issues.push({
      kind: "duplicate_mark_timestamp",
      videoId,
      t_ms: Number(tMsRaw),
      markIds: [...markIds],
    });
  }

  let changed = false;
  const nextStills = manifest.stills.map((still) => {
    const normalizedSourceMarkId = normalizeSourceMarkId(still.sourceMarkId);
    const currentSourceMark = normalizedSourceMarkId ? markById.get(normalizedSourceMarkId) ?? null : null;
    const sourceMarkValid = !!currentSourceMark && currentSourceMark.videoId === still.videoId;

    if (sourceMarkValid && normalizedSourceMarkId === still.sourceMarkId) {
      return still;
    }

    const exactKey = keyFor(still.videoId, still.t_ms);
    const exactMarkIds = markIdsByTimestamp.get(exactKey) ?? [];
    const exactMark = uniqueMarkByTimestamp.get(exactKey) ?? null;
    let repairedSourceMarkId = sourceMarkValid
      ? normalizedSourceMarkId
      : exactMark?.id ?? null;

    if (!repairedSourceMarkId && exactMarkIds.length === 0) {
      const backfilledMark: ProjectMark = {
        id: createBackfilledMarkId(still.id, markById),
        videoId: still.videoId,
        t_ms: still.t_ms,
      };
      nextMarks.push(backfilledMark);
      markById.set(backfilledMark.id, backfilledMark);
      markIdsByTimestamp.set(exactKey, [backfilledMark.id]);
      uniqueMarkByTimestamp.set(exactKey, backfilledMark);
      repairedSourceMarkId = backfilledMark.id;
      changed = true;
    }

    const sameAsStored = repairedSourceMarkId === normalizeSourceMarkId(still.sourceMarkId)
      && (repairedSourceMarkId !== null || still.sourceMarkId === null);

    if (!sameAsStored || !("sourceMarkId" in still)) {
      changed = true;
    }

    if (!repairedSourceMarkId) {
      issues.push({
        kind: "unresolved_still_source_mark",
        stillId: still.id,
        videoId: still.videoId,
        t_ms: still.t_ms,
        sourceMarkId: normalizedSourceMarkId,
      });
    }

    return {
      ...still,
      sourceMarkId: repairedSourceMarkId,
    };
  });

  if (!changed) {
    return { manifest, changed: false, issues };
  }

  return {
    manifest: {
      ...manifest,
      marks: nextMarks,
      stills: nextStills,
    },
    changed: true,
    issues,
  };
}

export function summarizeManifestRepairIssues(issues: ManifestRepairIssue[], maxItems = 3): string {
  if (issues.length === 0) return "";
  const lines = issues.slice(0, Math.max(1, maxItems)).map((issue) => {
    if (issue.kind === "duplicate_mark_timestamp") {
      return `Duplicate marks at ${issue.videoId} ${issue.t_ms}ms: ${issue.markIds.join(", ")}`;
    }
    return `Still ${issue.stillId} at ${issue.videoId} ${issue.t_ms}ms could not be linked to a mark`;
  });
  if (issues.length > lines.length) {
    lines.push(`+${issues.length - lines.length} more issue(s)`);
  }
  return lines.join("; ");
}
