type MockFileNode = {
  kind: 'file';
  bytes: ArrayBuffer;
  lastModified: number;
};

type MockDirectoryNode = {
  kind: 'directory';
  children: Map<string, MockNode>;
};

type MockNode = MockFileNode | MockDirectoryNode;

export interface MockFileSystemOptions {
  onWrite?: (path: string) => void | Promise<void>;
  onRemove?: (path: string, recursive: boolean) => void | Promise<void>;
}

function fsError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

function copyView(value: ArrayBufferView): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy.buffer;
}

function encode(value: string | ArrayBuffer | ArrayBufferView | Blob): Promise<ArrayBuffer> | ArrayBuffer {
  if (typeof value === 'string') return copyView(new TextEncoder().encode(value));
  if (value instanceof Blob) return value.arrayBuffer();
  if (ArrayBuffer.isView(value)) {
    return copyView(value);
  }
  return value.slice(0);
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export class MockFileSystem {
  private readonly rootNode: MockDirectoryNode = { kind: 'directory', children: new Map() };
  private readonly options: MockFileSystemOptions;
  readonly root: FileSystemDirectoryHandle;

  constructor(files: Record<string, string | Uint8Array> = {}, options: MockFileSystemOptions = {}) {
    this.options = options;
    this.root = this.directoryHandle('', this.rootNode);
    for (const [path, content] of Object.entries(files)) {
      this.seedFile(path, content);
    }
  }

  private seedFile(path: string, content: string | Uint8Array): void {
    const segments = split(path);
    const fileName = segments.pop();
    if (!fileName) throw new Error('Cannot seed an empty path.');
    const directory = this.ensureDirectoryNode(segments);
    directory.children.set(fileName, {
      kind: 'file',
      bytes: typeof content === 'string'
        ? copyView(new TextEncoder().encode(content))
        : copyView(content),
      lastModified: Date.now(),
    });
  }

  private ensureDirectoryNode(segments: readonly string[]): MockDirectoryNode {
    let current = this.rootNode;
    for (const segment of segments) {
      const existing = current.children.get(segment);
      if (existing?.kind === 'file') throw fsError('TypeMismatchError', `${segment} is a file.`);
      if (existing) {
        current = existing;
      } else {
        const created: MockDirectoryNode = { kind: 'directory', children: new Map() };
        current.children.set(segment, created);
        current = created;
      }
    }
    return current;
  }

  private findNode(path: string): MockNode | null {
    let current: MockNode = this.rootNode;
    for (const segment of split(path)) {
      if (current.kind !== 'directory') return null;
      const child = current.children.get(segment);
      if (!child) return null;
      current = child;
    }
    return current;
  }

  private fileHandle(path: string, name: string, node: MockFileNode): FileSystemFileHandle {
    const system = this;
    return {
      kind: 'file',
      name,
      async getFile() {
        return new File([node.bytes], name, { lastModified: node.lastModified });
      },
      async createWritable() {
        let staged = node.bytes.slice(0);
        return {
          async write(data: FileSystemWriteChunkType) {
            if (
              typeof data === 'object'
              && data !== null
              && 'type' in data
              && (data.type === 'write' || data.type === 'seek' || data.type === 'truncate')
            ) {
              throw new Error('Mock only supports whole-file writes.');
            }
            const bytes = await encode(data as string | ArrayBuffer | ArrayBufferView | Blob);
            staged = bytes;
          },
          async seek() {
            throw new Error('Mock only supports whole-file writes.');
          },
          async truncate() {
            throw new Error('Mock only supports whole-file writes.');
          },
          async close() {
            await system.options.onWrite?.(path);
            node.bytes = staged;
            node.lastModified = Date.now();
          },
          async abort() {},
        } as unknown as FileSystemWritableFileStream;
      },
      async isSameEntry(other: FileSystemHandle) {
        return other.kind === 'file' && other.name === name;
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    } as FileSystemFileHandle;
  }

  private directoryHandle(path: string, node: MockDirectoryNode): FileSystemDirectoryHandle {
    const system = this;
    const name = split(path).at(-1) ?? 'root';
    return {
      kind: 'directory',
      name,
      async getFileHandle(childName: string, options?: FileSystemGetFileOptions) {
        const childPath = path ? `${path}/${childName}` : childName;
        const existing = node.children.get(childName);
        if (existing?.kind === 'directory') throw fsError('TypeMismatchError', `${childName} is a directory.`);
        if (!existing) {
          if (!options?.create) throw fsError('NotFoundError', `${childName} does not exist.`);
          const created: MockFileNode = { kind: 'file', bytes: new ArrayBuffer(0), lastModified: Date.now() };
          node.children.set(childName, created);
          return system.fileHandle(childPath, childName, created);
        }
        return system.fileHandle(childPath, childName, existing);
      },
      async getDirectoryHandle(childName: string, options?: FileSystemGetDirectoryOptions) {
        const childPath = path ? `${path}/${childName}` : childName;
        const existing = node.children.get(childName);
        if (existing?.kind === 'file') throw fsError('TypeMismatchError', `${childName} is a file.`);
        if (!existing) {
          if (!options?.create) throw fsError('NotFoundError', `${childName} does not exist.`);
          const created: MockDirectoryNode = { kind: 'directory', children: new Map() };
          node.children.set(childName, created);
          return system.directoryHandle(childPath, created);
        }
        return system.directoryHandle(childPath, existing);
      },
      async removeEntry(childName: string, options?: FileSystemRemoveOptions) {
        const childPath = path ? `${path}/${childName}` : childName;
        const existing = node.children.get(childName);
        if (!existing) throw fsError('NotFoundError', `${childName} does not exist.`);
        if (existing.kind === 'directory' && existing.children.size > 0 && !options?.recursive) {
          throw fsError('InvalidModificationError', 'Cannot remove a non-empty directory without recursive: true.');
        }
        await system.options.onRemove?.(childPath, options?.recursive ?? false);
        node.children.delete(childName);
      },
      async resolve(possibleDescendant: FileSystemHandle) {
        const target = possibleDescendant.name;
        return node.children.has(target) ? [target] : null;
      },
      async *entries() {
        for (const [childName, child] of [...node.children.entries()]) {
          const childPath = path ? `${path}/${childName}` : childName;
          yield [
            childName,
            child.kind === 'file'
              ? system.fileHandle(childPath, childName, child)
              : system.directoryHandle(childPath, child),
          ] as [string, FileSystemFileHandle | FileSystemDirectoryHandle];
        }
      },
      async *keys() {
        for (const childName of [...node.children.keys()]) yield childName;
      },
      async *values() {
        for await (const [, handle] of this.entries()) yield handle;
      },
      [Symbol.asyncIterator]() {
        return this.entries();
      },
      async isSameEntry(other: FileSystemHandle) {
        return other.kind === 'directory' && other.name === name;
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    } as FileSystemDirectoryHandle;
  }

  async readText(path: string): Promise<string> {
    const node = this.findNode(path);
    if (!node || node.kind !== 'file') throw fsError('NotFoundError', `${path} is not a file.`);
    return new TextDecoder().decode(node.bytes);
  }

  exists(path: string): boolean {
    return this.findNode(path) !== null;
  }

  list(path = ''): string[] {
    const node = this.findNode(path);
    if (!node || node.kind !== 'directory') throw fsError('NotFoundError', `${path} is not a directory.`);
    return [...node.children.keys()].sort();
  }
}

export function createSerialLockManager(): LockManager {
  const tails = new Map<string, Promise<void>>();
  const request = async <T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    maybeCallback?: LockGrantedCallback<T>,
  ): Promise<T> => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (!callback) throw new Error('Lock callback is required.');
    const previous = tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    tails.set(name, tail);
    await previous;
    try {
      return await callback({ name, mode: 'exclusive' });
    } finally {
      release();
      if (tails.get(name) === tail) tails.delete(name);
    }
  };
  return {
    request,
    async query() {
      return { held: [], pending: [] };
    },
  } as unknown as LockManager;
}
