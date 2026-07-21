import { afterEach, describe, expect, it, vi } from 'vitest';

import defaultBoardDocument from '../../public/tagging/board.json';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import type { Annotations } from '../types/annotations';
import type { ClipPin, Clip } from '../types/clip';
import { createClipExclusive, deleteClipExclusive } from './clipRepository';
import { readClip } from './clipStorage';
import {
  createPinAnnotationExclusive,
  createPinExclusive,
  deletePinAnnotationExclusive,
  deletePinExclusive,
  readPinAnnotationDocument,
  restorePinAnnotationExclusive,
  restorePinExclusive,
  savePinAnnotationExclusive,
} from './pinAnnotationStorage';
import { createProject } from './projectFolder';
import {
  createSerialLockManager,
  MockFileSystem,
  type MockFileSystemOptions,
} from './test/mockFileSystem';

async function fixture(options: MockFileSystemOptions = {}): Promise<{
  fileSystem: MockFileSystem;
  clip: Clip;
  pin: ClipPin;
  document: Annotations;
}> {
  const fileSystem = new MockFileSystem({}, options);
  await createProject(fileSystem.root, {
    name: 'Pin storage',
    defaultBoardSource: JSON.stringify(defaultBoardDocument),
  });
  vi.stubGlobal('navigator', { locks: createSerialLockManager() });
  const clip: Clip = {
    schema: 'clip.v2',
    id: 'clip_pin_test',
    videoId: 'video_main',
    startFrame: videoFrame(100),
    endFrame: frameBoundary(200),
    tags: { primary: null, facets: {} },
    pins: [],
    annotations: [],
  };
  await createClipExclusive(fileSystem.root, clip);
  const pin: ClipPin = { id: 'pin_main', frame: videoFrame(140), annotations: [] };
  await createPinExclusive(fileSystem.root, clip.id, pin);
  const document: Annotations = {
    schema: 'annotations.v2',
    annotationId: 'ann_main',
    clipId: clip.id,
    pinId: pin.id,
    frame: pin.frame,
    image: { width: 1920, height: 1080 },
    shapes: [],
  };
  return { fileSystem, clip, pin, document };
}

afterEach(() => vi.unstubAllGlobals());

