import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateClipSchema, resolveMarkPinning, readClip, writeClip, deleteClip, listClips } from './clipStorage';
import type { Clip, ClipAnnotation } from '../types/clip';
import { CLIP_SCHEMA_VERSION } from '../types/clip';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    schema: 1,
    id: 'abc123',
    videoId: 'vid-1',
    startMs: 1000,
    endMs: 5000,
    annotations: [],
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<ClipAnnotation> = {}): ClipAnnotation {
  return {
    id: 'ann-1',
    type: 'box',
    coordMode: 'image',
    source: 'manual',
    style: { stroke: '#ff0000', strokeWidth: 4 },
    keyframes: [{ tMs: 0, x: 10, y: 20, w: 100, h: 50 }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// migrateClipSchema
// ---------------------------------------------------------------------------

describe('migrateClipSchema', () => {
  it('accepts a valid schema-1 clip', () => {
    const raw = makeClip({ annotations: [makeAnnotation()] });
    const clip = migrateClipSchema(raw);
    expect(clip.schema).toBe(1);
    expect(clip.id).toBe('abc123');
    expect(clip.videoId).toBe('vid-1');
    expect(clip.startMs).toBe(1000);
    expect(clip.endMs).toBe(5000);
    expect(clip.annotations).toHaveLength(1);
  });

  it('throws on non-object input', () => {
    expect(() => migrateClipSchema(null)).toThrow('not an object');
    expect(() => migrateClipSchema('hello')).toThrow('not an object');
    expect(() => migrateClipSchema(42)).toThrow('not an object');
  });

  it('throws on missing schema version', () => {
    expect(() => migrateClipSchema({ id: 'x' })).toThrow('missing or invalid schema');
  });

  it('throws on future schema version', () => {
    expect(() => migrateClipSchema({ schema: 999 })).toThrow('newer than supported');
  });

  it('throws on missing id', () => {
    expect(() => migrateClipSchema({ schema: 1, videoId: 'v', startMs: 0, endMs: 1, annotations: [] })).toThrow('missing id');
  });

  it('throws on missing videoId', () => {
    expect(() => migrateClipSchema({ schema: 1, id: 'x', startMs: 0, endMs: 1, annotations: [] })).toThrow('missing videoId');
  });

  it('throws on missing startMs or endMs', () => {
    expect(() => migrateClipSchema({ schema: 1, id: 'x', videoId: 'v', annotations: [] })).toThrow('missing startMs or endMs');
  });

  it('throws when startMs >= endMs', () => {
    expect(() => migrateClipSchema({ schema: 1, id: 'x', videoId: 'v', startMs: 5, endMs: 5, annotations: [] })).toThrow('startMs must be less than endMs');
    expect(() => migrateClipSchema({ schema: 1, id: 'x', videoId: 'v', startMs: 10, endMs: 5, annotations: [] })).toThrow('startMs must be less than endMs');
  });

  it('throws when annotations is not an array', () => {
    expect(() => migrateClipSchema({ schema: 1, id: 'x', videoId: 'v', startMs: 0, endMs: 1, annotations: 'bad' })).toThrow('annotations must be an array');
  });

  it('preserves optional mark IDs', () => {
    const raw = makeClip({ startMarkId: 'mark-a', endMarkId: 'mark-b' });
    const clip = migrateClipSchema(raw);
    expect(clip.startMarkId).toBe('mark-a');
    expect(clip.endMarkId).toBe('mark-b');
  });

  it('throws on unknown schema version (e.g. 0)', () => {
    expect(() => migrateClipSchema({ schema: 0 })).toThrow('Unknown clip schema version');
  });
});

// ---------------------------------------------------------------------------
// resolveMarkPinning
// ---------------------------------------------------------------------------

describe('resolveMarkPinning', () => {
  const marks = [
    { id: 'mark-a', t_ms: 2000 },
    { id: 'mark-b', t_ms: 8000 },
  ];

  it('updates startMs and endMs when marks exist', () => {
    const clip = makeClip({ startMs: 1000, endMs: 5000, startMarkId: 'mark-a', endMarkId: 'mark-b' });
    const resolved = resolveMarkPinning(clip, marks);
    expect(resolved.startMs).toBe(2000);
    expect(resolved.endMs).toBe(8000);
    expect(resolved.startMarkId).toBe('mark-a');
    expect(resolved.endMarkId).toBe('mark-b');
  });

  it('nulls out startMarkId when start mark is missing', () => {
    const clip = makeClip({ startMarkId: 'deleted-mark', endMarkId: 'mark-b' });
    const resolved = resolveMarkPinning(clip, marks);
    expect(resolved.startMarkId).toBeNull();
    expect(resolved.startMs).toBe(1000); // retains original
    expect(resolved.endMs).toBe(8000);   // updated from mark-b
    expect(resolved.endMarkId).toBe('mark-b');
  });

  it('nulls out endMarkId when end mark is missing', () => {
    const clip = makeClip({ startMarkId: 'mark-a', endMarkId: 'deleted-mark' });
    const resolved = resolveMarkPinning(clip, marks);
    expect(resolved.endMarkId).toBeNull();
    expect(resolved.endMs).toBe(5000);   // retains original
    expect(resolved.startMs).toBe(2000); // updated from mark-a
  });

  it('does nothing when no mark IDs are set', () => {
    const clip = makeClip({ startMarkId: undefined, endMarkId: undefined });
    const resolved = resolveMarkPinning(clip, marks);
    expect(resolved.startMs).toBe(1000);
    expect(resolved.endMs).toBe(5000);
  });

  it('handles null mark IDs', () => {
    const clip = makeClip({ startMarkId: null, endMarkId: null });
    const resolved = resolveMarkPinning(clip, marks);
    expect(resolved.startMs).toBe(1000);
    expect(resolved.endMs).toBe(5000);
  });

  it('does not mutate the original clip', () => {
    const clip = makeClip({ startMarkId: 'mark-a' });
    const resolved = resolveMarkPinning(clip, marks);
    expect(clip.startMs).toBe(1000);     // unchanged
    expect(resolved.startMs).toBe(2000); // updated copy
    expect(clip).not.toBe(resolved);
  });
});

// ---------------------------------------------------------------------------
// CRUD operations — mock File System Access API
// ---------------------------------------------------------------------------

// In-memory file system mock
function createMockFS(files: Record<string, Record<string, string>> = {}) {
  // files: { dirName: { fileName: content } }
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
        if (!dir) throw new DOMException('Not found', 'NotFoundError');
        if (!(name in dir)) {
          if (opts?.create) {
            dir[name] = '';
          } else {
            throw new DOMException('Not found', 'NotFoundError');
          }
        }
        return makeFileHandle(dirName, name);
      }),
      removeEntry: vi.fn(async (name: string) => {
        const dir = storage[dirName];
        if (!dir || !(name in dir)) {
          throw new DOMException('Not found', 'NotFoundError');
        }
        delete dir[name];
      }),
      entries: vi.fn(async function* () {
        const dir = storage[dirName];
        if (!dir) return;
        for (const [name, content] of Object.entries(dir)) {
          yield [name, makeFileHandle(dirName, name)] as [string, FileSystemFileHandle];
        }
      }),
    } as unknown as FileSystemDirectoryHandle;
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
          write: async (data: string) => { written += data; },
          close: async () => {
            if (!storage[dirName]) storage[dirName] = {};
            storage[dirName][fileName] = written;
          },
        };
      }),
    } as unknown as FileSystemFileHandle;
  }

  return { root: makeDirHandle(''), storage };
}

