import { afterEach, describe, expect, it, vi } from 'vitest';

import defaultBoardDocument from '../../public/tagging/board.json';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import type { Clip } from '../types/clip';
import { defaultMatchInfo } from '../types/metadata';
import { createDefaultPresentation } from '../types/presentation';
import {
  createClipExclusive,
  deleteClipExclusive,
  replaceClipAnnotationsExclusive,
  replaceClipTagsExclusive,
  restoreClipExclusive,
} from './clipRepository';
import { listClips, readClip } from './clipStorage';
import { getDirectoryPath, writeTextFile } from './fsAccess';
import {
  createProject,
  readProjectManifest,
  validateProjectFolder,
} from './projectFolder';
import { mutateProjectManifestExclusive } from './projectManifestRepository';
import {
  deletePresentation,
  duplicatePresentation,
  listPresentations,
  readPresentation,
  renamePresentation,
  writePresentation,
} from './presentationStorage';
import { createSerialLockManager, MockFileSystem } from './test/mockFileSystem';
import { cleanupTrash, hasClipTombstone } from './trash';

const boardSource = JSON.stringify(defaultBoardDocument, null, 2);

function makeClip(id: string, startFrame = 100): Clip {
  return {
    schema: 'clip.v2',
    id,
    videoId: 'video_main',
    startFrame: videoFrame(startFrame),
    endFrame: frameBoundary(startFrame + 60),
    tags: { primary: null, facets: {} },
    pins: [],
    annotations: [],
  };
}

