import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { validateRelativePath } from './project-store.mjs';

const locks = new Map();
export function serialized(key, operation) {
  const result = (locks.get(key) ?? Promise.resolve()).then(operation);
  const tail = result.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return result;
}

function nativeError(error) {
  const names = { NOT_FOUND: 'NotFoundError', INVALID_PATH: 'TypeMismatchError', PERMISSION_DENIED: 'NotAllowedError', NOT_EMPTY: 'InvalidModificationError' };
  if (names[error.code]) return new DOMException(error.message, names[error.code]);
  return error;
}
async function checked(operation) { try { return await operation(); } catch (error) { throw nativeError(error); } }

/** Shared repository implementation backed by real native files, not renderer RPC. */
export function repositoryDirectory(store, projectId, relative = '', displayName = 'Project') {
  const join = (name) => {
    if (validateRelativePath(name).length !== 1) throw new Error('Expected a filename.');
    return relative ? `${relative}/${name}` : name;
  };
  const file = (name) => {
    const relativeFile = join(name);
    return {
      kind: 'file', name,
      getFile: () => checked(async () => {
        const absolute = await store.resolvePath(projectId, relativeFile);
        const blob = await openAsBlob(absolute);
        return new File([blob], name);
      }),
      async createWritable() {
        let closed = false;
        const chunks = [];
        return {
          async write(data) { if (closed) throw new Error('Writer closed.'); chunks.push(data); },
          async close() {
            if (closed) throw new Error('Writer closed.');
            closed = true;
            await checked(() => store.writeBlob(projectId, relativeFile, new Blob(chunks)));
          },
        };
      },
    };
  };
  return {
    scopeId: projectId, kind: 'directory', name: relative ? path.posix.basename(relative) : displayName,
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    withLock: (name, _mode, operation) => serialized(name, operation),
    getDirectoryHandle: (name, options) => checked(async () => {
      const child = join(name);
      if (options?.create) await store.ensureDirectory(projectId, child);
      if ((await store.statPath(projectId, child)).kind !== 'directory') throw new DOMException('Expected a directory.', 'TypeMismatchError');
      return repositoryDirectory(store, projectId, child, name);
    }),
    getFileHandle: (name, options) => checked(async () => {
      const child = join(name);
      if (options?.create) await store.ensureFile(projectId, child);
      if ((await store.statPath(projectId, child)).kind !== 'file') throw new DOMException('Expected a file.', 'TypeMismatchError');
      return file(name);
    }),
    async *entries() {
      for (const entry of await checked(() => store.listDirectory(projectId, relative))) {
        if (entry.kind === 'link') throw new Error('Links inside projects are not supported.');
        yield [entry.name, entry.kind === 'directory' ? repositoryDirectory(store, projectId, join(entry.name), entry.name) : file(entry.name)];
      }
    },
    removeEntry: (name, options) => checked(() => store.removePath(projectId, join(name), options?.recursive)),
  };
}
