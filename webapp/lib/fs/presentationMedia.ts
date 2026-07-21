import { frameBoundary, videoFrame, type FrameBoundary, type VideoFrame } from '../clip/frameMath';
import { isSafeClipIdSegment } from '../types/clip';
import { getFilePath, isNotFoundError, readTextFile, writeJsonFile } from './fsAccess';

export type PreparedPresentationAssetKind = 'clip_slide' | 'transition';

export interface PreparedPresentationAsset {
  key: string;
  kind: PreparedPresentationAssetKind;
  ownerId: string;
  videoId: string;
  sourceStartFrame: VideoFrame;
  sourceEndFrame: FrameBoundary;
  file: string;
  createdAt: string;
}

export interface PresentationMediaIndex {
  schema: 'presentation-media.v2';
  assets: PreparedPresentationAsset[];
}

const emptyIndex = (): PresentationMediaIndex => ({ schema: 'presentation-media.v2', assets: [] });

function presentationMediaRoot(presentationId: string): string[] {
  if (!isSafeClipIdSegment(presentationId)) throw new Error(`Unsafe presentation id: ${presentationId}`);
  return ['derived-media', 'presentations', presentationId];
}

function indexPath(presentationId: string): string[] {
  return [...presentationMediaRoot(presentationId), 'assets-v2.json'];
}

function parseEntry(raw: unknown): PreparedPresentationAsset {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Prepared asset must be an object.');
  const entry = raw as Record<string, unknown>;
  if (entry.kind !== 'clip_slide' && entry.kind !== 'transition') throw new Error('Prepared asset kind is invalid.');
  for (const field of ['key', 'ownerId', 'videoId', 'file', 'createdAt'] as const) {
    if (typeof entry[field] !== 'string' || !entry[field]) throw new Error(`Prepared asset ${field} is required.`);
  }
  if (!isSafeClipIdSegment(entry.ownerId as string) || !isSafeClipIdSegment(entry.videoId as string)) {
    throw new Error('Prepared asset owner and video ids must be safe identifiers.');
  }
  if (
    !Number.isInteger(entry.sourceStartFrame)
    || !Number.isInteger(entry.sourceEndFrame)
    || Number(entry.sourceStartFrame) < 0
    || Number(entry.sourceEndFrame) <= Number(entry.sourceStartFrame)
  ) {
    throw new Error('Prepared asset source range is invalid.');
  }
  const expectedFile = `motion-v2/${entry.key}.mp4`;
  if (entry.file !== expectedFile || !isSafeClipIdSegment(entry.key as string)) {
    throw new Error(`Prepared asset file must be ${expectedFile}.`);
  }
  if (!Number.isFinite(Date.parse(entry.createdAt as string))) throw new Error('Prepared asset createdAt is invalid.');
  return {
    key: entry.key as string,
    kind: entry.kind,
    ownerId: entry.ownerId as string,
    videoId: entry.videoId as string,
    sourceStartFrame: videoFrame(entry.sourceStartFrame as number),
    sourceEndFrame: frameBoundary(entry.sourceEndFrame as number),
    file: entry.file as string,
    createdAt: entry.createdAt as string,
  };
}

export function parsePresentationMediaIndex(raw: unknown): PresentationMediaIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Presentation media index must be an object.');
  const index = raw as Record<string, unknown>;
  if (index.schema !== 'presentation-media.v2' || !Array.isArray(index.assets)) {
    throw new Error('Presentation media index schema is invalid.');
  }
  const assets = index.assets.map(parseEntry);
  if (new Set(assets.map((entry) => entry.key)).size !== assets.length) {
    throw new Error('Prepared asset keys must be unique.');
  }
  return { schema: 'presentation-media.v2', assets };
}

export function preparedPresentationAssetKey(args: {
  kind: PreparedPresentationAssetKind;
  ownerId: string;
  videoId: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
}): string {
  if (!isSafeClipIdSegment(args.ownerId) || !isSafeClipIdSegment(args.videoId)) {
    throw new Error('Prepared asset ids must be safe path segments.');
  }
  return `${args.kind}-${args.ownerId}-${args.videoId}-f${args.sourceStartFrame}-${args.sourceEndFrame}`;
}

export async function readPresentationMediaIndex(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<PresentationMediaIndex> {
  try {
    return parsePresentationMediaIndex(JSON.parse(await readTextFile(projectDir, indexPath(presentationId))));
  } catch (error) {
    if (isNotFoundError(error)) return emptyIndex();
    throw error;
  }
}

export async function writePreparedPresentationAsset(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  input: Omit<PreparedPresentationAsset, 'key' | 'file' | 'createdAt'>,
  blob: Blob,
  now = new Date(),
): Promise<PreparedPresentationAsset> {
  const key = preparedPresentationAssetKey(input);
  const file = `motion-v2/${key}.mp4`;
  const entry = parseEntry({ ...input, key, file, createdAt: now.toISOString() });
  const fileHandle = await getFilePath(projectDir, [...presentationMediaRoot(presentationId), ...file.split('/')], true);
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  const index = await readPresentationMediaIndex(projectDir, presentationId);
  await writeJsonFile(projectDir, indexPath(presentationId), {
    schema: 'presentation-media.v2',
    assets: [...index.assets.filter((asset) => asset.key !== key), entry],
  } satisfies PresentationMediaIndex);
  return entry;
}

export async function readPreparedPresentationAssetFile(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  entry: PreparedPresentationAsset,
): Promise<File> {
  const expected = parseEntry(entry);
  return getFilePath(
    projectDir,
    [...presentationMediaRoot(presentationId), ...expected.file.split('/')],
    false,
  ).then((handle) => handle.getFile());
}
