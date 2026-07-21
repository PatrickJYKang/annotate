import type { TaggingBoard } from '../tagging/board';
import type { ProjectManifest } from '../types/project';
import { validateProjectFolder } from '../fs/projectFolder';
import { cleanupTrash } from '../fs/trash';
import {
  checkProjectOnOpen,
  type ProjectIntegrityReport,
} from '../utils/projectIntegrity';

const DATABASE_NAME = 'annotate-db';
const DATABASE_VERSION = 1;
const HANDLE_STORE = 'handles';

export const PROJECT_HANDLE_KEY = 'project';

export interface RestoredProjectHandle {
  projectDir: FileSystemDirectoryHandle;
  manifest: ProjectManifest;
  board: TaggingBoard;
  integrityReport: ProjectIntegrityReport;
}

function openHandleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the project handle database.'));
  });
}

async function withHandleStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openHandleDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(HANDLE_STORE, mode);
      const request = operation(transaction.objectStore(HANDLE_STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error('Project handle storage failed.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Project handle storage failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Project handle storage was aborted.'));
    });
  } finally {
    database.close();
  }
}

export async function saveProjectHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withHandleStore('readwrite', (store) => store.put(handle, PROJECT_HANDLE_KEY));
}

export async function loadProjectHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await withHandleStore<FileSystemDirectoryHandle | undefined>(
    'readonly',
    (store) => store.get(PROJECT_HANDLE_KEY),
  );
  return handle ?? null;
}

export async function clearProjectHandle(): Promise<void> {
  await withHandleStore('readwrite', (store) => store.delete(PROJECT_HANDLE_KEY));
}

async function requireReadWritePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  const current = handle.queryPermission
    ? await handle.queryPermission({ mode: 'readwrite' })
    : 'granted';
  if (current === 'granted') return;
  const requested = handle.requestPermission
    ? await handle.requestPermission({ mode: 'readwrite' })
    : 'denied';
  if (requested !== 'granted') {
    throw new Error('Stored project permission is unavailable. Open the project again to continue.');
  }
}

export async function openProjectFromHandle(
  handle: FileSystemDirectoryHandle,
): Promise<RestoredProjectHandle> {
  await requireReadWritePermission(handle);
  const opened = await validateProjectFolder(handle);
  if (!opened.ok) throw new Error(opened.reason);
  await cleanupTrash(handle);
  const integrityReport = await checkProjectOnOpen(handle, opened.manifest);
  return {
    projectDir: handle,
    manifest: opened.manifest,
    board: opened.board,
    integrityReport,
  };
}

export async function restoreProjectFromHandle(): Promise<RestoredProjectHandle | null> {
  const handle = await loadProjectHandle();
  if (!handle) return null;
  try {
    return await openProjectFromHandle(handle);
  } catch (error) {
    await clearProjectHandle().catch(() => undefined);
    throw error;
  }
}
