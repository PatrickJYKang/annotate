import type { AppHost } from '../contracts';
import { unwrapBrowserDirectory, wrapBrowserDirectory } from './fileSystem';
import { bindTabSession, clearTabSession, requestedProjectSession } from './tabSession';
import { requestLiveProject, shareLiveProject } from './liveProjects';

// Preserve the 0.2.2 database and raw-handle format, including restore in existing tabs.
const DATABASE_NAME = 'annotate-db';
const DATABASE_VERSION = 1;
const HANDLE_STORE = 'handles';
const PROJECT_HANDLE_KEY = 'project';
const RECENT_SESSION_KEY = 'recent-project-session';
const SESSION_PREFIX = 'project-session:';

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
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error('Project handle storage failed.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Project handle storage failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Project handle storage was aborted.'));
    });
  } finally {
    database.close();
  }
}

async function identifyDirectory(handle: FileSystemDirectoryHandle): Promise<string> {
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new Error('Web Locks are required to establish a project session safely.');
  return locks.request('annotate:project-sessions', async () => {
    const keys = await withHandleStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(SESSION_PREFIX)) continue;
      const candidate = await withHandleStore<FileSystemDirectoryHandle | undefined>('readonly', (store) => store.get(key));
      try {
        if (candidate && await handle.isSameEntry(candidate)) return key.slice(SESSION_PREFIX.length);
      } catch { /* A disconnected directory must not prevent opening another project. */ }
    }
    const id = crypto.randomUUID();
    await withHandleStore('readwrite', (store) => store.put(handle, `${SESSION_PREFIX}${id}`));
    return id;
  });
}

export const browserProjectBookmarks: AppHost['projects'] = {
  async remember(directory) {
    const handle = unwrapBrowserDirectory(directory);
    const id = await identifyDirectory(handle);
    await withHandleStore('readwrite', (store) => {
      store.put(handle, `${SESSION_PREFIX}${id}`);
      store.put(id, RECENT_SESSION_KEY);
      return store.put(handle, PROJECT_HANDLE_KEY);
    });
    bindTabSession(id);
    return wrapBrowserDirectory(handle, id);
  },
  async restore() {
    const requested = requestedProjectSession();
    let handle = await withHandleStore<FileSystemDirectoryHandle | undefined>(
      'readonly', (store) => store.get(requested ? `${SESSION_PREFIX}${requested}` : PROJECT_HANDLE_KEY),
    );
    if (!handle) {
      if (requested) throw new Error('This editor\'s project session is unavailable. Open its project again.');
      return null;
    }
    const id = requested ?? await identifyDirectory(handle);
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      handle = await requestLiveProject(id, handle) ?? handle;
    }
    bindTabSession(id);
    return wrapBrowserDirectory(handle, id);
  },
  share(directory) {
    return shareLiveProject(directory.scopeId, unwrapBrowserDirectory(directory));
  },
  async forget(options) {
    let current: string | null = null;
    try { current = requestedProjectSession(); } finally {
      if (!options?.retainSession) clearTabSession();
    }
    await withHandleStore('readwrite', (store) => {
      const request = store.get(RECENT_SESSION_KEY);
      request.addEventListener('success', () => {
        if (!current || !request.result || request.result === current) {
          store.delete(PROJECT_HANDLE_KEY);
          store.delete(RECENT_SESSION_KEY);
        }
      });
      return request;
    });
    // Closing one tab must not revoke the handles used by its other editor tabs.
  },
};