async function createEmptyProject(fileSystem: MockFileSystem): Promise<void> {
  await createProject(fileSystem.root, {
    name: 'Storage test',
    created: '2026-07-11T00:00:00.000Z',
    defaultBoardSource: boardSource,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('projectFolder', () => {
  it('creates the complete v2 tree and commits project.json last', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);

    expect(fileSystem.exists('project.json')).toBe(true);
    expect(fileSystem.exists('tagging-board.json')).toBe(true);
    expect(fileSystem.exists('analysis/clips')).toBe(true);
    expect(fileSystem.exists('.trash/tombstones')).toBe(true);
    expect(await readProjectManifest(fileSystem.root)).toMatchObject({
      ok: true,
      manifest: { schema: 'project.v2', videos: [] },
    });
  });

  it('refuses a non-empty destination without modifying it', async () => {
    const fileSystem = new MockFileSystem({ 'keep.txt': 'do not overwrite' });

    await expect(createEmptyProject(fileSystem)).rejects.toThrow('requires an empty folder');
    expect(await fileSystem.readText('keep.txt')).toBe('do not overwrite');
    expect(fileSystem.exists('project.json')).toBe(false);
  });

  it('returns a specific refusal for v1 projects', async () => {
    const fileSystem = new MockFileSystem({
      'project.json': JSON.stringify({ schema: 'project.v1' }),
    });

    expect(await readProjectManifest(fileSystem.root)).toMatchObject({ ok: false, code: 'v1-project' });
  });

  it('accepts per-video media contracts while retaining path confinement', async () => {
    const base = {
      schema: 'project.v2',
      name: 'Mismatch',
      created: '2026-07-11T00:00:00.000Z',
      fps: 30,
      resolution: { width: 1920, height: 1080 },
      videos: [{
        id: 'video_main',
        label: 'Main',
        file: 'media/main.mp4',
        fps: 25,
        frameCount: 100,
        frameCountSource: 'probe',
        width: 1920,
        height: 1080,
      }],
    };

    const independentMedia = new MockFileSystem({ 'project.json': JSON.stringify(base) });
    expect(await readProjectManifest(independentMedia.root)).toMatchObject({
      ok: true,
      manifest: {
        videos: [{ fps: 25, width: 1920, height: 1080 }],
      },
    });
    const parsed = await readProjectManifest(independentMedia.root);
    expect(parsed.ok && 'fps' in parsed.manifest).toBe(false);
    expect(parsed.ok && 'resolution' in parsed.manifest).toBe(false);

    const pathMismatch = new MockFileSystem({
      'project.json': JSON.stringify({
        ...base,
        videos: [{ ...base.videos[0], fps: 30, file: 'outside/main.mp4' }],
      }),
    });
    expect(await readProjectManifest(pathMismatch.root)).toMatchObject({
      ok: false,
      code: 'invalid-manifest',
      reason: expect.stringContaining('media/'),
    });
  });

  it('auto-installs a missing mandatory board during open validation', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    await fileSystem.root.removeEntry('tagging-board.json');

    const opened = await validateProjectFolder(fileSystem.root, boardSource);
    expect(opened.ok).toBe(true);
    expect(fileSystem.exists('tagging-board.json')).toBe(true);
  });

  it('recreates missing disposable project folders during open validation', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    await fileSystem.root.removeEntry('cache', { recursive: true });
    await fileSystem.root.removeEntry('exports', { recursive: true });
    await fileSystem.root.removeEntry('.trash', { recursive: true });

    const opened = await validateProjectFolder(fileSystem.root, boardSource);

    expect(opened.ok).toBe(true);
    expect(fileSystem.exists('cache')).toBe(true);
    expect(fileSystem.exists('exports')).toBe(true);
    expect(fileSystem.exists('.trash/clips')).toBe(true);
    expect(fileSystem.exists('.trash/pins')).toBe(true);
    expect(fileSystem.exists('.trash/annotations')).toBe(true);
    expect(fileSystem.exists('.trash/tombstones')).toBe(true);
  });

  it('still rejects a project missing authoritative analysis storage', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    await fileSystem.root.removeEntry('analysis', { recursive: true });

    await expect(validateProjectFolder(fileSystem.root, boardSource)).resolves.toMatchObject({
      ok: false,
      code: 'missing-folder',
      reason: 'Missing required folder: analysis/',
    });
  });

  it('merges racing field-owned project-manifest mutations', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    vi.stubGlobal('navigator', { locks: createSerialLockManager() });

    await Promise.all([
      mutateProjectManifestExclusive(fileSystem.root, (latest) => ({
        ...latest,
        name: 'Renamed project',
      })),
      mutateProjectManifestExclusive(fileSystem.root, (latest) => ({
        ...latest,
        matchInfo: defaultMatchInfo(),
      })),
    ]);

    expect(await readProjectManifest(fileSystem.root)).toMatchObject({
      ok: true,
      manifest: {
        name: 'Renamed project',
        matchInfo: expect.any(Object),
      },
    });
  });
});

