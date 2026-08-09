import { parseAnnotations, type Annotations } from '../types/annotations';
import {
  canonicalPinAnnotationPath,
  isSafeClipIdSegment,
  parseClip,
  type ClipPin,
  type Clip,
  type PinAnnotationRef,
  type PinAnnotationRole,
} from '../types/clip';
import { withClipExclusive } from './clipRepository';
import { readClip, writeClip } from './clipStorage';
import {
  copyFileVerified,
  getDirectoryPath,
  getFilePath,
  isNotFoundError,
  pathExists,
  readTextFile,
  removePath,
  writeJsonFile,
} from './fsAccess';
import {
  createTrashPayload,
  readTrashOperation,
  removeTrashOperation,
  type DeleteClipToTrashOptions,
  type TrashOperationRecord,
} from './trash';

export interface CreatePinAnnotationOptions {
  role?: PinAnnotationRole;
  label?: string;
}

export interface PinAnnotationReadResult {
  document: Annotations | null;
  error?: string;
}

export function pinAnnotationPath(clipId: string, annotationId: string): string[] {
  if (!isSafeClipIdSegment(clipId) || !isSafeClipIdSegment(annotationId)) {
    throw new Error('Clip and annotation ids must be safe path segments.');
  }
  return ['analysis', 'clips', clipId, 'annotations', `${annotationId}.json`];
}

function documentLockName(clipId: string, annotationId: string): string {
  return `annotate:annotation:${clipId}:${annotationId}`;
}

async function withDocumentExclusive<T>(
  clipId: string,
  annotationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new Error('Web Locks are required to save pin annotations safely.');
  return locks.request(documentLockName(clipId, annotationId), { mode: 'exclusive' }, operation);
}

async function withDocumentShared<T>(
  clipId: string,
  annotationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new Error('Web Locks are required to read pin annotations safely.');
  return locks.request(documentLockName(clipId, annotationId), { mode: 'shared' }, operation);
}

async function requireClip(projectDir: FileSystemDirectoryHandle, clipId: string): Promise<Clip> {
  const result = await readClip(projectDir, clipId);
  if (!result.ok) throw new Error(result.error.message);
  return result.clip;
}

function requirePin(clip: Clip, pinId: string): ClipPin {
  const pin = clip.pins.find((candidate) => candidate.id === pinId);
  if (!pin) throw new Error(`Pin "${pinId}" does not exist on clip "${clip.id}".`);
  return pin;
}

function allAnnotationIds(clip: Clip): Set<string> {
  return new Set([
    ...clip.annotations.map((annotation) => annotation.id),
    ...clip.pins.flatMap((pin) => pin.annotations.map((annotation) => annotation.id)),
  ]);
}

function validateDocumentAnchor(document: Annotations, clip: Clip, pin: ClipPin): void {
  if (
    document.clipId !== clip.id
    || document.pinId !== pin.id
    || document.frame !== pin.frame
  ) {
    throw new Error(`Annotation document anchor must match ${clip.id}/${pin.id}@${pin.frame}.`);
  }
}

async function writePinDocument(
  projectDir: FileSystemDirectoryHandle,
  document: Annotations,
): Promise<void> {
  await writeJsonFile(projectDir, pinAnnotationPath(document.clipId, document.annotationId), document);
}

