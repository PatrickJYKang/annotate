import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

type SerializedFixtureDirectory = {
  kind: 'directory';
  name: string;
  entries: SerializedFixtureEntry[];
};

type SerializedFixtureFile = {
  kind: 'file';
  name: string;
  mimeType: string;
  lastModified: number;
  base64: string;
};

type SerializedFixtureEntry = SerializedFixtureDirectory | SerializedFixtureFile;

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.mp4':
      return 'video/mp4';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webm':
      return 'video/webm';
    case '.txt':
    case '.md':
    case '.gitkeep':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

async function serializeFixtureEntry(entryPath: string): Promise<SerializedFixtureEntry> {
  const entryStat = await stat(entryPath);
  const name = path.basename(entryPath);
  if (entryStat.isDirectory()) {
    const childNames = (await readdir(entryPath)).sort((left, right) => left.localeCompare(right));
    const entries = await Promise.all(
      childNames.map(async (childName) => serializeFixtureEntry(path.join(entryPath, childName))),
    );
    return {
      kind: 'directory',
      name,
      entries,
    };
  }

  const contents = await readFile(entryPath);
  return {
    kind: 'file',
    name,
    mimeType: inferMimeType(entryPath),
    lastModified: entryStat.mtimeMs,
    base64: contents.toString('base64'),
  };
}