describe('v2 structured storage', () => {
  it('lists valid clips while returning malformed clip errors', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    await writeTextFile(fileSystem.root, ['analysis', 'clips', 'bad_clip', 'clip.json'], '{broken');
    const good = makeClip('good_clip');
    const folder = await getDirectoryPath(fileSystem.root, ['analysis', 'clips', good.id], true);
    await writeTextFile(folder, ['clip.json'], JSON.stringify(good));

    const listed = await listClips(fileSystem.root);
    expect(listed.clips.map((clip) => clip.id)).toEqual(['good_clip']);
    expect(listed.errors).toEqual([
      expect.objectContaining({ clipId: 'bad_clip', error: expect.objectContaining({ code: 'invalid-json' }) }),
    ]);
  });

  it('does not normalize malformed presentation transition counts', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    const presentation = createDefaultPresentation('Review', 'review');
    presentation.slides.push({
      id: 'title_one',
      kind: 'title',
      template: 'title',
      title: 'One',
    });
    await writePresentation(fileSystem.root, presentation);
    await writeTextFile(
      fileSystem.root,
      ['presentations', 'broken.json'],
      JSON.stringify({ ...presentation, id: 'broken', slides: [...presentation.slides, { ...presentation.slides[0], id: 'title_two' }] }),
    );
    await writeTextFile(
      fileSystem.root,
      ['presentations', 'mismatch.json'],
      JSON.stringify({ ...presentation, id: 'different_id' }),
    );

    expect((await readPresentation(fileSystem.root, 'broken'))).toMatchObject({
      ok: false,
      error: { code: 'invalid-document' },
    });
    const listed = await listPresentations(fileSystem.root);
    expect(listed.presentations.map((entry) => entry.id)).toEqual(['review']);
    expect(listed.errors).toHaveLength(2);
    expect(listed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        presentationId: 'mismatch',
        error: expect.objectContaining({ message: expect.stringContaining('contains id') }),
      }),
    ]));
  });

  it('renames, duplicates, and deletes presentations through storage helpers', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    const presentation = createDefaultPresentation(
      'Review',
      'review',
      new Date('2026-07-11T00:00:00.000Z'),
    );
    presentation.slides.push({
      id: 'title_one',
      kind: 'title',
      template: 'title',
      title: 'Opening',
    });
    await writePresentation(fileSystem.root, presentation);

    const renamed = await renamePresentation(
      fileSystem.root,
      presentation.id,
      'Match review',
      new Date('2026-07-11T01:00:00.000Z'),
    );
    expect(renamed).toMatchObject({ name: 'Match review', updatedAt: '2026-07-11T01:00:00.000Z' });

    const duplicate = await duplicatePresentation(fileSystem.root, presentation.id, {
      id: 'review-copy',
      now: new Date('2026-07-11T02:00:00.000Z'),
    });
    expect(duplicate).toMatchObject({
      id: 'review-copy',
      name: 'Match review copy',
      createdAt: '2026-07-11T02:00:00.000Z',
      slides: [{ id: 'title_one' }],
    });

    await deletePresentation(fileSystem.root, presentation.id);
    expect(await readPresentation(fileSystem.root, presentation.id)).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    expect((await listPresentations(fileSystem.root)).presentations.map((entry) => entry.id)).toEqual([
      'review-copy',
    ]);
  });
});

