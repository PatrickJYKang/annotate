/** Renderer-facing file capabilities. No native handles or absolute paths escape the host. */
export interface ProjectWritable {
  write(data: string | Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectFile {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<ProjectWritable>;
}

export interface ProjectDirectory {
  /** Native renderer dispatch; callbacks stay in their owning process. */
  command?<T>(name: string, args: unknown[]): Promise<T>;
  /** Implemented only by the trusted native repository adapter. */
  withLock?<T>(name: string, mode: 'shared' | 'exclusive', operation: () => Promise<T>): Promise<T>;
  readonly scopeId: string;
  readonly kind: 'directory';
  readonly name: string;
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<ProjectDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<ProjectFile>;
  entries(): AsyncIterableIterator<[string, ProjectDirectory | ProjectFile]>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export type EditorTarget = { clipId: string; pinId?: string };

/** Reserved synchronously during a user gesture; navigation can follow an async save. */
export interface ReservedEditor {
  navigate(target: EditorTarget): void;
  close(): void;
}

export interface AppHost {
  readonly kind: 'browser' | 'desktop';
  readonly files: {
    readonly canPickDirectory: boolean;
    readonly canPickVideo: boolean;
    readonly canUseScratchStorage: boolean;
    pickDirectory(): Promise<ProjectDirectory>;
    pickVideo(description: string): Promise<File | null>;
    getScratchDirectory(name: string): Promise<ProjectDirectory>;
  };
  readonly projects: {
    remember(directory: ProjectDirectory): Promise<ProjectDirectory>;
    restore(): Promise<ProjectDirectory | null>;
    share?(directory: ProjectDirectory): () => void;
    forget(options?: { retainSession?: boolean }): Promise<void>;
  };
  readonly editors: {
    open(project: ProjectDirectory, target: EditorTarget): void;
    reserve(project: ProjectDirectory): ReservedEditor | null;
    closeCurrent(): void;
  };
}
