import type { ProjectDirectory } from "../host/contracts";
import { projectResourceKey } from '../host/projectScope';
import { broadcastClipChanged } from './clipEvents';
import { requireProjectVideo, withProjectManifestExclusive } from './projectManifestRepository';
import type { TaggingSelection } from '../tagging/selection';
import type {
  ClipAnnotation,
  ClipPin,
  Clip,
} from '../types/clip';
import { parseClip } from '../types/clip';
import {
  readClip,
  writeClip,
} from './clipStorage';
import {
  deleteClipToTrash,
  hasClipTombstone,
  restoreClipFromTrash,
  type DeleteClipToTrashOptions,
  type TrashOperationRecord,
} from './trash';

export interface ClipExclusiveOptions {
  allowTombstone?: boolean;
}
export class ClipRepositoryError extends Error {
  readonly code:
    | 'locks-unsupported'
    | 'deleted'
    | 'not-found'
    | 'invalid-document'
    | 'already-exists'
    | 'identity-change';

  constructor(code: ClipRepositoryError['code'], message: string) {
    super(message);
    this.name = 'ClipRepositoryError';
    this.code = code;
  }
}

function getLockManager(): LockManager {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    throw new ClipRepositoryError(
      'locks-unsupported',
      'Annotate 0.2 requires Web Locks support to edit clip data safely.',
    );
  }
  return locks;
}

export function clipLockName(projectDir: ProjectDirectory, clipId: string): string {
  return projectResourceKey(projectDir, `clip:${clipId}`);
}

export async function withClipExclusive<T>(
  projectDir: ProjectDirectory,
  clipId: string,
  operation: () => Promise<T>,
  options: ClipExclusiveOptions = {},
): Promise<T> {
  if (projectDir.withLock) return projectDir.withLock(clipLockName(projectDir, clipId), 'exclusive', async () => {
    if (!options.allowTombstone && await hasClipTombstone(projectDir, clipId)) throw new ClipRepositoryError('deleted', `Clip "${clipId}" has been deleted.`);
    return operation();
  });
  return getLockManager().request(clipLockName(projectDir, clipId), { mode: 'exclusive' }, async () => {
    if (!options.allowTombstone && await hasClipTombstone(projectDir, clipId)) {
      throw new ClipRepositoryError('deleted', `Clip "${clipId}" has been deleted and cannot be modified.`);
    }
    return operation();
  });
}

async function requireLatestClip(
  projectDir: ProjectDirectory,
  clipId: string,
): Promise<Clip> {
  const result = await readClip(projectDir, clipId);
  if (result.ok) return result.clip;
  if (result.error.code === 'not-found') {
    throw new ClipRepositoryError('not-found', result.error.message);
  }
  throw new ClipRepositoryError('invalid-document', result.error.message);
}

export async function mutateClipExclusive(
  projectDir: ProjectDirectory,
  clipId: string,
  mutator: (latest: Clip) => Clip | Promise<Clip>,
): Promise<Clip> {
  if (projectDir.command) {
    const base = await requireLatestClip(projectDir, clipId);
    const next = parseClip(await mutator(structuredClone(base)), { folderId: clipId });
    return projectDir.command('clip.patch', [clipId, base, next]);
  }
  return withClipExclusive(projectDir, clipId, async () => {
    const latest = await requireLatestClip(projectDir, clipId);
    const next = await mutator(structuredClone(latest));
    if (next.id !== clipId || next.id !== latest.id || next.videoId !== latest.videoId) {
      throw new ClipRepositoryError('identity-change', 'A clip mutation cannot change the clip or video id.');
    }
    const parsed = parseClip(next, { folderId: clipId });
    await writeClip(projectDir, parsed);
    return parsed;
  });
}

export async function replaceClipAnnotationsExclusive(
  projectDir: ProjectDirectory,
  clipId: string,
  annotations: ClipAnnotation[],
): Promise<Clip> {
  return mutateClipExclusive(projectDir, clipId, (latest) => ({
    ...latest,
    annotations: structuredClone(annotations),
  }));
}

export async function replaceClipPinsExclusive(
  projectDir: ProjectDirectory,
  clipId: string,
  pins: ClipPin[],
): Promise<Clip> {
  return mutateClipExclusive(projectDir, clipId, (latest) => ({
    ...latest,
    pins: structuredClone(pins),
  }));
}

export async function replaceClipTagsExclusive(
  projectDir: ProjectDirectory,
  clipId: string,
  tags: TaggingSelection,
): Promise<Clip> {
  return mutateClipExclusive(projectDir, clipId, (latest) => ({
    ...latest,
    tags: structuredClone(tags),
  }));
}

export async function createClipExclusive(
  projectDir: ProjectDirectory,
  clip: Clip,
): Promise<Clip> {
  if (projectDir.command) return projectDir.command('clip.create', [clip]);
  const parsed = parseClip(clip, { folderId: clip.id });
  // Manifest before clip: creation must not race a cascading video deletion.
  return withProjectManifestExclusive(projectDir, () => withClipExclusive(projectDir, parsed.id, async () => {
    await requireProjectVideo(projectDir, parsed.videoId);
    const existing = await readClip(projectDir, parsed.id);
    if (existing.ok || existing.error.code !== 'not-found') {
      throw new ClipRepositoryError(
        existing.ok ? 'already-exists' : 'invalid-document',
        existing.ok ? `Clip "${parsed.id}" already exists.` : existing.error.message,
      );
    }
    await writeClip(projectDir, parsed);
    return parsed;
  }));
}

export async function deleteClipExclusive(
  projectDir: ProjectDirectory,
  clipId: string,
  options: DeleteClipToTrashOptions = {},
): Promise<TrashOperationRecord> {
  if (projectDir.command) return projectDir.command('clip.delete', [clipId, options]);
  return withClipExclusive(projectDir, clipId, async () => {
    await requireLatestClip(projectDir, clipId);
    const deleted = await deleteClipToTrash(projectDir, clipId, options);
    broadcastClipChanged(projectDir, clipId);
    return deleted;
  });
}

export async function restoreClipExclusive(
  projectDir: ProjectDirectory,
  clipId: string,
  operationId?: string,
): Promise<Clip> {
  if (projectDir.command) return projectDir.command('clip.restore', [clipId, operationId]);
  return withProjectManifestExclusive(projectDir, () => withClipExclusive(projectDir, clipId, async () => {
    await restoreClipFromTrash(projectDir, clipId, operationId);
    broadcastClipChanged(projectDir, clipId);
    return requireLatestClip(projectDir, clipId);
  }, { allowTombstone: true }));
}
