import { ProjectStoreError } from './project-store.mjs';

const keys = {
  readDocument: ['type', 'path'],
  replaceDocument: ['type', 'path', 'document', 'expectedRevision'],
  listDirectory: ['type', 'path'],
  authorizeFile: ['type', 'path'],
  readRange: ['type', 'fileId', 'start', 'length'],
  releaseFile: ['type', 'fileId'],
};

/** One renderer connection, authorized by the trusted window owner for exactly one project. */
export function createProjectConnection(store, projectId) {
  let closed = false;
  const files = new Set();
  return {
    async dispatch(request) {
      try {
        if (closed) throw new ProjectStoreError('SESSION_CLOSED', 'This editor connection is closed.');
        const fields = request && Object.hasOwn(keys, request.type) ? keys[request.type] : null;
        if (!fields || Object.keys(request).some((key) => !fields.includes(key))) {
          throw new ProjectStoreError('INVALID_REQUEST', 'Unknown project operation or arguments.');
        }
        if (fields.includes('path') && typeof request.path !== 'string') throw new ProjectStoreError('INVALID_PATH', 'A relative path is required.');
        if (fields.includes('fileId') && !files.has(request.fileId)) throw new ProjectStoreError('FILE_UNAVAILABLE', 'This editor does not own that file capability.');
        let result;
        switch (request.type) {
          case 'readDocument': result = await store.readDocument(projectId, request.path); break;
          case 'replaceDocument': result = await store.replaceDocument(projectId, request.path, request); break;
          case 'listDirectory': result = await store.listDirectory(projectId, request.path); break;
          case 'authorizeFile': {
            result = await store.authorizeFile(projectId, request.path);
            if (closed) {
              store.releaseFile(result.id);
              throw new ProjectStoreError('SESSION_CLOSED', 'This editor connection closed during file authorization.');
            }
            files.add(result.id);
            break;
          }
          case 'readRange': result = Array.from(await store.readRange(request.fileId, request.start, request.length)); break;
          case 'releaseFile': store.releaseFile(request.fileId); files.delete(request.fileId); result = null; break;
        }
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: {
          code: error instanceof ProjectStoreError ? error.code : 'INVALID_REQUEST',
          message: error instanceof ProjectStoreError ? error.message : 'Invalid project request.',
          ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}),
        } };
      }
    },
    close() {
      closed = true;
      for (const id of files) store.releaseFile(id);
      files.clear();
    },
  };
}
