import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePresentation,
  duplicatePresentation,
  listPresentations,
  migratePresentationSchema,
  readPresentation,
  renamePresentation,
  writePresentation,
} from './presentationStorage';
import type { Presentation } from '../types/presentation';
import { PRESENTATION_SCHEMA_VERSION } from '../types/presentation';

function makePresentation(overrides: Partial<Presentation> = {}): Presentation {
  return {
    schema: PRESENTATION_SCHEMA_VERSION,
    id: 'pres-1',
    name: 'Presentation 1',
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    slides: [],
    transitions: [],
    ...overrides,
  };
}

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
        for (const [name] of Object.entries(dir)) {
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

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('migratePresentationSchema', () => {
  it('accepts a valid schema-1 presentation', () => {
    const result = migratePresentationSchema(makePresentation({
      slides: [
        { id: 'slide-1', kind: 'title', template: 'title', title: 'Opening' },
        { id: 'slide-2', kind: 'still', stillId: 'still-1', showAnnotations: false },
      ],
      transitions: [{ mode: 'cut' }],
    }));
    expect(result.id).toBe('pres-1');
    expect(result.slides).toHaveLength(2);
    expect(result.transitions).toHaveLength(1);
  });

  it('throws on invalid shape', () => {
    expect(() => migratePresentationSchema(null)).toThrow('not an object');
    expect(() => migratePresentationSchema({ id: 'x' })).toThrow('missing or invalid schema');
    expect(() => migratePresentationSchema({ schema: 999 })).toThrow('newer than supported');
  });

  it('normalizes transition length to slides.length - 1', () => {
    const result = migratePresentationSchema(makePresentation({
      slides: [
        { id: 'slide-1', kind: 'title', template: 'title', title: 'A' },
        { id: 'slide-2', kind: 'title', template: 'section', title: 'B' },
        { id: 'slide-3', kind: 'title', template: 'divider', title: 'C' },
      ],
      transitions: [{ mode: 'cut' }],
    }));
    expect(result.transitions).toEqual([{ mode: 'cut' }, { mode: 'cut' }]);
  });
});

describe('read/write/list/delete presentation', () => {
  it('writes and reads a presentation', async () => {
    const { root, storage } = createMockFS({});
    const presentation = makePresentation();
    await writePresentation(root, presentation);
    expect(storage.presentations['presentation-pres-1.json']).toBeDefined();
    const roundTrip = await readPresentation(root, 'pres-1');
    expect(roundTrip?.name).toBe('Presentation 1');
  });

  it('lists presentations sorted by updatedAt descending', async () => {
    const first = makePresentation({ id: 'first', name: 'First', updatedAt: '2026-03-08T00:00:00.000Z' });
    const second = makePresentation({ id: 'second', name: 'Second', updatedAt: '2026-03-09T00:00:00.000Z' });
    const { root } = createMockFS({
      presentations: {
        'presentation-first.json': JSON.stringify(first),
        'presentation-second.json': JSON.stringify(second),
      },
    });
    const result = await listPresentations(root);
    expect(result.map((presentation) => presentation.id)).toEqual(['second', 'first']);
  });

  it('skips invalid presentation files', async () => {
    const good = makePresentation();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root } = createMockFS({
      presentations: {
        'presentation-pres-1.json': JSON.stringify(good),
        'presentation-bad.json': '{ nope',
      },
    });
    const result = await listPresentations(root);
    expect(result).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('deletes a presentation file', async () => {
    const presentation = makePresentation();
    const { root, storage } = createMockFS({
      presentations: {
        'presentation-pres-1.json': JSON.stringify(presentation),
      },
    });
    await deletePresentation(root, 'pres-1');
    expect(storage.presentations['presentation-pres-1.json']).toBeUndefined();
  });
});

describe('renamePresentation / duplicatePresentation', () => {
  it('renames an existing presentation and updates updatedAt', async () => {
    const { root } = createMockFS({
      presentations: {
        'presentation-pres-1.json': JSON.stringify(makePresentation()),
      },
    });
    const now = new Date('2026-03-10T00:00:00.000Z');
    const renamed = await renamePresentation(root, 'pres-1', 'Renamed', now);
    expect(renamed?.name).toBe('Renamed');
    expect(renamed?.updatedAt).toBe(now.toISOString());
  });

  it('duplicates an existing presentation under a new id and name', async () => {
    const { root } = createMockFS({
      presentations: {
        'presentation-pres-1.json': JSON.stringify(makePresentation({ slides: [{ id: 'slide-1', kind: 'title', template: 'title', title: 'Hello' }] })),
      },
    });
    const now = new Date('2026-03-10T00:00:00.000Z');
    const duplicated = await duplicatePresentation(root, 'pres-1', 'pres-2', 'Copy', now);
    expect(duplicated?.id).toBe('pres-2');
    expect(duplicated?.name).toBe('Copy');
    expect(duplicated?.slides).toHaveLength(1);
    const listed = await listPresentations(root);
    expect(listed.map((presentation) => presentation.id)).toContain('pres-2');
  });
});
