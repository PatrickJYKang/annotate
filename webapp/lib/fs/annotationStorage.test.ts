import { describe, expect, it, vi } from 'vitest';

import type { ProjectManifestV1 } from '../types/project';
import { readPrimaryAnnotationDocumentForStill } from './annotationStorage';

function createMockFS(files: Record<string, Record<string, string>> = {}) {
  const storage: Record<string, Record<string, string>> = { ...files };
  for (const dir of Object.keys(storage)) {
    storage[dir] = { ...storage[dir] };
  }

  function makeDirHandle(dirName: string): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: dirName,
      getDirectoryHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
        const key = dirName ? `${dirName}/${name}` : name;
        if (!storage[key]) {
          if (opts?.create) {
            storage[key] = {};
          } else {
            throw new DOMException('Not found', 'NotFoundError');
          }
        }
        return makeDirHandle(key);
      }),
      getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
        const dir = storage[dirName];
        if (!dir || !(name in dir)) {
          if (opts?.create) {
            if (!storage[dirName]) storage[dirName] = {};
            storage[dirName][name] = '';
          } else {
            throw new DOMException('Not found', 'NotFoundError');
          }
        }
        return {
          kind: 'file',
          name,
          getFile: vi.fn(async () => ({
            text: async () => storage[dirName]?.[name] ?? '',
            lastModified: Date.now(),
          })),
        } as unknown as FileSystemFileHandle;
      }),
      entries: vi.fn(async function* () {}),
      removeEntry: vi.fn(async () => {}),
    } as unknown as FileSystemDirectoryHandle;
  }

  return { root: makeDirHandle('') };
}

function makeManifest(annotationEntries: ProjectManifestV1['annotations']): ProjectManifestV1 {
  return {
    schema: 'project.v1',
    name: 'Test Project',
    created: '2026-04-14T00:00:00.000Z',
    videos: [],
    marks: [],
    stills: [
      {
        id: 'still-1',
        videoId: 'video-1',
        t_ms: 1200,
        file: 'stills/still-1.png',
      },
    ],
    annotations: annotationEntries,
    reports: [],
    thumbnails: [],
  };
}

describe('readPrimaryAnnotationDocumentForStill', () => {
  it('prefers the default annotation document when it exists', async () => {
    const manifest = makeManifest([
      {
        stillId: 'still-1',
        id: 'default',
        file: 'annotations/still-1.json',
        role: 'default',
        label: 'Default annotations',
      },
      {
        stillId: 'still-1',
        id: 'alt-a',
        file: 'annotations/still-1/alt-a.json',
        role: 'alternate',
        label: 'Alt A',
      },
    ]);
    const { root } = createMockFS({
      annotations: {
        'still-1.json': JSON.stringify({
          schema: 'annotations.v1',
          stillId: 'still-1',
          annotationId: 'default',
          shapes: [{ id: 'box-1', type: 'box', x: 1, y: 2, w: 3, h: 4 }],
        }),
      },
      'annotations/still-1': {
        'alt-a.json': JSON.stringify({
          schema: 'annotations.v1',
          stillId: 'still-1',
          annotationId: 'alt-a',
          shapes: [{ id: 'box-2', type: 'box', x: 5, y: 6, w: 7, h: 8 }],
        }),
      },
    });

    const loaded = await readPrimaryAnnotationDocumentForStill(root, manifest, manifest.stills[0]!);

    expect(loaded?.entry.id).toBe('default');
    expect(loaded?.entry.role).toBe('default');
    expect(loaded?.document.annotationId).toBe('default');
  });

  it('falls back to the first available saved annotation document when default is missing', async () => {
    const manifest = makeManifest([
      {
        stillId: 'still-1',
        id: 'alt-a',
        file: 'annotations/still-1/alt-a.json',
        role: 'alternate',
        label: 'Alt A',
      },
      {
        stillId: 'still-1',
        id: 'alt-b',
        file: 'annotations/still-1/alt-b.json',
        role: 'alternate',
        label: 'Alt B',
      },
    ]);
    const { root } = createMockFS({
      annotations: {},
      'annotations/still-1': {
        'alt-a.json': JSON.stringify({
          schema: 'annotations.v1',
          stillId: 'still-1',
          annotationId: 'alt-a',
          shapes: [{ id: 'box-2', type: 'box', x: 5, y: 6, w: 7, h: 8 }],
        }),
      },
    });

    const loaded = await readPrimaryAnnotationDocumentForStill(root, manifest, manifest.stills[0]!);

    expect(loaded?.entry.id).toBe('alt-a');
    expect(loaded?.entry.role).toBe('alternate');
    expect(loaded?.document.annotationId).toBe('alt-a');
  });

  it('returns null when no saved annotation document can be loaded', async () => {
    const manifest = makeManifest([
      {
        stillId: 'still-1',
        id: 'default',
        file: 'annotations/still-1.json',
        role: 'default',
        label: 'Default annotations',
      },
    ]);
    const { root } = createMockFS({});

    const loaded = await readPrimaryAnnotationDocumentForStill(root, manifest, manifest.stills[0]!);

    expect(loaded).toBeNull();
  });
});