export async function readPinAnnotationDocument(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  annotationId: string,
): Promise<PinAnnotationReadResult> {
  try {
    return await withDocumentShared(clipId, annotationId, async () => {
      const raw = JSON.parse(await readTextFile(projectDir, pinAnnotationPath(clipId, annotationId)));
      return { document: parseAnnotations(raw) };
    });
  } catch (error) {
    if (isNotFoundError(error)) return { document: null };
    return { document: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createPinExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  pin: ClipPin,
): Promise<Clip> {
  if (pin.annotations.length > 0) {
    throw new Error('A new pin must be created without document refs; create its documents through the repository.');
  }
  return withClipExclusive(projectDir, clipId, async () => {
    const clip = await requireClip(projectDir, clipId);
    if (clip.pins.some((candidate) => candidate.id === pin.id)) throw new Error(`Pin "${pin.id}" already exists.`);
    if (clip.pins.some((candidate) => candidate.frame === pin.frame)) {
      throw new Error(`Frame ${pin.frame} already has a pin.`);
    }
    if (pin.frame < clip.startFrame || pin.frame >= clip.endFrame) {
      throw new Error(`Pin frame ${pin.frame} is outside the clip range.`);
    }
    const next = {
      ...clip,
      pins: [...clip.pins, structuredClone(pin)].sort((left, right) => left.frame - right.frame),
    };
    await writeClip(projectDir, next);
    return next;
  });
}

export async function renamePinExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  pinId: string,
  label?: string,
): Promise<Clip> {
  return withClipExclusive(projectDir, clipId, async () => {
    const clip = await requireClip(projectDir, clipId);
    requirePin(clip, pinId);
    const next = {
      ...clip,
      pins: clip.pins.map((pin) => pin.id === pinId ? { ...pin, label } : pin),
    };
    await writeClip(projectDir, next);
    return next;
  });
}

export async function createPinAnnotationExclusive(
  projectDir: FileSystemDirectoryHandle,
  documentInput: Annotations,
  options: CreatePinAnnotationOptions = {},
): Promise<Clip> {
  const document = parseAnnotations(documentInput);
  return withClipExclusive(projectDir, document.clipId, async () => {
    const clip = await requireClip(projectDir, document.clipId);
    const pin = requirePin(clip, document.pinId);
    validateDocumentAnchor(document, clip, pin);
    if (allAnnotationIds(clip).has(document.annotationId)) {
      throw new Error(`Annotation id "${document.annotationId}" is already used in this clip.`);
    }
    const role = options.role ?? (pin.annotations.length === 0 ? 'default' : 'alternate');
    if (role === 'default' && pin.annotations.some((reference) => reference.role === 'default')) {
      throw new Error(`Pin "${pin.id}" already has a default annotation document.`);
    }
    if (await pathExists(projectDir, pinAnnotationPath(clip.id, document.annotationId), 'file')) {
      throw new Error(`Annotation file "${document.annotationId}" already exists as an orphan.`);
    }
    await withDocumentExclusive(clip.id, document.annotationId, () => writePinDocument(projectDir, document));
    const reference: PinAnnotationRef = {
      id: document.annotationId,
      file: canonicalPinAnnotationPath(document.annotationId),
      role,
      label: options.label,
    };
    const next = {
      ...clip,
      pins: clip.pins.map((candidate) => candidate.id === pin.id
        ? { ...candidate, annotations: [...candidate.annotations, reference] }
        : candidate),
    };
    await writeClip(projectDir, next);
    return next;
  });
}

export async function savePinAnnotationExclusive(
  projectDir: FileSystemDirectoryHandle,
  documentInput: Annotations,
): Promise<void> {
  const document = parseAnnotations(documentInput);
  await withClipExclusive(projectDir, document.clipId, async () => {
    const clip = await requireClip(projectDir, document.clipId);
    const pin = requirePin(clip, document.pinId);
    validateDocumentAnchor(document, clip, pin);
    if (!pin.annotations.some((reference) => reference.id === document.annotationId)) {
      throw new Error(`Annotation ref "${document.annotationId}" has been deleted.`);
    }
    await withDocumentExclusive(clip.id, document.annotationId, () => writePinDocument(projectDir, document));
  });
}

export async function deletePinAnnotationExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  pinId: string,
  annotationId: string,
  options: DeleteClipToTrashOptions = {},
): Promise<TrashOperationRecord> {
  return withClipExclusive(projectDir, clipId, async () => {
    const clip = await requireClip(projectDir, clipId);
    const pin = requirePin(clip, pinId);
    const reference = pin.annotations.find((candidate) => candidate.id === annotationId);
    if (!reference) throw new Error(`Annotation ref "${annotationId}" does not exist.`);
    const sourcePath = pinAnnotationPath(clipId, annotationId);
    const source = await getFilePath(projectDir, sourcePath, false);
    const record = await createTrashPayload(projectDir, {
      kind: 'annotation',
      entityId: annotationId,
      clipId,
      sourcePath: sourcePath.join('/'),
      operationId: options.operationId,
      now: options.now,
      async populate(payload) {
        await copyFileVerified(source, await payload.getFileHandle('document.json', { create: true }));
        await writeJsonFile(payload, ['reference.json'], reference);
      },
    });
    const next = {
      ...clip,
      pins: clip.pins.map((candidate) => candidate.id === pinId
        ? { ...candidate, annotations: candidate.annotations.filter((entry) => entry.id !== annotationId) }
        : candidate),
    };
    await writeClip(projectDir, next);
    await removePath(projectDir, sourcePath).catch(() => undefined);
    return record;
  });
}

