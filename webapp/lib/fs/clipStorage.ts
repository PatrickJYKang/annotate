// ---------------------------------------------------------------------------
// Clip storage — read/write/list/delete clip JSON files in clips/ directory
// Uses the File System Access API (same pattern as projectFolder.ts)
// ---------------------------------------------------------------------------

import type { Clip, ClipAnnotation, ClipKeyframe } from '../types/clip';
import { CLIP_SCHEMA_VERSION } from '../types/clip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOrCreateDir(parent: FileSystemDirectoryHandle, name: string) {
  return await parent.getDirectoryHandle(name, { create: true });
}

function clipFileName(clipId: string): string {
  return `clip-${clipId}.json`;
}

function clipIdFromFileName(name: string): string | null {
  const match = name.match(/^clip-(.+)\.json$/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

export function migrateClipSchema(raw: unknown): Clip {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid clip data: not an object');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schema !== 'number') {
    throw new Error('Invalid clip data: missing or invalid schema version');
  }

  if (obj.schema > CLIP_SCHEMA_VERSION) {
    throw new Error(
      `Clip schema version ${obj.schema} is newer than supported version ${CLIP_SCHEMA_VERSION}. ` +
      `Please update the application.`
    );
  }

  // Version 1 — current, validate required fields
  if (obj.schema === 1) {
    if (typeof obj.id !== 'string' || !obj.id) {
      throw new Error('Invalid clip data: missing id');
    }
    if (typeof obj.videoId !== 'string' || !obj.videoId) {
      throw new Error('Invalid clip data: missing videoId');
    }
    if (typeof obj.startMs !== 'number' || typeof obj.endMs !== 'number') {
      throw new Error('Invalid clip data: missing startMs or endMs');
    }
    if (obj.startMs >= obj.endMs) {
      throw new Error('Invalid clip data: startMs must be less than endMs');
    }
    if (!Array.isArray(obj.annotations)) {
      throw new Error('Invalid clip data: annotations must be an array');
    }
    return obj as unknown as Clip;
  }

  // Future: handle migrations from older versions here
  // e.g. if (obj.schema === 0) { ... migrate to 1 ... }

  throw new Error(`Unknown clip schema version: ${obj.schema}`);
}

// ---------------------------------------------------------------------------
// Mark pinning resolution
// ---------------------------------------------------------------------------

export function resolveMarkPinning(
  clip: Clip,
  marks: { id: string; t_ms: number }[]
): Clip {
  const result = { ...clip };

  if (result.startMarkId) {
    const mark = marks.find(m => m.id === result.startMarkId);
    if (mark) {
      result.startMs = mark.t_ms;
    } else {
      result.startMarkId = null;
    }
  }

  if (result.endMarkId) {
    const mark = marks.find(m => m.id === result.endMarkId);
    if (mark) {
      result.endMs = mark.t_ms;
    } else {
      result.endMarkId = null;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export async function readClip(
  projectDir: FileSystemDirectoryHandle,
  clipId: string
): Promise<Clip | null> {
  let clipsDir: FileSystemDirectoryHandle;
  try {
    clipsDir = await projectDir.getDirectoryHandle('clips', { create: false });
  } catch {
    return null;
  }

  let fh: FileSystemFileHandle;
  try {
    fh = await clipsDir.getFileHandle(clipFileName(clipId), { create: false });
  } catch {
    return null;
  }

  const file = await fh.getFile();
  const text = await file.text();

  try {
    const raw = JSON.parse(text);
    return migrateClipSchema(raw);
  } catch {
    return null;
  }
}

export async function writeClip(
  projectDir: FileSystemDirectoryHandle,
  clip: Clip
): Promise<void> {
  const clipsDir = await getOrCreateDir(projectDir, 'clips');
  const fh = await clipsDir.getFileHandle(clipFileName(clip.id), { create: true });
  const ws = await fh.createWritable();
  await ws.write(JSON.stringify(clip, null, 2));
  await ws.close();
}

export async function deleteClip(
  projectDir: FileSystemDirectoryHandle,
  clipId: string
): Promise<void> {
  let clipsDir: FileSystemDirectoryHandle;
  try {
    clipsDir = await projectDir.getDirectoryHandle('clips', { create: false });
  } catch {
    return; // clips dir doesn't exist, nothing to delete
  }

  try {
    await clipsDir.removeEntry(clipFileName(clipId));
  } catch {
    // file doesn't exist, that's fine
  }
}

export async function listClips(
  projectDir: FileSystemDirectoryHandle
): Promise<Clip[]> {
  let clipsDir: FileSystemDirectoryHandle;
  try {
    clipsDir = await projectDir.getDirectoryHandle('clips', { create: false });
  } catch {
    return [];
  }

  const clips: Clip[] = [];

  for await (const [name, handle] of clipsDir.entries()) {
    if ((handle as any).kind !== 'file') continue;
    if (!name.endsWith('.json')) continue;
    if (!clipIdFromFileName(name)) continue;

    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      const text = await file.text();
      const raw = JSON.parse(text);
      const clip = migrateClipSchema(raw);
      clips.push(clip);
    } catch {
      // skip invalid files
      console.warn(`Skipping invalid clip file: ${name}`);
    }
  }

  clips.sort((a, b) => a.startMs - b.startMs);
  return clips;
}