describe('pinAnnotationStorage', () => {
  it('creates and saves a pin document only through its live clip ref', async () => {
    const { fileSystem, clip, document } = await fixture();
    await createPinAnnotationExclusive(fileSystem.root, document, { label: 'Default view' });
    const changed = {
      ...document,
      shapes: [{ id: 'player', type: 'highlight', x: 20, y: 30 }],
    } satisfies Annotations;
    await savePinAnnotationExclusive(fileSystem.root, changed);

    expect(await readPinAnnotationDocument(fileSystem.root, clip.id, document.annotationId)).toMatchObject({
      document: { shapes: [{ id: 'player' }] },
    });
    const storedClip = await readClip(fileSystem.root, clip.id);
    expect(storedClip).toMatchObject({
      ok: true,
      clip: { pins: [{ annotations: [{ id: document.annotationId, role: 'default' }] }] },
    });
  });

  it('refuses clip-wide duplicate annotation ids', async () => {
    const { fileSystem, clip, document } = await fixture();
    const current = await readClip(fileSystem.root, clip.id);
    if (!current.ok) throw new Error(current.error.message);
    current.clip.annotations.push({
      id: document.annotationId,
      type: 'highlight',
      coordMode: 'image',
      source: 'manual',
      style: {},
      keyframes: [{ frame: videoFrame(120), cx: 1, cy: 2, radius: 3 }],
    });
    // Direct fixture rewrite is intentionally invalid only from the document-id ownership perspective.
    const clipFile = await fileSystem.root
      .getDirectoryHandle('analysis')
      .then((analysis) => analysis.getDirectoryHandle('clips'))
      .then((clips) => clips.getDirectoryHandle(clip.id))
      .then((folder) => folder.getFileHandle('clip.json'));
    const writable = await clipFile.createWritable();
    await writable.write(JSON.stringify(current.clip));
    await writable.close();

    await expect(createPinAnnotationExclusive(fileSystem.root, document)).rejects.toThrow('already used');
  });

  it('round-trips document trash and rejects stale saves after deletion', async () => {
    const { fileSystem, clip, pin, document } = await fixture();
    await createPinAnnotationExclusive(fileSystem.root, document);
    const record = await deletePinAnnotationExclusive(
      fileSystem.root,
      clip.id,
      pin.id,
      document.annotationId,
      { operationId: 'delete-ann' },
    );

    await expect(savePinAnnotationExclusive(fileSystem.root, document)).rejects.toThrow('has been deleted');
    expect((await readPinAnnotationDocument(fileSystem.root, clip.id, document.annotationId)).document).toBeNull();
    const restored = await restorePinAnnotationExclusive(
      fileSystem.root,
      clip.id,
      pin.id,
      document.annotationId,
      record.operationId,
    );
    expect(restored.pins[0].annotations[0].id).toBe(document.annotationId);
    expect((await readPinAnnotationDocument(fileSystem.root, clip.id, document.annotationId)).document).not.toBeNull();
  });

  it('round-trips a pin and all of its documents', async () => {
    const { fileSystem, clip, pin, document } = await fixture();
    await createPinAnnotationExclusive(fileSystem.root, document);
    const record = await deletePinExclusive(fileSystem.root, clip.id, pin.id, { operationId: 'delete-pin' });
    expect((await readClip(fileSystem.root, clip.id))).toMatchObject({ ok: true, clip: { pins: [] } });

    const restored = await restorePinExclusive(fileSystem.root, clip.id, pin.id, record.operationId);
    expect(restored.pins).toHaveLength(1);
    expect(restored.pins[0]).toMatchObject({ id: pin.id, frame: pin.frame });
    expect((await readPinAnnotationDocument(fileSystem.root, clip.id, document.annotationId)).document).not.toBeNull();
  });

  it('keeps a restored pin committed when post-restore trash cleanup fails', async () => {
    let failCleanup = false;
    const { fileSystem, clip, pin, document } = await fixture({
      onRemove(path) {
        if (failCleanup && path === '.trash/pins/pin_main-delete-pin-cleanup') {
          throw new Error('simulated trash cleanup failure');
        }
      },
    });
    await createPinAnnotationExclusive(fileSystem.root, document);
    const record = await deletePinExclusive(fileSystem.root, clip.id, pin.id, {
      operationId: 'delete-pin-cleanup',
    });

    failCleanup = true;
    const restored = await restorePinExclusive(fileSystem.root, clip.id, pin.id, record.operationId);

    expect(restored.pins).toHaveLength(1);
    expect((await readClip(fileSystem.root, clip.id))).toMatchObject({
      ok: true,
      clip: { pins: [{ id: pin.id, annotations: [{ id: document.annotationId }] }] },
    });
    expect((await readPinAnnotationDocument(fileSystem.root, clip.id, document.annotationId)).document).not.toBeNull();
    expect(fileSystem.exists('.trash/pins/pin_main-delete-pin-cleanup')).toBe(true);
  });

  it('refuses pin restore if another pin now occupies its immutable frame', async () => {
    const { fileSystem, clip, pin } = await fixture();
    const record = await deletePinExclusive(fileSystem.root, clip.id, pin.id, { operationId: 'occupied-frame' });
    await createPinExclusive(fileSystem.root, clip.id, {
      id: 'replacement_pin',
      frame: pin.frame,
      annotations: [],
    });

    await expect(restorePinExclusive(fileSystem.root, clip.id, pin.id, record.operationId)).rejects.toThrow(
      'already occupied',
    );
  });

  it('serializes a document save behind clip deletion without recreating the clip', async () => {
    const { fileSystem, clip, document } = await fixture();
    await createPinAnnotationExclusive(fileSystem.root, document);

    const deletion = deleteClipExclusive(fileSystem.root, clip.id, { operationId: 'delete-clip' });
    const lateSave = savePinAnnotationExclusive(fileSystem.root, document);
    await expect(deletion).resolves.toMatchObject({ operationId: 'delete-clip' });
    await expect(lateSave).rejects.toMatchObject({ code: 'deleted' });
    expect(fileSystem.exists(`analysis/clips/${clip.id}`)).toBe(false);
  });
});
