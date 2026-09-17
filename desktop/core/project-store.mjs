import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, readdir, rename, unlink, mkdir, link, rm } from 'node:fs/promises';
import path from 'node:path';

const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const MAX_READ_BYTES = 1024 * 1024;

export class ProjectStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProjectStoreError';
    this.code = code;
    Object.assign(this, details);
  }
}

export function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\')) {
    throw new ProjectStoreError('INVALID_PATH', 'A project-relative path is required.');
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[<>:"|?*\x00-\x1f]/.test(segment) || /[ .]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) {
      throw new ProjectStoreError('INVALID_PATH', 'The path is not a portable project filename.');
    }
  }
  return segments;
}

function revision(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function translateError(error) {
  if (error instanceof ProjectStoreError) return error;
  const codes = { ENOENT: 'NOT_FOUND', EACCES: 'PERMISSION_DENIED', EPERM: 'PERMISSION_DENIED', ENOSPC: 'DISK_FULL', EROFS: 'READ_ONLY', ENOTDIR: 'INVALID_PATH', ELOOP: 'UNSAFE_LINK' };
  // Do not leak absolute filesystem paths through native exception messages.
  return new ProjectStoreError(codes[error?.code] ?? 'IO_ERROR', `Project filesystem operation failed (${error?.code ?? 'unknown'}).`);
}

/** Trusted-process service. registerProject is called by native dialogs, never by renderer IPC. */
export class NativeProjectStore {
  #projects = new Map();
  #files = new Map();

  async registerProject(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new ProjectStoreError('INVALID_PATH', 'Choose an absolute project folder.');
    try {
      const root = await realpath(directory);
      const stat = await lstat(root);
      if (!stat.isDirectory()) throw new ProjectStoreError('INVALID_PATH', 'Choose a project folder.');
      for (const [id, project] of this.#projects) {
        if (project.root === root && !project.closing) return { id, name: path.basename(root) };
      }
      const id = randomUUID();
      this.#projects.set(id, { root, dev: stat.dev, ino: stat.ino, tail: Promise.resolve(), closing: false, streams: new Set() });
      return { id, name: path.basename(root) };
    } catch (error) { throw translateError(error); }
  }

  #project(id) {
    const project = this.#projects.get(id);
    if (!project || project.closing) throw new ProjectStoreError('SESSION_CLOSED', 'The project session is closed.');
    return project;
  }

  async #run(id, operation) {
    const project = this.#project(id);
    const result = project.tail.then(async () => {
      const root = await lstat(project.root);
      if (!root.isDirectory() || root.dev !== project.dev || root.ino !== project.ino || await realpath(project.root) !== project.root) {
        throw new ProjectStoreError('SESSION_CHANGED', 'The project folder changed. Reopen it.');
      }
      return operation(project);
    });
    project.tail = result.catch(() => undefined);
    try { return await result; } catch (error) { throw translateError(error); }
  }

  async #resolve(project, relative, { createParents = false, allowMissing = false } = {}) {
    const segments = validateRelativePath(relative);
    // Reject a project root that has been replaced by a symlink after authorization.
    if ((await lstat(project.root)).isSymbolicLink() || await realpath(project.root) !== project.root) {
      throw new ProjectStoreError('UNSAFE_LINK', 'The project folder has changed. Reopen it.');
    }
    let current = project.root;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const names = await readdir(current);
      const folded = segment.normalize('NFC').toLowerCase();
      if (names.some((name) => name !== segment && name.normalize('NFC').toLowerCase() === folded)) {
        throw new ProjectStoreError('NAME_COLLISION', 'The filename collides with an existing case or Unicode variant.');
      }
      current = path.join(current, segment);
      let stat;
      try { stat = await lstat(current); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (index < segments.length - 1 && createParents) {
          await mkdir(current);
          stat = await lstat(current);
        } else if (index === segments.length - 1 && allowMissing) return current;
        else throw error;
      }
      if (stat.isSymbolicLink()) throw new ProjectStoreError('UNSAFE_LINK', 'Links inside project paths are not allowed.');
      if (index < segments.length - 1 && !stat.isDirectory()) throw new ProjectStoreError('INVALID_PATH', 'A path parent is not a directory.');
    }
    return current;
  }

  async #readDocument(project, relative) {
    const target = await this.#resolve(project, relative);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new ProjectStoreError('INVALID_PATH', 'The document is not a file.');
      if (stat.size > MAX_DOCUMENT_BYTES) throw new ProjectStoreError('TOO_LARGE', 'The document exceeds the size limit.');
      // Read one extra byte to detect a concurrently growing file without unbounded allocation.
      const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_DOCUMENT_BYTES + 1));
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const next = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
        if (!next.bytesRead) break;
        bytesRead += next.bytesRead;
      }
      const after = await handle.stat();
      if (bytesRead !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
        throw new ProjectStoreError('CONFLICT', 'The document changed during reading.');
      }
      const content = bytes.subarray(0, bytesRead);
      return { text: content.toString('utf8'), revision: revision(content) };
    } finally { await handle.close(); }
  }

  readDocument(projectId, relative) {
    return this.#run(projectId, (project) => this.#readDocument(project, relative));
  }

  // Trusted repository adapter only; these methods are never exposed as arbitrary IPC writes.
  resolvePath(projectId, relative = '') {
    return this.#run(projectId, async (project) => relative ? this.#resolve(project, relative) : project.root);
  }

  statPath(projectId, relative = '') {
    return this.#run(projectId, async (project) => {
      const stat = await lstat(relative ? await this.#resolve(project, relative) : project.root);
      return { kind: stat.isDirectory() ? 'directory' : 'file', size: stat.size, modified: stat.mtimeMs };
    });
  }

  ensureDirectory(projectId, relative) {
    return this.#run(projectId, async (project) => {
      const target = await this.#resolve(project, relative, { createParents: true, allowMissing: true });
      await mkdir(target).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      if (!(await lstat(target)).isDirectory()) throw new ProjectStoreError('INVALID_PATH', 'Expected a directory.');
    });
  }

  ensureFile(projectId, relative) {
    return this.#run(projectId, async (project) => {
      const target = await this.#resolve(project, relative, { allowMissing: true });
      try { await (await open(target, 'wx', 0o600)).close(); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!(await lstat(target)).isFile()) throw new ProjectStoreError('INVALID_PATH', 'Expected a regular file.');
    });
  }

  writeBlob(projectId, relative, data, { signal, onProgress } = {}) {
    return this.#run(projectId, async (project) => {
      const target = await this.#resolve(project, relative, { allowMissing: true });
      const temporary = path.join(path.dirname(target), `.annotate-${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        if (data instanceof Blob) {
          let written = 0;
          for await (const bytes of data.stream()) {
            signal?.throwIfAborted();
            await handle.writeFile(bytes);
            written += bytes.byteLength;
            onProgress?.(written / data.size);
          }
        } else await handle.writeFile(data);
        signal?.throwIfAborted();
        await handle.sync();
        await handle.close();
        await this.#resolve(project, relative, { allowMissing: true });
        await rename(temporary, target);
      } finally {
        await handle.close().catch(() => undefined);
        await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
    });
  }

  removePath(projectId, relative, recursive = false) {
    return this.#run(projectId, async (project) => {
      const target = await this.#resolve(project, relative);
      if (!recursive && (await lstat(target)).isDirectory() && (await readdir(target)).length) {
        throw new ProjectStoreError('NOT_EMPTY', 'The directory is not empty.');
      }
      await rm(target, { recursive: true });
    });
  }

  replaceDocument(projectId, relative, { document, expectedRevision }) {
    return this.#run(projectId, async (project) => {
      validateRelativePath(relative);
      if (!relative.endsWith('.json')) throw new ProjectStoreError('INVALID_PATH', 'Document writes require a JSON filename.');
      if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision))) {
        throw new ProjectStoreError('INVALID_REVISION', 'Provide the current revision, or null to create a document.');
      }
      const serialized = JSON.stringify(document, null, 2);
      if (serialized === undefined) throw new ProjectStoreError('INVALID_DOCUMENT', 'A JSON document is required.');
      const bytes = Buffer.from(serialized);
      if (bytes.length > MAX_DOCUMENT_BYTES) throw new ProjectStoreError('TOO_LARGE', 'The document exceeds the size limit.');
      let existing = null;
      try { existing = await this.#readDocument(project, relative); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if ((existing?.revision ?? null) !== expectedRevision) {
        throw new ProjectStoreError('CONFLICT', 'This document changed in another editor. Reload before saving.', { currentRevision: existing?.revision ?? null });
      }
      const target = await this.#resolve(project, relative, { createParents: true, allowMissing: true });
      const temporary = path.join(path.dirname(target), `.annotate-${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = null;
        await this.#resolve(project, relative, { allowMissing: true });
        if (expectedRevision === null) {
          // link is create-only: an external file arriving here must not be overwritten.
          try { await link(temporary, target); } catch (error) {
            if (error.code === 'EEXIST') throw new ProjectStoreError('CONFLICT', 'The document already exists.');
            throw error;
          }
        } else await rename(temporary, target);
        return { revision: revision(bytes) };
      } finally {
        await handle?.close().catch(() => undefined);
        await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
    });
  }

  listDirectory(projectId, relative = '') {
    return this.#run(projectId, async (project) => {
      const directory = relative ? await this.#resolve(project, relative) : project.root;
      return (await readdir(directory, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file',
      }));
    });
  }

  authorizeFile(projectId, relative) {
    return this.#run(projectId, async (project) => {
      const target = await this.#resolve(project, relative);
      const stat = await lstat(target);
      if (!stat.isFile()) throw new ProjectStoreError('INVALID_PATH', 'Select a regular file.');
      const id = randomUUID();
      this.#files.set(id, { projectId, relative, streams: new Set() });
      return { id, size: stat.size, name: path.basename(relative) };
    });
  }

  releaseFile(fileId) {
    for (const stream of this.#files.get(fileId)?.streams ?? []) stream.destroy();
    this.#files.delete(fileId);
  }

  #requireFile(fileId, expected) {
    if (this.#files.get(fileId) !== expected) throw new ProjectStoreError('FILE_UNAVAILABLE', 'The file capability was revoked.');
  }

  fileInfo(fileId) {
    const file = this.#files.get(fileId);
    if (!file) return Promise.reject(new ProjectStoreError('FILE_UNAVAILABLE', 'The file capability is unavailable.'));
    return this.#run(file.projectId, async (project) => {
      this.#requireFile(fileId, file);
      const stat = await lstat(await this.#resolve(project, file.relative));
      if (!stat.isFile()) throw new ProjectStoreError('INVALID_PATH', 'The media is not a regular file.');
      this.#requireFile(fileId, file);
      return { size: stat.size, name: path.basename(file.relative) };
    });
  }

  async readRange(fileId, start, length) {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_READ_BYTES) {
      throw new ProjectStoreError('INVALID_RANGE', 'Invalid or oversized read range.');
    }
    const file = this.#files.get(fileId);
    if (!file) throw new ProjectStoreError('FILE_UNAVAILABLE', 'The file capability is unavailable.');
    return this.#run(file.projectId, async (project) => {
      this.#requireFile(fileId, file);
      const handle = await open(await this.#resolve(project, file.relative), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await handle.read(bytes, 0, length, start);
        this.#requireFile(fileId, file);
        return bytes.subarray(0, bytesRead);
      } finally { await handle.close(); }
    });
  }

  /** Streams stay in the trusted process and must never be passed through IPC. */
  async openReadStream(fileId, start = 0, end) {
    const file = this.#files.get(fileId);
    if (!file) throw new ProjectStoreError('FILE_UNAVAILABLE', 'The file capability is unavailable.');
    return this.#run(file.projectId, async (project) => {
      this.#requireFile(fileId, file);
      const handle = await open(await this.#resolve(project, file.relative), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        end ??= stat.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= stat.size || !stat.isFile()) {
          throw new ProjectStoreError('INVALID_RANGE', 'The file range is unavailable.');
        }
        this.#requireFile(fileId, file);
        const stream = handle.createReadStream({ start, end, autoClose: true });
        project.streams.add(stream);
        file.streams.add(stream);
        stream.once('close', () => { project.streams.delete(stream); file.streams.delete(stream); });
        return { stream, size: stat.size, length: end - start + 1 };
      } catch (error) { await handle.close(); throw error; }
    });
  }

  async closeProject(id) {
    const project = this.#project(id);
    project.closing = true;
    await project.tail;
    for (const stream of project.streams) stream.destroy();
    for (const [fileId, file] of this.#files) if (file.projectId === id) this.#files.delete(fileId);
    this.#projects.delete(id);
  }

  async close() {
    for (const id of [...this.#projects.keys()]) await this.closeProject(id);
  }
}