describe('readClip', () => {
  it('reads a valid clip file', async () => {
    const clip = makeClip();
    const { root } = createMockFS({ clips: { 'clip-abc123.json': JSON.stringify(clip) } });
    const result = await readClip(root, 'abc123');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('abc123');
    expect(result!.videoId).toBe('vid-1');
  });

  it('returns null when clips/ dir does not exist', async () => {
    const { root } = createMockFS({});
    const result = await readClip(root, 'abc123');
    expect(result).toBeNull();
  });

  it('returns null when clip file does not exist', async () => {
    const { root } = createMockFS({ clips: {} });
    const result = await readClip(root, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    const { root } = createMockFS({ clips: { 'clip-bad.json': 'not json {{{' } });
    const result = await readClip(root, 'bad');
    expect(result).toBeNull();
  });
});

describe('writeClip', () => {
  it('writes a clip to clips/ directory', async () => {
    const { root, storage } = createMockFS({});
    const clip = makeClip();
    await writeClip(root, clip);
    expect(storage['clips']).toBeDefined();
    expect(storage['clips']['clip-abc123.json']).toBeDefined();
    const written = JSON.parse(storage['clips']['clip-abc123.json']);
    expect(written.id).toBe('abc123');
    expect(written.schema).toBe(1);
  });

  it('creates clips/ dir if missing', async () => {
    const { root, storage } = createMockFS({});
    expect(storage['clips']).toBeUndefined();
    await writeClip(root, makeClip());
    expect(storage['clips']).toBeDefined();
  });
});

describe('deleteClip', () => {
  it('removes a clip file', async () => {
    const clip = makeClip();
    const { root, storage } = createMockFS({ clips: { 'clip-abc123.json': JSON.stringify(clip) } });
    expect(storage['clips']['clip-abc123.json']).toBeDefined();
    await deleteClip(root, 'abc123');
    expect(storage['clips']['clip-abc123.json']).toBeUndefined();
  });

  it('does not throw when clips/ dir is missing', async () => {
    const { root } = createMockFS({});
    await expect(deleteClip(root, 'abc123')).resolves.toBeUndefined();
  });

  it('does not throw when file is missing', async () => {
    const { root } = createMockFS({ clips: {} });
    await expect(deleteClip(root, 'nonexistent')).resolves.toBeUndefined();
  });
});

describe('listClips', () => {
  it('returns clips sorted by startMs', async () => {
    const clip1 = makeClip({ id: 'late', startMs: 5000, endMs: 8000 });
    const clip2 = makeClip({ id: 'early', startMs: 1000, endMs: 3000 });
    const { root } = createMockFS({
      clips: {
        'clip-late.json': JSON.stringify(clip1),
        'clip-early.json': JSON.stringify(clip2),
      },
    });
    const result = await listClips(root);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('early');
    expect(result[1].id).toBe('late');
  });

  it('returns empty array when clips/ dir does not exist', async () => {
    const { root } = createMockFS({});
    const result = await listClips(root);
    expect(result).toEqual([]);
  });

  it('ignores non-JSON files', async () => {
    const clip = makeClip();
    const { root } = createMockFS({
      clips: {
        'clip-abc123.json': JSON.stringify(clip),
        'readme.txt': 'not a clip',
        '.DS_Store': '',
      },
    });
    const result = await listClips(root);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('abc123');
  });

  it('ignores files that are not clip-*.json pattern', async () => {
    const clip = makeClip();
    const { root } = createMockFS({
      clips: {
        'clip-abc123.json': JSON.stringify(clip),
        'something-else.json': JSON.stringify({ schema: 1, id: 'x', videoId: 'v', startMs: 0, endMs: 1, annotations: [] }),
      },
    });
    const result = await listClips(root);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('abc123');
  });

  it('skips invalid clip files without throwing', async () => {
    const clip = makeClip();
    const { root } = createMockFS({
      clips: {
        'clip-good.json': JSON.stringify(clip),
        'clip-bad.json': 'not valid json',
      },
    });
    const result = await listClips(root);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('abc123');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: write → read → compare
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('write then read returns identical clip data', async () => {
    const clip = makeClip({
      startMarkId: 'mark-a',
      endMarkId: null,
      annotations: [
        makeAnnotation(),
        makeAnnotation({
          id: 'ann-2',
          type: 'text',
          text: 'Hello world',
          source: 'auto',
          coordMode: 'pitch',
          style: { stroke: '#00ff00', fontSize: 24 },
          keyframes: [
            { tMs: 0, x: 50, y: 60 },
            { tMs: 500, x: 80, y: 90 },
          ],
        }),
      ],
    });

    const { root } = createMockFS({});
    await writeClip(root, clip);
    const read = await readClip(root, clip.id);

    expect(read).not.toBeNull();
    expect(read!.schema).toBe(clip.schema);
    expect(read!.id).toBe(clip.id);
    expect(read!.videoId).toBe(clip.videoId);
    expect(read!.startMs).toBe(clip.startMs);
    expect(read!.endMs).toBe(clip.endMs);
    expect(read!.startMarkId).toBe(clip.startMarkId);
    expect(read!.endMarkId).toBe(clip.endMarkId);
    expect(read!.annotations).toHaveLength(2);
    expect(read!.annotations[0].id).toBe('ann-1');
    expect(read!.annotations[1].type).toBe('text');
    expect(read!.annotations[1].text).toBe('Hello world');
    expect(read!.annotations[1].keyframes).toHaveLength(2);
  });
});
