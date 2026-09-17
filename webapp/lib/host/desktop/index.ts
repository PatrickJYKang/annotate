import type { AppHost, EditorTarget, ProjectDirectory, ProjectFile } from '../contracts';
import { desktopBridge, type DirectoryToken } from './bridge';
import { assertSafePathSegment } from '../../fs/fsAccess';
import { bindNativeFile } from '../media';

interface FileDescription { id: string; url: string; size: number; name: string; modified: number; bytes?: number[] }

async function fileFromDescription(info: FileDescription): Promise<File> {
  if (info.bytes) return new File([new Uint8Array(info.bytes)], info.name, { lastModified: info.modified });
  // Metadata-only media capability. URL, CV registration, and native import bypass Blob copying.
  const file = new File([], info.name, { lastModified: info.modified });
  Object.defineProperty(file, 'size', { value: info.size });
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.reject(new Error('Use the native media stream, not a whole-file read.')) });
  Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('Use the native media stream.')) });
  for (const method of ['stream', 'slice']) Object.defineProperty(file, method, { value: () => { throw new Error('Use the native media stream.'); } });
  bindNativeFile(file, { ...info, register: () => desktopBridge().request('media.register', { fileId: info.id }) });
  return file;
}

export function nativeDirectory(token: DirectoryToken): ProjectDirectory {
  const child = (name: string) => {
    assertSafePathSegment(name);
    return { ...token, path: token.path ? `${token.path}/${name}` : name, name };
  };
  const request = <T,>(operation: string, input = {}) => desktopBridge().request<T>(operation, { ...token, ...input });
  const file = (entry: DirectoryToken): ProjectFile => ({
    kind: 'file', name: entry.name,
    getFile: async () => fileFromDescription(await desktopBridge().request<FileDescription>('fs.file', entry)),
    async createWritable() {
      let closed = false;
      const parts: BlobPart[] = [];
      return {
        async write(data) {
          if (closed) throw new Error('Writer is closed.');
          parts.push(data as BlobPart);
          if (new Blob(parts).size > 64 * 1024 * 1024) throw new Error('Use native import for large files.');
        },
        async close() {
          if (closed) throw new Error('Writer is closed.');
          closed = true;
          const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
          await desktopBridge().request('fs.write', { ...entry, bytes });
        },
      };
    },
  });
  const directory: ProjectDirectory = {
    scopeId: token.id, kind: 'directory', name: token.name,
    command: (name, args) => request('project.command', { command: name, args }),
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    async getDirectoryHandle(name, options) {
      const entry = child(name);
      await desktopBridge().request('fs.ensure', { ...entry, kind: 'directory', create: options?.create ?? false });
      return nativeDirectory(entry);
    },
    async getFileHandle(name, options) {
      const entry = child(name);
      await desktopBridge().request('fs.ensure', { ...entry, kind: 'file', create: options?.create ?? false });
      return file(entry);
    },
    async *entries() {
      const entries = await request<Array<{ name: string; kind: string }>>('fs.list');
      for (const entry of entries) {
        if (entry.kind === 'link') throw new Error('Links inside projects are not supported.');
        yield [entry.name, entry.kind === 'directory' ? nativeDirectory(child(entry.name)) : file(child(entry.name))];
      }
    },
    removeEntry: (name, options) => desktopBridge().request('fs.remove', { ...child(name), recursive: options?.recursive ?? false }),
  };
  tokens.set(directory, token);
  return directory;
}

function projectToken(project: ProjectDirectory): DirectoryToken {
  const token = tokens.get(project);
  if (!token) throw new Error('Unknown native directory.');
  return token;
}
const tokens = new WeakMap<ProjectDirectory, DirectoryToken>();
const trackedDirectory = nativeDirectory;

export const desktopHost: AppHost = {
  kind: 'desktop',
  files: {
    canPickDirectory: true, canPickVideo: true, canUseScratchStorage: false,
    async pickDirectory() { return trackedDirectory(await desktopBridge().request('dialog.directory')); },
    async pickVideo() {
      const info = await desktopBridge().request<FileDescription | null>('dialog.video');
      return info ? fileFromDescription(info) : null;
    },
    async getScratchDirectory() { throw new Error('Quick Annotate scratch storage is not available in desktop mode yet.'); },
  },
  projects: {
    async remember(directory) { return trackedDirectory(await desktopBridge().request('project.remember', projectToken(directory))); },
    async restore() {
      const token = await desktopBridge().request<DirectoryToken | null>('project.restore');
      return token ? trackedDirectory(token) : null;
    },
    async forget(options) { await desktopBridge().request('project.forget', options); },
  },
  editors: {
    open(project, target) { void desktopBridge().request('editor.open', { ...projectToken(project), target }); },
    reserve(project) {
      // Native windows do not require browser user-activation reservations.
      let closed = false;
      return { navigate(target: EditorTarget) { if (!closed) desktopHost.editors.open(project, target); }, close() { closed = true; } };
    },
    closeCurrent() { void desktopBridge().request('window.close'); },
  },
};