describe('clip repository and trash', () => {
  it('merges racing field-owned mutations against the latest clip', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    vi.stubGlobal('navigator', { locks: createSerialLockManager() });
    const clip = makeClip('race_clip');
    await createClipExclusive(fileSystem.root, clip);

    await Promise.all([
      replaceClipTagsExclusive(fileSystem.root, clip.id, {
        primary: 'offensive.open_play.pass',
        facets: { 'pass.type': 'switch' },
      }),
      replaceClipAnnotationsExclusive(fileSystem.root, clip.id, [{
        id: 'tracked_player',
        type: 'highlight',
        coordMode: 'image',
        source: 'auto',
        style: {},
        keyframes: [{ frame: videoFrame(110), cx: 10, cy: 20, radius: 4 }],
      }]),
    ]);

    const result = await readClip(fileSystem.root, clip.id);
    expect(result).toMatchObject({
      ok: true,
      clip: {
        tags: { primary: 'offensive.open_play.pass' },
        annotations: [{ id: 'tracked_player' }],
      },
    });
  });

  it('rejects an autosave queued behind deletion and restores by operation', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    vi.stubGlobal('navigator', { locks: createSerialLockManager() });
    const clip = makeClip('deleted_clip');
    await createClipExclusive(fileSystem.root, clip);

    const deletion = deleteClipExclusive(fileSystem.root, clip.id, {
      operationId: 'delete-op',
      now: new Date('2026-07-01T00:00:00.000Z'),
    });
    const lateSave = replaceClipTagsExclusive(fileSystem.root, clip.id, {
      primary: 'late-write',
      facets: {},
    });
    await expect(deletion).resolves.toMatchObject({ operationId: 'delete-op' });
    await expect(lateSave).rejects.toMatchObject({ code: 'deleted' });
    expect(await hasClipTombstone(fileSystem.root, clip.id)).toBe(true);
    expect(fileSystem.exists(`analysis/clips/${clip.id}`)).toBe(false);

    const restored = await restoreClipExclusive(fileSystem.root, clip.id, 'delete-op');
    expect(restored.tags.primary).toBeNull();
    expect(await hasClipTombstone(fileSystem.root, clip.id)).toBe(false);
  });

  it('keeps the source authoritative when the verified trash copy is interrupted', async () => {
    let failTrashCopy = false;
    const fileSystem = new MockFileSystem({}, {
      onWrite(path) {
        if (failTrashCopy && path.includes('.trash/clips/')) throw new Error('simulated copy failure');
      },
    });
    await createEmptyProject(fileSystem);
    vi.stubGlobal('navigator', { locks: createSerialLockManager() });
    const clip = makeClip('copy_failure');
    await createClipExclusive(fileSystem.root, clip);
    failTrashCopy = true;

    await expect(deleteClipExclusive(fileSystem.root, clip.id, { operationId: 'failed-op' })).rejects.toThrow(
      'simulated copy failure',
    );
    expect(fileSystem.exists(`analysis/clips/${clip.id}/clip.json`)).toBe(true);
    expect(await hasClipTombstone(fileSystem.root, clip.id)).toBe(false);
  });

  it('rolls back a restored clip if its tombstone cannot be removed', async () => {
    let failTombstoneRemoval = false;
    const fileSystem = new MockFileSystem({}, {
      onRemove(path) {
        if (failTombstoneRemoval && path === '.trash/tombstones/retry_restore.json') {
          throw new Error('simulated tombstone failure');
        }
      },
    });
    await createEmptyProject(fileSystem);
    vi.stubGlobal('navigator', { locks: createSerialLockManager() });
    const clip = makeClip('retry_restore');
    await createClipExclusive(fileSystem.root, clip);
    await deleteClipExclusive(fileSystem.root, clip.id, { operationId: 'restore-op' });

    failTombstoneRemoval = true;
    await expect(restoreClipExclusive(fileSystem.root, clip.id, 'restore-op')).rejects.toThrow(
      'simulated tombstone failure',
    );
    expect(fileSystem.exists(`analysis/clips/${clip.id}`)).toBe(false);
    expect(fileSystem.exists('.trash/clips/retry_restore-restore-op/clip.json')).toBe(true);
    expect(await hasClipTombstone(fileSystem.root, clip.id)).toBe(true);

    failTombstoneRemoval = false;
    await expect(restoreClipExclusive(fileSystem.root, clip.id, 'restore-op')).resolves.toMatchObject({
      id: clip.id,
    });
  });

  it('cleans expired payloads while retaining permanent clip tombstones', async () => {
    const fileSystem = new MockFileSystem();
    await createEmptyProject(fileSystem);
    vi.stubGlobal('navigator', { locks: createSerialLockManager() });
    const clip = makeClip('expired_clip');
    await createClipExclusive(fileSystem.root, clip);
    await deleteClipExclusive(fileSystem.root, clip.id, {
      operationId: 'old-op',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await cleanupTrash(fileSystem.root, {
      now: new Date('2026-07-11T00:00:00.000Z'),
      retentionDays: 30,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });
    expect(result.removedOperationIds).toEqual(['old-op']);
    expect(fileSystem.exists('.trash/clips/expired_clip-old-op')).toBe(false);
    expect(await hasClipTombstone(fileSystem.root, clip.id)).toBe(true);
  });

  it('enforces recursive deletion semantics in the filesystem mock', async () => {
    const fileSystem = new MockFileSystem({ 'nested/file.txt': 'content' });
    await expect(fileSystem.root.removeEntry('nested')).rejects.toMatchObject({ name: 'InvalidModificationError' });
    await expect(fileSystem.root.removeEntry('nested', { recursive: true })).resolves.toBeUndefined();
  });
});
