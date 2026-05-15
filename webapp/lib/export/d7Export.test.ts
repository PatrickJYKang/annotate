import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectManifestV1 } from '../types/project';
import { exportD7All } from './d7Export';
import { renderAnnotatedPng } from './d7Render';

vi.mock('./d7Render', () => ({
  renderAnnotatedPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}));

vi.mock('../fs/projectFolder', () => ({
  writeManifest: vi.fn(async () => {}),
}));

function createMockFS(files: Record<string, Record<string, string>> = {}) {
  const storage: Record<string, Record<string, string>> = { '': {} };

  function ensureDir(dirName: string) {
    if (!(dirName in storage)) storage[dirName] = {};
    if (!dirName) return;
    const parts = dirName.split('/').filter(Boolean);
    while (parts.length > 0) {
      const parent = parts.slice(0, -1).join('/');
      if (!(parent in storage)) storage[parent] = {};
      parts.pop();
    }
  }

  for (const [dirName, dirFiles] of Object.entries(files)) {
    ensureDir(dirName);
    storage[dirName] = {
      ...storage[dirName],
      ...dirFiles,
    };
  }

  function makeFileHandle(dirName: string, fileName: string): FileSystemFileHandle {
    return {
      kind: 'file',
      name: fileName,
      getFile: vi.fn(async () => ({
        text: async () => storage[dirName]?.[fileName] ?? '',
        lastModified: Date.now(),
      })),
      createWritable: vi.fn(async () => {
        let written = '';
        return {
          write: async (data: Blob | string) => {
            written += typeof data === 'string' ? data : await data.text();
          },
          close: async () => {
            ensureDir(dirName);
            storage[dirName][fileName] = written;
          },
        };
      }),
    } as unknown as FileSystemFileHandle;
  }

  function makeDirHandle(dirName: string): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: dirName.split('/').filter(Boolean).pop() ?? '',
      queryPermission: vi.fn(async () => 'granted'),
      getDirectoryHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
        const key = dirName ? `${dirName}/${name}` : name;
        if (!(key in storage)) {
          if (opts?.create) {
            ensureDir(key);
          } else {
            throw new DOMException('Not found', 'NotFoundError');
          }
        }
        return makeDirHandle(key);
      }),
      getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
        ensureDir(dirName);
        if (!(name in storage[dirName])) {
          if (opts?.create) {
            storage[dirName][name] = '';
          } else {
            throw new DOMException('Not found', 'NotFoundError');
          }
        }
        return makeFileHandle(dirName, name);
      }),
    } as unknown as FileSystemDirectoryHandle;
  }

  return { root: makeDirHandle(''), storage };
}

function makeManifest(): ProjectManifestV1 {
  return {
    schema: 'project.v1',
    name: 'Export Test',
    created: '2026-05-06T00:00:00.000Z',
    videos: [{ id: 'video-1', label: 'Video 1', file: 'media/video.mp4', fps: 30 }],
    marks: [],
    stills: [{
      id: 'still-1',
      videoId: 'video-1',
      t_ms: 1000,
      file: 'stills/still-1.png',
      width: 1920,
      height: 1080,
    }],
    annotations: [
      {
        stillId: 'still-1',
        id: 'default',
        file: 'annotations/still-1.json',
        role: 'default',
        label: 'Default annotations',
      },
      {
        stillId: 'still-1',
        id: 'alt',
        file: 'annotations/still-1/alt.json',
        role: 'alternate',
        label: 'Alt annotations',
      },
    ],
    reports: [],
    thumbnails: [],
  };
}

describe('exportD7All', () => {
  beforeEach(() => {
    vi.mocked(renderAnnotatedPng).mockClear();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1920,
      height: 1080,
      close: vi.fn(),
    })));
  });

  it('renders each still with the first annotation set instead of merging all sets', async () => {
    const { root } = createMockFS({
      stills: {
        'still-1.png': 'image-bytes',
      },
      annotations: {
        'still-1.json': JSON.stringify({
          schema: 'annotations.v1',
          stillId: 'still-1',
          annotationId: 'default',
          image: { file: 'stills/still-1.png', width: 1920, height: 1080 },
          shapes: [{ id: 'default-box', type: 'box', x: 1, y: 2, w: 3, h: 4 }],
        }),
      },
      'annotations/still-1': {
        'alt.json': JSON.stringify({
          schema: 'annotations.v1',
          stillId: 'still-1',
          annotationId: 'alt',
          image: { file: 'stills/still-1.png', width: 1920, height: 1080 },
          shapes: [{ id: 'alt-circle', type: 'circle', x: 5, y: 6, r: 7 }],
        }),
      },
    });

    await exportD7All({ projectDir: root, manifest: makeManifest() });

    expect(renderAnnotatedPng).toHaveBeenCalledTimes(1);
    const renderArgs = vi.mocked(renderAnnotatedPng).mock.calls[0]?.[0];
    expect(renderArgs?.ann.annotationId).toBe('default');
    expect(renderArgs?.ann.shapes.map((shape) => shape.id)).toEqual(['default-box']);
  });
});
