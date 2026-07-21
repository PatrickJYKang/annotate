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

export function clipLockName(clipId: string): string {
  return `annotate:clip:${clipId}`;
}

export async function withClipExclusive<T>(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  operation: () => Promise<T>,
  options: ClipExclusiveOptions = {},
): Promise<T> {
  return getLockManager().request(clipLockName(clipId), { mode: 'exclusive' }, async () => {
    if (!options.allowTombstone && await hasClipTombstone(projectDir, clipId)) {
      throw new ClipRepositoryError('deleted', `Clip "${clipId}" has been deleted and cannot be modified.`);
    }
    return operation();
  });
}

async function requireLatestClip(
  projectDir: FileSystemDirectoryHandle,
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
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  mutator: (latest: Clip) => Clip | Promise<Clip>,
): Promise<Clip> {
  return withClipExclusive(projectDir, clipId, async () => {
    const latest = await requireLatestClip(projectDir, clipId);
    const next = await mutator(structuredClone(latest));
    if (next.id !== clipId || next.id !== latest.id) {
      throw new ClipRepositoryError('identity-change', 'A clip mutation cannot change the clip id.');
    }
    const parsed = parseClip(next, { folderId: clipId });
    await writeClip(projectDir, parsed);
    return parsed;
  });
}

export async function replaceClipAnnotationsExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  annotations: ClipAnnotation[],
): Promise<Clip> {
  return mutateClipExclusive(projectDir, clipId, (latest) => ({
    ...latest,
    annotations: structuredClone(annotations),
  }));
}

export async function replaceClipPinsExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  pins: ClipPin[],
): Promise<Clip> {
  return mutateClipExclusive(projectDir, clipId, (latest) => ({
    ...latest,
    pins: structuredClone(pins),
  }));
}

export async function replaceClipTagsExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  tags: TaggingSelection,
): Promise<Clip> {
  return mutateClipExclusive(projectDir, clipId, (latest) => ({
    ...latest,
    tags: structuredClone(tags),
  }));
}

export async function createClipExclusive(
  projectDir: FileSystemDirectoryHandle,
  clip: Clip,
): Promise<Clip> {
  const parsed = parseClip(clip, { folderId: clip.id });
  return withClipExclusive(projectDir, parsed.id, async () => {
    const existing = await readClip(projectDir, parsed.id);
    if (existing.ok || existing.error.code !== 'not-found') {
      throw new ClipRepositoryError(
        existing.ok ? 'already-exists' : 'invalid-document',
        existing.ok ? `Clip "${parsed.id}" already exists.` : existing.error.message,
      );
    }
    await writeClip(projectDir, parsed);
    return parsed;
  });
}

export async function deleteClipExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  options: DeleteClipToTrashOptions = {},
): Promise<TrashOperationRecord> {
  return withClipExclusive(projectDir, clipId, async () => {
    await requireLatestClip(projectDir, clipId);
    return deleteClipToTrash(projectDir, clipId, options);
  });
}

export async function restoreClipExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  operationId?: string,
): Promise<Clip> {
  return withClipExclusive(projectDir, clipId, async () => {
    await restoreClipFromTrash(projectDir, clipId, operationId);
    return requireLatestClip(projectDir, clipId);
  }, { allowTombstone: true });
}
