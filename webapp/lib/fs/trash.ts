import { isSafeClipIdSegment, parseClip } from '../types/clip';
import {
  copyDirectoryContents,
  getDirectoryPath,
  inventoriesMatch,
  inventoryDirectory,
  isNotFoundError,
  pathExists,
  readTextFile,
  removePath,
  splitSafeRelativePath,
  writeJsonFile,
  type FileInventoryEntry,
} from './fsAccess';

export type TrashEntityKind = 'clip' | 'pin' | 'annotation';

export interface TrashOperationRecord {
  schema: 'trash-operation.v1';
  operationId: string;
  kind: TrashEntityKind;
  entityId: string;
  clipId: string;
  deletedAt: string;
  sourcePath: string;
  payloadPath: string;
  files: FileInventoryEntry[];
  byteSize: number;
}

export interface ClipTombstone {
  schema: 'clip-tombstone.v1';
  clipId: string;
  operationId: string;
  deletedAt: string;
  payloadPath: string;
}

export interface DeleteClipToTrashOptions {
  operationId?: string;
  now?: Date;
}

export interface TrashCleanupOptions {
  now?: Date;
  retentionDays?: number;
  maxBytes?: number;
  preserveOperationIds?: ReadonlySet<string>;
}

export interface TrashCleanupResult {
  removedOperationIds: string[];
  retainedBytes: number;
}

export interface CreateTrashPayloadOptions {
  kind: Exclude<TrashEntityKind, 'clip'>;
  entityId: string;
  clipId: string;
  sourcePath: string;
  operationId?: string;
  now?: Date;
  populate: (payload: FileSystemDirectoryHandle) => Promise<void>;
}

const TRASH_PATH = ['.trash'] as const;
const TOMBSTONE_PATH = ['.trash', 'tombstones'] as const;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeOperationId(value: string): string {
  if (!isSafeClipIdSegment(value)) throw new Error(`Unsafe trash operation id: ${JSON.stringify(value)}`);
  return value;
}

function bucketFor(kind: TrashEntityKind): 'clips' | 'pins' | 'annotations' {
  if (kind === 'clip') return 'clips';
  if (kind === 'pin') return 'pins';
  return 'annotations';
}

function isTrashEntityKind(value: unknown): value is TrashEntityKind {
  return value === 'clip' || value === 'pin' || value === 'annotation';
}

function parseTrashOperationRecord(
  raw: unknown,
  expected?: { kind?: TrashEntityKind; entityId?: string; operationId?: string },
): TrashOperationRecord {
  if (typeof raw !== 'object' || raw === null) throw new Error('Trash operation must be an object.');
  const value = raw as Record<string, unknown>;
  if (
    value.schema !== 'trash-operation.v1'
    || !isTrashEntityKind(value.kind)
    || typeof value.operationId !== 'string'
    || !isSafeClipIdSegment(value.operationId)
    || typeof value.entityId !== 'string'
    || !isSafeClipIdSegment(value.entityId)
    || typeof value.clipId !== 'string'
    || !isSafeClipIdSegment(value.clipId)
    || typeof value.deletedAt !== 'string'
    || !Number.isFinite(Date.parse(value.deletedAt))
    || typeof value.sourcePath !== 'string'
    || typeof value.payloadPath !== 'string'
    || !Array.isArray(value.files)
    || typeof value.byteSize !== 'number'
    || !Number.isFinite(value.byteSize)
    || value.byteSize < 0
  ) {
    throw new Error('Trash operation record is invalid.');
  }
  const files = value.files.map((entry, index) => {
    if (
      typeof entry !== 'object'
      || entry === null
      || typeof (entry as Record<string, unknown>).path !== 'string'
      || typeof (entry as Record<string, unknown>).size !== 'number'
      || !Number.isInteger((entry as Record<string, unknown>).size)
      || Number((entry as Record<string, unknown>).size) < 0
    ) {
      throw new Error(`Trash operation files[${index}] is invalid.`);
    }
    const path = (entry as { path: string }).path;
    splitSafeRelativePath(path);
    return { path, size: Number((entry as { size: number }).size) };
  });
  const expectedPayloadPath = [
    ...TRASH_PATH,
    bucketFor(value.kind),
    payloadName(value.entityId, value.operationId),
  ].join('/');
  if (
    value.payloadPath !== expectedPayloadPath
    || files.reduce((total, entry) => total + entry.size, 0) !== value.byteSize
    || (expected?.kind !== undefined && value.kind !== expected.kind)
    || (expected?.entityId !== undefined && value.entityId !== expected.entityId)
    || (expected?.operationId !== undefined && value.operationId !== expected.operationId)
  ) {
    throw new Error('Trash operation identity or inventory is invalid.');
  }
  return { ...value, files } as unknown as TrashOperationRecord;
}