export async function installDirectoryPickerFixture(page: Page, fixturePath: string): Promise<void> {
  const absoluteFixturePath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.resolve(fixturePath);
  const storageKey = `playwright-fs-fixture:${absoluteFixturePath}`;
  const serializedRoot = await serializeFixtureEntry(absoluteFixturePath);
  if (serializedRoot.kind !== 'directory') {
    throw new Error(`Fixture path is not a directory: ${absoluteFixturePath}`);
  }

  await page.addInitScript((root: SerializedFixtureDirectory, fixtureStorageKey: string) => {
    type BrowserFixtureDirectory = {
      kind: 'directory';
      name: string;
      entries: Map<string, BrowserFixtureEntry>;
    };

    type BrowserFixtureFile = {
      kind: 'file';
      name: string;
      mimeType: string;
      lastModified: number;
      bytes: Uint8Array;
    };

    type BrowserFixtureEntry = BrowserFixtureDirectory | BrowserFixtureFile;

    const decodeBase64 = (value: string): Uint8Array => {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    };
    const encodeBase64 = (value: Uint8Array): string => {
      let binary = '';
      value.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return btoa(binary);
    };

    const encodeText = (value: string): Uint8Array => new TextEncoder().encode(value);

    const toUint8Array = async (value: unknown): Promise<Uint8Array> => {
      if (typeof value === 'string') {
        return encodeText(value);
      }
      if (value instanceof Blob) {
        return new Uint8Array(await value.arrayBuffer());
      }
      if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
      }
      if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      }
      throw new Error(`Unsupported writable payload: ${String(value)}`);
    };

    const notFoundError = (message: string) => {
      const error = new Error(message) as Error & { name: string };
      error.name = 'NotFoundError';
      return error;
    };

    const hydrateEntry = (entry: SerializedFixtureEntry): BrowserFixtureEntry => {
      if (entry.kind === 'file') {
        return {
          kind: 'file',
          name: entry.name,
          mimeType: entry.mimeType,
          lastModified: entry.lastModified,
          bytes: decodeBase64(entry.base64),
        };
      }
      return {
        kind: 'directory',
        name: entry.name,
        entries: new Map(entry.entries.map((child) => [child.name, hydrateEntry(child)])),
      };
    };

    const serializeEntry = (entry: BrowserFixtureEntry): SerializedFixtureEntry => {
      if (entry.kind === 'file') {
        return {
          kind: 'file',
          name: entry.name,
          mimeType: entry.mimeType,
          lastModified: entry.lastModified,
          base64: encodeBase64(entry.bytes),
        };
      }
      return {
        kind: 'directory',
        name: entry.name,
        entries: Array.from(entry.entries.values())
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((child) => serializeEntry(child)),
      };
    };

    const storedRoot = (() => {
      try {
        const raw = sessionStorage.getItem(fixtureStorageKey);
        if (!raw) return null;
        return JSON.parse(raw) as SerializedFixtureDirectory;
      } catch {
        return null;
      }
    })();
    const rootNode = hydrateEntry(storedRoot ?? root) as BrowserFixtureDirectory;
    const persistFixture = () => {
      try {
        sessionStorage.setItem(fixtureStorageKey, JSON.stringify(serializeEntry(rootNode)));
      } catch {
      }
    };
    persistFixture();

    class MockWritableFileStream {
      private fileNode: BrowserFixtureFile;
      private chunks: Uint8Array[] = [];

      constructor(fileNode: BrowserFixtureFile) {
        this.fileNode = fileNode;
      }

      async write(value: unknown): Promise<void> {
        if (
          value
          && typeof value === 'object'
          && 'type' in value
          && (value as { type?: string }).type === 'write'
          && 'data' in (value as { data?: unknown })
        ) {
          this.chunks.push(await toUint8Array((value as { data?: unknown }).data));
          return;
        }
        this.chunks.push(await toUint8Array(value));
      }

      async close(): Promise<void> {
        const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const bytes = new Uint8Array(totalLength);
        let offset = 0;
        this.chunks.forEach((chunk) => {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        });
        this.fileNode.bytes = bytes;
        this.fileNode.lastModified = Date.now();
        persistFixture();
      }
    }

    class MockFileHandle implements FileSystemFileHandle {
      readonly kind = 'file' as const;
      readonly name: string;
      readonly fileNode: BrowserFixtureFile;

      constructor(fileNode: BrowserFixtureFile) {
        this.fileNode = fileNode;
        this.name = fileNode.name;
      }

      async getFile(): Promise<File> {
        const normalizedBytes = new Uint8Array(this.fileNode.bytes.byteLength);
        normalizedBytes.set(this.fileNode.bytes);
        return new File([normalizedBytes], this.fileNode.name, {
          type: this.fileNode.mimeType,
          lastModified: this.fileNode.lastModified,
        });
      }

      async createWritable(): Promise<FileSystemWritableFileStream> {
        return new MockWritableFileStream(this.fileNode) as unknown as FileSystemWritableFileStream;
      }

      async queryPermission(): Promise<PermissionState> {
        return 'granted';
      }

      async requestPermission(): Promise<PermissionState> {
        return 'granted';
      }

      async isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return other instanceof MockFileHandle && other.fileNode === this.fileNode;
      }
    }

    class MockDirectoryHandle implements FileSystemDirectoryHandle {
      readonly kind = 'directory' as const;
      readonly name: string;
      private directoryNode: BrowserFixtureDirectory;

      constructor(directoryNode: BrowserFixtureDirectory) {
        this.directoryNode = directoryNode;
        this.name = directoryNode.name;
      }

      async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
        const existing = this.directoryNode.entries.get(name);
        if (existing?.kind === 'directory') {
          return new MockDirectoryHandle(existing);
        }
        if (existing?.kind === 'file') {
          throw notFoundError(`Directory not found: ${name}`);
        }
        if (options?.create) {
          const created: BrowserFixtureDirectory = {
            kind: 'directory',
            name,
            entries: new Map(),
          };
          this.directoryNode.entries.set(name, created);
          persistFixture();
          return new MockDirectoryHandle(created);
        }
        throw notFoundError(`Directory not found: ${name}`);
      }

      async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
        const existing = this.directoryNode.entries.get(name);
        if (existing?.kind === 'file') {
          return new MockFileHandle(existing);
        }
        if (existing?.kind === 'directory') {
          throw notFoundError(`File not found: ${name}`);
        }
        if (options?.create) {
          const created: BrowserFixtureFile = {
            kind: 'file',
            name,
            mimeType: inferFixtureMimeType(name),
            lastModified: Date.now(),
            bytes: new Uint8Array(),
          };
          this.directoryNode.entries.set(name, created);
          persistFixture();
          return new MockFileHandle(created);
        }
        throw notFoundError(`File not found: ${name}`);
      }

      async removeEntry(name: string): Promise<void> {
        if (!this.directoryNode.entries.has(name)) {
          throw notFoundError(`Entry not found: ${name}`);
        }
        this.directoryNode.entries.delete(name);
        persistFixture();
      }

      async *entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]> {
        const sortedEntries = Array.from(this.directoryNode.entries.entries()).sort(([left], [right]) => left.localeCompare(right));
        for (const [name, entry] of sortedEntries) {
          yield [name, entry.kind === 'directory' ? new MockDirectoryHandle(entry) : new MockFileHandle(entry)];
        }
      }

      async queryPermission(): Promise<PermissionState> {
        return 'granted';
      }

      async requestPermission(): Promise<PermissionState> {
        return 'granted';
      }

      async isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return other instanceof MockDirectoryHandle && other.directoryNode === this.directoryNode;
      }

      async *keys(): AsyncIterableIterator<string> {
        const sortedEntries = Array.from(this.directoryNode.entries.keys()).sort((left, right) => left.localeCompare(right));
        for (const name of sortedEntries) {
          yield name;
        }
      }

      async *values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle> {
        const sortedEntries = Array.from(this.directoryNode.entries.entries()).sort(([left], [right]) => left.localeCompare(right));
        for (const [, entry] of sortedEntries) {
          yield entry.kind === 'directory' ? new MockDirectoryHandle(entry) : new MockFileHandle(entry);
        }
      }

      async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
        if (possibleDescendant instanceof MockDirectoryHandle && possibleDescendant.directoryNode === this.directoryNode) {
          return [];
        }

        const visit = (
          current: BrowserFixtureDirectory,
          target: FileSystemHandle,
          segments: string[],
        ): string[] | null => {
          for (const [entryName, entry] of current.entries.entries()) {
            if (target instanceof MockDirectoryHandle && entry.kind === 'directory' && target.directoryNode === entry) {
              return [...segments, entryName];
            }
            if (target instanceof MockFileHandle && entry.kind === 'file' && target.fileNode === entry) {
              return [...segments, entryName];
            }
            if (entry.kind === 'directory') {
              const nested = visit(entry, target, [...segments, entryName]);
              if (nested) {
                return nested;
              }
            }
          }
          return null;
        };

        return visit(this.directoryNode, possibleDescendant, []);
      }

      [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]> {
        return this.entries();
      }
    }

    const inferFixtureMimeType = (fileName: string): string => {
      const lower = fileName.toLowerCase();
      if (lower.endsWith('.json')) return 'application/json';
      if (lower.endsWith('.mp4')) return 'video/mp4';
      if (lower.endsWith('.png')) return 'image/png';
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
      if (lower.endsWith('.webm')) return 'video/webm';
      return 'application/octet-stream';
    };

    const projectHandle = new MockDirectoryHandle(rootNode);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => projectHandle,
    });
    (window as Window & { __playwrightProjectHandle?: FileSystemDirectoryHandle }).__playwrightProjectHandle = projectHandle;
  }, serializedRoot, storageKey);
}
