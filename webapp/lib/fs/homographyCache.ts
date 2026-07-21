// ---------------------------------------------------------------------------
// Homography cache — per-project cache of homography matrices.
//
// Stored as JSON files in `homography-cache/{videoId}/range-{startMs}-{endMs}.json`.
// Each file contains: { startMs, endMs, frames: HomographyFrame[] }
// ---------------------------------------------------------------------------

export interface HomographyFrame {
  tMs: number;
  matrix: number[];  // 9 floats, row-major 3×3
  method: string;    // 'pnlcalib' | 'interpolated_gap' | 'held_short_gap' | 'failed'
}

interface CacheFile {
  startMs: number;
  endMs: number;
  frames: HomographyFrame[];
}

const CACHE_DIR = 'homography-cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureCacheDir(
  projectDir: FileSystemDirectoryHandle,
  videoId: string,
): Promise<FileSystemDirectoryHandle> {
  const root = await projectDir.getDirectoryHandle(CACHE_DIR, { create: true });
  return root.getDirectoryHandle(videoId, { create: true });
}

function cacheFileName(startMs: number, endMs: number): string {
  return `range-${Math.round(startMs)}-${Math.round(endMs)}.json`;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function writeHomographyCache(
  projectDir: FileSystemDirectoryHandle,
  videoId: string,
  startMs: number,
  endMs: number,
  frames: HomographyFrame[],
): Promise<void> {
  const dir = await ensureCacheDir(projectDir, videoId);
  const name = cacheFileName(startMs, endMs);
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await (fh as any).createWritable();
  const data: CacheFile = { startMs, endMs, frames };
  await writable.write(JSON.stringify(data));
  await writable.close();
}

// ---------------------------------------------------------------------------
// Read (exact range match)
// ---------------------------------------------------------------------------

export async function readHomographyCache(
  projectDir: FileSystemDirectoryHandle,
  videoId: string,
  startMs: number,
  endMs: number,
): Promise<HomographyFrame[] | null> {
  try {
    const root = await projectDir.getDirectoryHandle(CACHE_DIR, { create: false });
    const dir = await root.getDirectoryHandle(videoId, { create: false });
    const name = cacheFileName(startMs, endMs);
    const fh = await dir.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    const text = await file.text();
    const data: CacheFile = JSON.parse(text);
    return data.frames;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Find overlapping cache (any cached range that fully contains requested range)
// ---------------------------------------------------------------------------

export async function findOverlappingCache(
  projectDir: FileSystemDirectoryHandle,
  videoId: string,
  startMs: number,
  endMs: number,
): Promise<HomographyFrame[] | null> {
  try {
    const root = await projectDir.getDirectoryHandle(CACHE_DIR, { create: false });
    const dir = await root.getDirectoryHandle(videoId, { create: false });

    // Iterate cache files
    for await (const [name, handle] of (dir as any).entries()) {
      if (!name.endsWith('.json') || !(handle as any).getFile) continue;

      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const text = await file.text();
        const data: CacheFile = JSON.parse(text);

        // Check if this cached range fully contains the requested range
        if (data.startMs <= startMs && data.endMs >= endMs) {
          // Extract the subset of frames within the requested range
          const subset = data.frames.filter(f => f.tMs >= startMs && f.tMs <= endMs);
          if (subset.length > 0) {
            return subset;
          }
        }
      } catch {
        // Skip invalid files
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function deleteOverlappingHomographyCache(
  projectDir: FileSystemDirectoryHandle,
  videoId: string,
  startMs: number,
  endMs: number,
): Promise<number> {
  try {
    const root = await projectDir.getDirectoryHandle(CACHE_DIR, { create: false });
    const dir = await root.getDirectoryHandle(videoId, { create: false });
    const names: string[] = [];

    for await (const [name, handle] of (dir as any).entries()) {
      if (!name.endsWith('.json') || !(handle as any).getFile) continue;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const data: CacheFile = JSON.parse(await file.text());
        if (data.startMs <= endMs && data.endMs >= startMs) names.push(name);
      } catch {
        // Invalid entries are left for the integrity checker rather than deleted implicitly.
      }
    }

    for (const name of names) await dir.removeEntry(name);
    return names.length;
  } catch {
    return 0;
  }
}
