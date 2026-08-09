import {
  isSafeClipIdSegment,
  parseClip,
  type Clip,
} from '../types/clip';
import {
  getDirectoryPath,
  isNotFoundError,
  readTextFile,
  writeJsonFile,
} from './fsAccess';
import { broadcastClipChanged } from './clipEvents';

export type StorageReadErrorCode = 'not-found' | 'invalid-json' | 'invalid-document' | 'io-error';

export interface StorageReadError {
  code: StorageReadErrorCode;
  message: string;
}
export type ClipReadResult =
  | { ok: true; clip: Clip }
  | { ok: false; clipId: string; error: StorageReadError };

export interface ClipListResult {
  clips: Clip[];
  errors: { clipId: string; error: StorageReadError }[];
}

export const CLIPS_PATH = ['analysis', 'clips'] as const;

export function clipFolderPath(clipId: string): string[] {
  if (!isSafeClipIdSegment(clipId)) throw new Error(`Unsafe clip id: ${JSON.stringify(clipId)}`);
  return [...CLIPS_PATH, clipId];
}

export function clipDocumentPath(clipId: string): string[] {
  return [...clipFolderPath(clipId), 'clip.json'];
}

function failure(clipId: string, code: StorageReadErrorCode, message: string): ClipReadResult {
  return { ok: false, clipId, error: { code, message } };
}

export async function readClip(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
): Promise<ClipReadResult> {
  let source: string;
  try {
    source = await readTextFile(projectDir, clipDocumentPath(clipId));
  } catch (error) {
    if (isNotFoundError(error)) return failure(clipId, 'not-found', `Clip "${clipId}" was not found.`);
    return failure(clipId, 'io-error', error instanceof Error ? error.message : String(error));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return failure(
      clipId,
      'invalid-json',
      `Clip "${clipId}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return { ok: true, clip: parseClip(raw, { folderId: clipId }) };
  } catch (error) {
    return failure(clipId, 'invalid-document', error instanceof Error ? error.message : String(error));
  }
}

export async function writeClip(
  projectDir: FileSystemDirectoryHandle,
  clip: Clip,
): Promise<void> {
  const parsed = parseClip(clip, { folderId: clip.id });
  await getDirectoryPath(projectDir, clipFolderPath(parsed.id), true);
  await writeJsonFile(projectDir, clipDocumentPath(parsed.id), parsed);
  broadcastClipChanged(parsed.id);
}

export async function listClips(
  projectDir: FileSystemDirectoryHandle,
): Promise<ClipListResult> {
  let clipsDirectory: FileSystemDirectoryHandle;
  try {
    clipsDirectory = await getDirectoryPath(projectDir, CLIPS_PATH, false);
  } catch (error) {
    return {
      clips: [],
      errors: [{
        clipId: '*',
        error: {
          code: isNotFoundError(error) ? 'not-found' : 'io-error',
          message: isNotFoundError(error)
            ? 'Missing analysis/clips directory.'
            : error instanceof Error ? error.message : String(error),
        },
      }],
    };
  }

  const clips: Clip[] = [];
  const errors: ClipListResult['errors'] = [];
  for await (const [name, handle] of clipsDirectory.entries()) {
    if (handle.kind !== 'directory') continue;
    if (!isSafeClipIdSegment(name)) {
      errors.push({
        clipId: name,
        error: { code: 'invalid-document', message: `Unsafe clip folder id: ${JSON.stringify(name)}` },
      });
      continue;
    }
    const result = await readClip(projectDir, name);
    if (result.ok) clips.push(result.clip);
    else errors.push({ clipId: result.clipId, error: result.error });
  }
  clips.sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id));
  return { clips, errors };
}
