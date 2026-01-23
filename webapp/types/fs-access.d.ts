// Minimal File System Access API types (Chromium-only)
// This is not exhaustive; just enough for our usage in D1

declare function showDirectoryPicker(options?: any): Promise<FileSystemDirectoryHandle>;

declare interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
  queryPermission(descriptor?: any): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(descriptor?: any): Promise<'granted' | 'denied' | 'prompt'>;
}

declare interface FileSystemWritableFileStream extends WritableStream {
  write(data: FileSystemWriteChunkType): Promise<void>;
  close(): Promise<void>;
}

declare type FileSystemWriteChunkType = BufferSource | Blob | string | {
  type: 'write' | 'seek' | 'truncate';
  data?: any;
  position?: number;
  size?: number;
};

declare interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

declare interface FileSystemDirectoryHandle extends FileSystemHandle {
  kind: 'directory';
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
}