export async function restorePinAnnotationExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  pinId: string,
  annotationId: string,
  operationId: string,
): Promise<Clip> {
  return withClipExclusive(projectDir, clipId, async () => {
    const clip = await requireClip(projectDir, clipId);
    const pin = requirePin(clip, pinId);
    if (allAnnotationIds(clip).has(annotationId)) throw new Error(`Annotation id "${annotationId}" is already in use.`);
    const { record, payload } = await readTrashOperation(projectDir, 'annotation', annotationId, operationId);
    if (record.clipId !== clipId) throw new Error('Trash annotation belongs to another clip.');
    const reference = JSON.parse(await readTextFile(payload, ['reference.json'])) as PinAnnotationRef;
    const document = parseAnnotations(JSON.parse(await readTextFile(payload, ['document.json'])));
    validateDocumentAnchor(document, clip, pin);
    if (reference.id !== annotationId || reference.file !== canonicalPinAnnotationPath(annotationId)) {
      throw new Error('Trash annotation reference is invalid.');
    }
    const destinationPath = pinAnnotationPath(clipId, annotationId);
    if (await pathExists(projectDir, destinationPath, 'file')) throw new Error('Annotation destination already exists.');
    await copyFileVerified(
      await payload.getFileHandle('document.json', { create: false }),
      await getFilePath(projectDir, destinationPath, true),
    );
    const next = {
      ...clip,
      pins: clip.pins.map((candidate) => candidate.id === pinId
        ? { ...candidate, annotations: [...candidate.annotations, reference] }
        : candidate),
    };
    try {
      await writeClip(projectDir, next);
    } catch (error) {
      await removePath(projectDir, destinationPath).catch(() => undefined);
      throw error;
    }
    await removeTrashOperation(projectDir, record).catch(() => undefined);
    return next;
  });
}

export async function deletePinExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  pinId: string,
  options: DeleteClipToTrashOptions = {},
): Promise<TrashOperationRecord> {
  return withClipExclusive(projectDir, clipId, async () => {
    const clip = await requireClip(projectDir, clipId);
    const pin = requirePin(clip, pinId);
    const record = await createTrashPayload(projectDir, {
      kind: 'pin',
      entityId: pinId,
      clipId,
      sourcePath: `analysis/clips/${clipId}/clip.json#pins/${pinId}`,
      operationId: options.operationId,
      now: options.now,
      async populate(payload) {
        await writeJsonFile(payload, ['pin.json'], pin);
        const annotationDirectory = await payload.getDirectoryHandle('annotations', { create: true });
        for (const reference of pin.annotations) {
          await copyFileVerified(
            await getFilePath(projectDir, pinAnnotationPath(clipId, reference.id), false),
            await annotationDirectory.getFileHandle(`${reference.id}.json`, { create: true }),
          );
        }
      },
    });
    const next = { ...clip, pins: clip.pins.filter((candidate) => candidate.id !== pinId) };
    await writeClip(projectDir, next);
    for (const reference of pin.annotations) {
      await removePath(projectDir, pinAnnotationPath(clipId, reference.id)).catch(() => undefined);
    }
    return record;
  });
}

export async function restorePinExclusive(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  pinId: string,
  operationId: string,
): Promise<Clip> {
  return withClipExclusive(projectDir, clipId, async () => {
    const clip = await requireClip(projectDir, clipId);
    const { record, payload } = await readTrashOperation(projectDir, 'pin', pinId, operationId);
    if (record.clipId !== clipId) throw new Error('Trash pin belongs to another clip.');
    const pin = JSON.parse(await readTextFile(payload, ['pin.json'])) as ClipPin;
    if (pin.id !== pinId) throw new Error('Trash pin identity is invalid.');
    if (clip.pins.some((candidate) => candidate.id === pin.id)) throw new Error(`Pin "${pin.id}" already exists.`);
    if (clip.pins.some((candidate) => candidate.frame === pin.frame)) {
      throw new Error(`Cannot restore pin: frame ${pin.frame} is already occupied.`);
    }
    const usedIds = allAnnotationIds(clip);
    for (const reference of pin.annotations) {
      if (usedIds.has(reference.id)) throw new Error(`Annotation id "${reference.id}" is already in use.`);
    }

    const next = parseClip({
      ...clip,
      pins: [...clip.pins, pin].sort((left, right) => left.frame - right.frame),
    }, { folderId: clipId });

    const copiedPaths: string[][] = [];
    try {
      const payloadAnnotations = await payload.getDirectoryHandle('annotations', { create: false });
      for (const reference of pin.annotations) {
        const destinationPath = pinAnnotationPath(clipId, reference.id);
        if (await pathExists(projectDir, destinationPath, 'file')) {
          throw new Error(`Annotation destination "${reference.id}" already exists.`);
        }
        const source = await payloadAnnotations.getFileHandle(`${reference.id}.json`, { create: false });
        const document = parseAnnotations(JSON.parse(await (await source.getFile()).text()));
        validateDocumentAnchor(document, clip, pin);
        if (document.annotationId !== reference.id) {
          throw new Error(`Trash annotation "${reference.id}" has a mismatched document id.`);
        }
        await copyFileVerified(
          source,
          await getFilePath(projectDir, destinationPath, true),
        );
        copiedPaths.push(destinationPath);
      }
      await writeClip(projectDir, next);
    } catch (error) {
      await Promise.all(copiedPaths.map((path) => removePath(projectDir, path).catch(() => undefined)));
      throw error;
    }
    await removeTrashOperation(projectDir, record).catch(() => undefined);
    return next;
  });
}
