import type { ProjectDirectory, ProjectFile } from '../contracts';
import { assertSafePathSegment } from '../../fs/fsAccess';

const directories = new WeakMap<FileSystemDirectoryHandle, Map<string, ProjectDirectory>>();
const nativeDirectories = new WeakMap<ProjectDirectory, FileSystemDirectoryHandle>();

function wrapFile(handle: FileSystemFileHandle): ProjectFile {
  return {
    kind: 'file',
    name: handle.name,
    getFile: () => handle.getFile(),
    async createWritable() {
      const stream = await handle.createWritable();
      return {
        write: (data) => stream.write(data),
        close: () => stream.close(),
      };
    },
  };
}

export function wrapBrowserDirectory(handle: FileSystemDirectoryHandle, scopeId?: string): ProjectDirectory {
  const known = directories.get(handle) ?? new Map<string, ProjectDirectory>();
  scopeId ??= known.keys().next().value ?? crypto.randomUUID();
  const existing = known.get(scopeId);
  if (existing) return existing;
  const directory: ProjectDirectory = {
    scopeId,
    kind: 'directory',
    name: handle.name,
    queryPermission: (options) => handle.queryPermission?.(options) ?? Promise.resolve('granted'),
    requestPermission: (options) => handle.requestPermission?.(options) ?? Promise.resolve('denied'),
    async getDirectoryHandle(name, options) {
      assertSafePathSegment(name);
      return wrapBrowserDirectory(await handle.getDirectoryHandle(name, options), scopeId);
    },
    async getFileHandle(name, options) {
      assertSafePathSegment(name);
      return wrapFile(await handle.getFileHandle(name, options));
    },
    async *entries() {
      for await (const [name, child] of handle.entries()) {
        yield [name, child.kind === 'directory' ? wrapBrowserDirectory(child, scopeId) : wrapFile(child)];
      }
    },
    async removeEntry(name, options) {
      assertSafePathSegment(name);
      await handle.removeEntry(name, options);
    },
  };
  known.set(scopeId, directory);
  directories.set(handle, known);
  nativeDirectories.set(directory, handle);
  return directory;
}

/** Only the browser bookmark store may persist the underlying structured-cloneable handle. */
export function unwrapBrowserDirectory(directory: ProjectDirectory): FileSystemDirectoryHandle {
  const handle = nativeDirectories.get(directory);
  if (!handle) throw new Error('This project directory does not belong to the browser host.');
  return handle;
}