function tombstoneFileName(clipId: string): string {
  if (!isSafeClipIdSegment(clipId)) throw new Error(`Unsafe clip id: ${JSON.stringify(clipId)}`);
  return `${clipId}.json`;
}

function payloadName(entityId: string, id: string): string {
  if (!isSafeClipIdSegment(entityId)) throw new Error(`Unsafe entity id: ${JSON.stringify(entityId)}`);
  return `${entityId}-${safeOperationId(id)}`;
}

export async function copyDirectoryVerified(
  source: FileSystemDirectoryHandle,
  destination: FileSystemDirectoryHandle,
): Promise<FileInventoryEntry[]> {
  const sourceInventory = await inventoryDirectory(source);
  await copyDirectoryContents(source, destination);
  const destinationInventory = await inventoryDirectory(destination);
  if (!inventoriesMatch(sourceInventory, destinationInventory)) {
    throw new Error('Trash copy verification failed: source and destination inventories differ.');
  }
  return sourceInventory;
}

export async function readClipTombstone(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
): Promise<ClipTombstone | null> {
  try {
    const raw = JSON.parse(await readTextFile(projectDir, [...TOMBSTONE_PATH, tombstoneFileName(clipId)]));
    if (
      raw?.schema !== 'clip-tombstone.v1'
      || raw.clipId !== clipId
      || typeof raw.operationId !== 'string'
      || typeof raw.deletedAt !== 'string'
      || typeof raw.payloadPath !== 'string'
    ) {
      throw new Error(`Invalid tombstone for clip "${clipId}".`);
    }
    return raw as ClipTombstone;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function hasClipTombstone(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
): Promise<boolean> {
  return (await readClipTombstone(projectDir, clipId)) !== null;
}

async function removeTombstone(projectDir: FileSystemDirectoryHandle, clipId: string): Promise<void> {
  try {
    await removePath(projectDir, [...TOMBSTONE_PATH, tombstoneFileName(clipId)]);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

async function removeTrashEntry(
  projectDir: FileSystemDirectoryHandle,
  record: Pick<TrashOperationRecord, 'kind' | 'entityId' | 'operationId'>,
): Promise<void> {
  const bucket = bucketFor(record.kind);
  const name = payloadName(record.entityId, record.operationId);
  try {
    await removePath(projectDir, [...TRASH_PATH, bucket, name], true);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  try {
    await removePath(projectDir, [...TRASH_PATH, bucket, `${name}.json`]);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

export async function createTrashPayload(
  projectDir: FileSystemDirectoryHandle,
  options: CreateTrashPayloadOptions,
): Promise<TrashOperationRecord> {
  if (!isSafeClipIdSegment(options.clipId)) throw new Error(`Unsafe clip id: ${JSON.stringify(options.clipId)}`);
  const id = safeOperationId(options.operationId ?? operationId());
  const bucket = bucketFor(options.kind);
  const name = payloadName(options.entityId, id);
  const payloadPath = [...TRASH_PATH, bucket, name];
  if (await pathExists(projectDir, payloadPath, 'directory')) {
    throw new Error(`Trash destination already exists for operation "${id}".`);
  }
  const payload = await getDirectoryPath(projectDir, payloadPath, true);
  try {
    await options.populate(payload);
    const files = await inventoryDirectory(payload);
    const record: TrashOperationRecord = {
      schema: 'trash-operation.v1',
      operationId: id,
      kind: options.kind,
      entityId: options.entityId,
      clipId: options.clipId,
      deletedAt: (options.now ?? new Date()).toISOString(),
      sourcePath: options.sourcePath,
      payloadPath: payloadPath.join('/'),
      files,
      byteSize: files.reduce((total, file) => total + file.size, 0),
    };
    await writeJsonFile(projectDir, [...TRASH_PATH, bucket, `${name}.json`], record);
    return record;
  } catch (error) {
    await removePath(projectDir, payloadPath, true).catch(() => undefined);
    throw error;
  }
}

export async function readTrashOperation(
  projectDir: FileSystemDirectoryHandle,
  kind: TrashEntityKind,
  entityId: string,
  operationIdToRead: string,
): Promise<{ record: TrashOperationRecord; payload: FileSystemDirectoryHandle }> {
  const bucket = bucketFor(kind);
  const name = payloadName(entityId, operationIdToRead);
  const source = await readTextFile(projectDir, [...TRASH_PATH, bucket, `${name}.json`]);
  const record = parseTrashOperationRecord(JSON.parse(source), {
    kind,
    entityId,
    operationId: operationIdToRead,
  });
  const payload = await getDirectoryPath(projectDir, [...TRASH_PATH, bucket, name], false);
  if (!inventoriesMatch(record.files, await inventoryDirectory(payload))) {
    throw new Error(`Trash payload verification failed for operation "${operationIdToRead}".`);
  }
  return { record, payload };
}

export async function removeTrashOperation(
  projectDir: FileSystemDirectoryHandle,
  record: Pick<TrashOperationRecord, 'kind' | 'entityId' | 'operationId'>,
): Promise<void> {
  await removeTrashEntry(projectDir, record);
}

export async function deleteClipToTrash(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  options: DeleteClipToTrashOptions = {},
): Promise<TrashOperationRecord> {
  if (!isSafeClipIdSegment(clipId)) throw new Error(`Unsafe clip id: ${JSON.stringify(clipId)}`);
  if (await hasClipTombstone(projectDir, clipId)) throw new Error(`Clip "${clipId}" is already deleted.`);
  const id = safeOperationId(options.operationId ?? operationId());
  const deletedAt = (options.now ?? new Date()).toISOString();
  const sourcePath = ['analysis', 'clips', clipId] as const;
  const bucket = 'clips';
  const name = payloadName(clipId, id);
  const payloadPath = [...TRASH_PATH, bucket, name] as string[];
  const recordPath = [...TRASH_PATH, bucket, `${name}.json`];
  const tombstonePath = [...TOMBSTONE_PATH, tombstoneFileName(clipId)];

  const source = await getDirectoryPath(projectDir, sourcePath, false);
  if (await pathExists(projectDir, payloadPath, 'directory')) {
    throw new Error(`Trash destination already exists for operation "${id}".`);
  }
  const destination = await getDirectoryPath(projectDir, payloadPath, true);
  let tombstoneWritten = false;
  try {
    const files = await copyDirectoryVerified(source, destination);
    const record: TrashOperationRecord = {
      schema: 'trash-operation.v1',
      operationId: id,
      kind: 'clip',
      entityId: clipId,
      clipId,
      deletedAt,
      sourcePath: sourcePath.join('/'),
      payloadPath: payloadPath.join('/'),
      files,
      byteSize: files.reduce((total, file) => total + file.size, 0),
    };
    const tombstone: ClipTombstone = {
      schema: 'clip-tombstone.v1',
      clipId,
      operationId: id,
      deletedAt,
      payloadPath: record.payloadPath,
    };
    await writeJsonFile(projectDir, recordPath, record);
    await writeJsonFile(projectDir, tombstonePath, tombstone);
    tombstoneWritten = true;
    await removePath(projectDir, sourcePath, true);
    return record;
  } catch (error) {
    // If source removal did not complete, it remains authoritative.
    if (tombstoneWritten && await pathExists(projectDir, sourcePath, 'directory')) {
      await removeTombstone(projectDir, clipId).catch(() => undefined);
    }
    if (await pathExists(projectDir, sourcePath, 'directory')) {
      await removeTrashEntry(projectDir, { kind: 'clip', entityId: clipId, operationId: id }).catch(() => undefined);
    }
    throw error;
  }
}

export async function restoreClipFromTrash(
  projectDir: FileSystemDirectoryHandle,
  clipId: string,
  operationIdToRestore?: string,
): Promise<void> {
  const tombstone = await readClipTombstone(projectDir, clipId);
  if (!tombstone) throw new Error(`Clip "${clipId}" has no deletion tombstone.`);
  if (operationIdToRestore && tombstone.operationId !== operationIdToRestore) {
    throw new Error(`Tombstone operation does not match "${operationIdToRestore}".`);
  }
  const id = tombstone.operationId;
  const { record, payload: source } = await readTrashOperation(projectDir, 'clip', clipId, id);
  if (record.clipId !== clipId || record.payloadPath !== tombstone.payloadPath) {
    throw new Error(`Clip "${clipId}" trash record does not match its tombstone.`);
  }
  const destinationPath = ['analysis', 'clips', clipId];
  if (await pathExists(projectDir, destinationPath, 'directory')) {
    throw new Error(`Cannot restore clip "${clipId}": destination already exists.`);
  }
  const destination = await getDirectoryPath(projectDir, destinationPath, true);
  try {
    await copyDirectoryVerified(source, destination);
    parseClip(JSON.parse(await readTextFile(destination, ['clip.json'])), { folderId: clipId });
  } catch (error) {
    await removePath(projectDir, destinationPath, true).catch(() => undefined);
    throw error;
  }

  // Removing the tombstone is the restore commit point. If it fails, roll
  // back the destination and leave the verified trash payload retryable.
  try {
    await removeTombstone(projectDir, clipId);
  } catch (error) {
    await removePath(projectDir, destinationPath, true).catch(() => undefined);
    throw error;
  }
  // Cleanup is post-commit. A stale payload is safe and is collected by the
  // normal retention pass; it must not make a successful restore look failed.
  await removeTrashOperation(projectDir, record).catch(() => undefined);
}

async function listTrashOperations(projectDir: FileSystemDirectoryHandle): Promise<TrashOperationRecord[]> {
  const operations: TrashOperationRecord[] = [];
  for (const bucket of ['clips', 'pins', 'annotations'] as const) {
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await getDirectoryPath(projectDir, [...TRASH_PATH, bucket], false);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
      try {
        const expectedKind: TrashEntityKind = bucket === 'clips'
          ? 'clip'
          : bucket === 'pins' ? 'pin' : 'annotation';
        const record = parseTrashOperationRecord(
          JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()),
          { kind: expectedKind },
        );
        if (`${payloadName(record.entityId, record.operationId)}.json` !== name) {
          throw new Error('Trash operation filename does not match its identity.');
        }
        operations.push(record);
      } catch {
        // Malformed operation records are integrity-report material, not cleanup candidates.
      }
    }
  }
  return operations.sort((left, right) => Date.parse(left.deletedAt) - Date.parse(right.deletedAt));
}

export async function cleanupTrash(
  projectDir: FileSystemDirectoryHandle,
  options: TrashCleanupOptions = {},
): Promise<TrashCleanupResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const preserve = options.preserveOperationIds ?? new Set<string>();
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const operations = await listTrashOperations(projectDir);
  const removed = new Set<string>();
  let retainedBytes = operations.reduce((total, operation) => total + operation.byteSize, 0);

  for (const operation of operations) {
    if (preserve.has(operation.operationId)) continue;
    if (Date.parse(operation.deletedAt) >= cutoff) continue;
    await removeTrashEntry(projectDir, operation);
    removed.add(operation.operationId);
    retainedBytes -= operation.byteSize;
  }
  for (const operation of operations) {
    if (retainedBytes <= maxBytes) break;
    if (removed.has(operation.operationId) || preserve.has(operation.operationId)) continue;
    await removeTrashEntry(projectDir, operation);
    removed.add(operation.operationId);
    retainedBytes -= operation.byteSize;
  }
  return { removedOperationIds: [...removed], retainedBytes: Math.max(0, retainedBytes) };
}

export async function emptyTrash(
  projectDir: FileSystemDirectoryHandle,
  preserveOperationIds: ReadonlySet<string> = new Set(),
): Promise<TrashCleanupResult> {
  return cleanupTrash(projectDir, {
    retentionDays: 0,
    maxBytes: 0,
    now: new Date(8640000000000000),
    preserveOperationIds,
  });
}
