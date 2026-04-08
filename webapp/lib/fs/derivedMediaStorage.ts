import type {
  DerivedMediaJobQueueFile,
  ExactMotionAssetIndexEntry,
  ExactMotionAssetIndexFile,
  PresentationPreparationStatusFile,
  PreviewProxyIndexEntry,
  PreviewProxyIndexFile,
} from '../presentation/derivedMediaTypes';
import {
  isQueuedPreviewProxyJobCurrentForPromotion,
  isQueuedExactMotionJobCurrentForPromotion,
  updateDerivedMediaJobSnapshot,
} from '../presentation/derivedMediaJobs';
import {
  buildPreviewProxyAssetId,
  buildExactMotionAssetId,
  buildExactMotionRelativePath,
  buildPreviewProxyRelativePath,
} from '../presentation/derivedMediaKeys';

const DERIVED_MEDIA_SCHEMA_VERSION = 1 as const;
const DERIVED_MEDIA_DIR = 'derived-media';
const PREVIEW_PROXY_DIR = 'preview-proxies';
const PRESENTATION_DERIVED_DIR = 'presentations';
const PREVIEW_PROXY_INDEX_FILE = 'index.json';
const EXACT_MOTION_INDEX_FILE = 'index.json';
const DERIVED_MEDIA_JOB_QUEUE_FILE = 'jobs.json';
const PRESENTATION_PREPARATION_STATUS_FILE = 'preparation.json';
const PREVIEW_PROXY_PENDING_SUFFIX = '.pending';
const EXACT_MOTION_PENDING_SUFFIX = '.pending';

async function getOrCreateDir(parent: FileSystemDirectoryHandle, name: string) {
  return await parent.getDirectoryHandle(name, { create: true });
}

async function getOptionalFileHandle(dir: FileSystemDirectoryHandle, name: string) {
  try {
    return await dir.getFileHandle(name, { create: false });
  } catch {
    return null;
  }
}

function getPreviewProxyRelativePathFromOutputPath(outputPath: string): string {
  const prefix = 'derived-media/preview-proxies/';
  return outputPath.startsWith(prefix)
    ? outputPath.slice(prefix.length)
    : outputPath;
}

function getExactMotionRelativePathFromOutputPath(presentationId: string, outputPath: string): string {
  const prefix = `derived-media/presentations/${presentationId}/`;
  return outputPath.startsWith(prefix)
    ? outputPath.slice(prefix.length)
    : outputPath;
}

function buildNormalizedPreviewProxyOutputPath(generationKey: string): string {
  return `derived-media/preview-proxies/${buildPreviewProxyRelativePath(generationKey)}`;
}

function buildNormalizedExactMotionOutputPath(presentationId: string, generationKey: string): string {
  return `derived-media/presentations/${presentationId}/${buildExactMotionRelativePath(generationKey)}`;
}

async function readJsonFile<T>(handle: FileSystemFileHandle | null): Promise<T | null> {
  if (!handle) return null;
  try {
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(dir: FileSystemDirectoryHandle, name: string, value: unknown) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}

async function getFileHandleAtRelativePath(
  projectDir: FileSystemDirectoryHandle,
  relativePath: string,
  create: boolean,
) {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Relative path is required');
  }
  let current: FileSystemDirectoryHandle = projectDir;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = await current.getDirectoryHandle(parts[index], { create });
  }
  return await current.getFileHandle(parts[parts.length - 1], { create });
}

export function buildExactMotionPendingOutputPath(outputPath: string): string {
  return `${outputPath}${EXACT_MOTION_PENDING_SUFFIX}`;
}

export function buildPreviewProxyPendingOutputPath(outputPath: string): string {
  return `${outputPath}${PREVIEW_PROXY_PENDING_SUFFIX}`;
}

export async function writeBlobAtRelativePath(
  projectDir: FileSystemDirectoryHandle,
  relativePath: string,
  blob: Blob,
) {
  const handle = await getFileHandleAtRelativePath(projectDir, relativePath, true);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function deleteFileAtRelativePath(
  projectDir: FileSystemDirectoryHandle,
  relativePath: string,
) {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length === 0) {
    return;
  }
  let current: FileSystemDirectoryHandle = projectDir;
  for (let index = 0; index < parts.length - 1; index += 1) {
    try {
      current = await current.getDirectoryHandle(parts[index], { create: false });
    } catch (error: any) {
      if (error?.name === 'NotFoundError') {
        return;
      }
      throw error;
    }
  }
  try {
    await current.removeEntry(parts[parts.length - 1]);
  } catch (error: any) {
    if (error?.name === 'NotFoundError') {
      return;
    }
    throw error;
  }
}

async function fileExistsAtRelativePath(projectDir: FileSystemDirectoryHandle, relativePath: string): Promise<boolean> {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length === 0) {
    return false;
  }
  let current: FileSystemDirectoryHandle = projectDir;
  for (let index = 0; index < parts.length - 1; index += 1) {
    try {
      current = await current.getDirectoryHandle(parts[index], { create: false });
    } catch (error: any) {
      if (error?.name === 'NotFoundError') {
        return false;
      }
      throw error;
    }
  }
  try {
    await current.getFileHandle(parts[parts.length - 1], { create: false });
    return true;
  } catch (error: any) {
    if (error?.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

function upsertByAssetId<T extends { assetId: string }>(entries: T[], entry: T): T[] {
  const existingIndex = entries.findIndex((candidate) => candidate.assetId === entry.assetId);
  if (existingIndex < 0) {
    return [...entries, entry];
  }
  const next = entries.slice();
  next[existingIndex] = entry;
  return next;
}

export function getPreviewProxyIndexEntryByGenerationKey(
  index: PreviewProxyIndexFile,
  generationKey: string,
): PreviewProxyIndexEntry | null {
  return index.entries.find((entry) => entry.generationKey === generationKey) ?? null;
}

export function upsertPreviewProxyIndexEntry(
  index: PreviewProxyIndexFile,
  entry: PreviewProxyIndexEntry,
): PreviewProxyIndexFile {
  return {
    schema: index.schema,
    entries: upsertByAssetId(index.entries, entry),
  };
}

export function markPreviewProxyIndexEntryStale(
  index: PreviewProxyIndexFile,
  generationKey: string,
): PreviewProxyIndexFile {
  const entry = getPreviewProxyIndexEntryByGenerationKey(index, generationKey);
  if (!entry || entry.status === 'stale') {
    return index;
  }
  return upsertPreviewProxyIndexEntry(index, {
    ...entry,
    status: 'stale',
  });
}

export function getExactMotionAssetIndexEntryByGenerationKey(
  index: ExactMotionAssetIndexFile,
  generationKey: string,
): ExactMotionAssetIndexEntry | null {
  return index.entries.find((entry) => entry.generationKey === generationKey) ?? null;
}

export function upsertExactMotionAssetIndexEntry(
  index: ExactMotionAssetIndexFile,
  entry: ExactMotionAssetIndexEntry,
): ExactMotionAssetIndexFile {
  return {
    schema: index.schema,
    entries: upsertByAssetId(index.entries, entry),
  };
}

export function markExactMotionAssetIndexEntryStale(
  index: ExactMotionAssetIndexFile,
  generationKey: string,
): ExactMotionAssetIndexFile {
  const entry = getExactMotionAssetIndexEntryByGenerationKey(index, generationKey);
  if (!entry || entry.status === 'stale') {
    return index;
  }
  return upsertExactMotionAssetIndexEntry(index, {
    ...entry,
    status: 'stale',
  });
}

export async function reconcileExactMotionIndexWithCurrentGenerationKeys(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  index: ExactMotionAssetIndexFile,
  currentGenerationKeys: Set<string>,
): Promise<{ index: ExactMotionAssetIndexFile; changed: boolean }> {
  let changed = false;
  const entries = await Promise.all(index.entries.map(async (entry) => {
    const isReferenced = currentGenerationKeys.has(entry.generationKey);
    if (!isReferenced) {
      if (entry.status === 'stale') {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        status: 'stale' as const,
        error: 'Exact-motion asset is no longer referenced by the current presentation deck',
      } satisfies ExactMotionAssetIndexEntry;
    }
    if (entry.status !== 'stale') {
      return entry;
    }
    const fileExists = await fileExistsAtRelativePath(
      projectDir,
      `derived-media/presentations/${presentationId}/${entry.relativePath}`,
    );
    changed = true;
    return {
      ...entry,
      status: fileExists ? 'ready' as const : 'missing' as const,
      error: fileExists ? undefined : 'Derived exact-motion file is missing on disk',
    } satisfies ExactMotionAssetIndexEntry;
  }));
  return {
    index: {
      schema: index.schema,
      entries,
    },
    changed,
  };
}

export function promoteExactMotionJobIfCurrent({
  presentationId,
  queue,
  index,
  jobId,
  byteSize,
  durationMs,
  completedAt = new Date().toISOString(),
}: {
  presentationId: string;
  queue: DerivedMediaJobQueueFile;
  index: ExactMotionAssetIndexFile;
  jobId: string;
  byteSize?: number;
  durationMs?: number;
  completedAt?: string;
}): {
  queue: DerivedMediaJobQueueFile;
  index: ExactMotionAssetIndexFile;
  promoted: boolean;
  reason: 'promoted' | 'not_found' | 'invalid_job' | 'not_current';
} {
  const jobIndex = queue.jobs.findIndex((job) => job.snapshot.jobId === jobId);
  if (jobIndex < 0) {
    return {
      queue,
      index,
      promoted: false,
      reason: 'not_found',
    };
  }

  const queuedJob = queue.jobs[jobIndex];
  if (
    queuedJob.request.kind !== 'exact_motion_generate'
    || queuedJob.snapshot.kind !== 'exact_motion_generate'
    || queuedJob.request.presentationId !== presentationId
    || queuedJob.snapshot.presentationId !== presentationId
  ) {
    return {
      queue,
      index,
      promoted: false,
      reason: 'invalid_job',
    };
  }

  if (!isQueuedExactMotionJobCurrentForPromotion(queue, jobId)) {
    const nextQueue = {
      schema: queue.schema,
      jobs: queue.jobs.map((job, indexPosition) => indexPosition !== jobIndex
        ? job
        : {
            ...job,
            snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
              status: 'obsolete',
              error: 'Superseded by a newer exact-motion request',
              progress: {
                ...job.snapshot.progress,
                status: 'obsolete',
                label: 'Obsolete',
              },
            }),
          }),
    } satisfies DerivedMediaJobQueueFile;
    const existingEntry = getExactMotionAssetIndexEntryByGenerationKey(index, queuedJob.snapshot.generationKey);
    const nextIndex = existingEntry
      ? upsertExactMotionAssetIndexEntry(index, {
          ...existingEntry,
          status: 'stale',
          error: 'Superseded by a newer exact-motion request',
        })
      : index;
    return {
      queue: nextQueue,
      index: nextIndex,
      promoted: false,
      reason: 'not_current',
    };
  }

  const prefix = `derived-media/presentations/${presentationId}/`;
  const existingEntry = getExactMotionAssetIndexEntryByGenerationKey(index, queuedJob.snapshot.generationKey);
  const nextEntry: ExactMotionAssetIndexEntry = {
    assetId: existingEntry?.assetId ?? buildExactMotionAssetId(
      presentationId,
      queuedJob.request.transitionOrClipId,
      queuedJob.snapshot.generationKey,
    ),
    generationKey: queuedJob.snapshot.generationKey,
    motionKind: queuedJob.request.motionKind,
    transitionOrClipId: queuedJob.request.transitionOrClipId,
    sourceVideoId: queuedJob.request.sourceVideoId,
    sourceFingerprint: queuedJob.request.sourceFingerprint,
    relativePath: existingEntry?.relativePath ?? (
      queuedJob.request.outputPath.startsWith(prefix)
        ? queuedJob.request.outputPath.slice(prefix.length)
        : queuedJob.request.outputPath
    ),
    status: 'ready',
    profileVersion: queuedJob.request.profileVersion,
    createdAt: existingEntry?.createdAt ?? queuedJob.queuedAt,
    lastUsedAt: existingEntry?.lastUsedAt,
    byteSize: byteSize ?? existingEntry?.byteSize,
    durationMs: durationMs ?? existingEntry?.durationMs,
    error: undefined,
  };
  return {
    queue: {
      schema: queue.schema,
      jobs: queue.jobs.map((job, indexPosition) => indexPosition !== jobIndex
        ? job
        : {
            ...job,
            snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
              status: 'ready',
              error: undefined,
              progress: {
                ...job.snapshot.progress,
                status: 'ready',
                label: 'Ready',
                durationMs: durationMs ?? job.snapshot.progress?.durationMs,
              },
            }),
          }),
    },
    index: upsertExactMotionAssetIndexEntry(index, nextEntry),
    promoted: true,
    reason: 'promoted',
  };
}

export function promotePreviewProxyJobIfCurrent({
  queue,
  index,
  jobId,
  byteSize,
  durationMs,
  completedAt = new Date().toISOString(),
}: {
  queue: DerivedMediaJobQueueFile;
  index: PreviewProxyIndexFile;
  jobId: string;
  byteSize?: number;
  durationMs?: number;
  completedAt?: string;
}): {
  queue: DerivedMediaJobQueueFile;
  index: PreviewProxyIndexFile;
  promoted: boolean;
  reason: 'promoted' | 'not_found' | 'invalid_job' | 'not_current';
} {
  const jobIndex = queue.jobs.findIndex((job) => job.snapshot.jobId === jobId);
  if (jobIndex < 0) {
    return {
      queue,
      index,
      promoted: false,
      reason: 'not_found',
    };
  }

  const queuedJob = queue.jobs[jobIndex];
  if (
    queuedJob.request.kind !== 'preview_proxy_generate'
    || queuedJob.snapshot.kind !== 'preview_proxy_generate'
  ) {
    return {
      queue,
      index,
      promoted: false,
      reason: 'invalid_job',
    };
  }

  if (!isQueuedPreviewProxyJobCurrentForPromotion(queue, jobId)) {
    const nextQueue = {
      schema: queue.schema,
      jobs: queue.jobs.map((job, indexPosition) => indexPosition !== jobIndex
        ? job
        : {
            ...job,
            snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
              status: 'obsolete',
              error: 'Superseded by a newer preview-proxy request',
              remoteJobId: undefined,
              progress: {
                ...job.snapshot.progress,
                status: 'obsolete',
                label: 'Obsolete',
              },
            }),
          }),
    } satisfies DerivedMediaJobQueueFile;
    const existingEntry = getPreviewProxyIndexEntryByGenerationKey(index, queuedJob.snapshot.generationKey);
    const nextIndex = existingEntry
      ? upsertPreviewProxyIndexEntry(index, {
          ...existingEntry,
          status: 'stale',
          error: 'Superseded by a newer preview-proxy request',
        })
      : index;
    return {
      queue: nextQueue,
      index: nextIndex,
      promoted: false,
      reason: 'not_current',
    };
  }

  const existingEntry = getPreviewProxyIndexEntryByGenerationKey(index, queuedJob.snapshot.generationKey);
  const nextEntry: PreviewProxyIndexEntry = {
    assetId: existingEntry?.assetId ?? buildPreviewProxyAssetId(
      queuedJob.request.sourceVideoId,
      queuedJob.snapshot.generationKey,
    ),
    generationKey: queuedJob.snapshot.generationKey,
    sourceVideoId: queuedJob.request.sourceVideoId,
    sourceFingerprint: queuedJob.request.sourceFingerprint,
    relativePath: existingEntry?.relativePath ?? getPreviewProxyRelativePathFromOutputPath(queuedJob.request.outputPath),
    status: 'ready',
    profileVersion: queuedJob.request.profileVersion,
    createdAt: existingEntry?.createdAt ?? queuedJob.queuedAt,
    lastUsedAt: existingEntry?.lastUsedAt ?? completedAt,
    byteSize: byteSize ?? existingEntry?.byteSize,
    durationMs: durationMs ?? existingEntry?.durationMs,
    error: undefined,
  };

  return {
    queue: {
      schema: queue.schema,
      jobs: queue.jobs.map((job, indexPosition) => indexPosition !== jobIndex
        ? job
        : {
            ...job,
            snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
              status: 'ready',
              error: undefined,
              remoteJobId: undefined,
              progress: {
                ...job.snapshot.progress,
                status: 'ready',
                label: 'Ready',
                durationMs: durationMs ?? job.snapshot.progress?.durationMs,
              },
            }),
          }),
    },
    index: upsertPreviewProxyIndexEntry(index, nextEntry),
    promoted: true,
    reason: 'promoted',
  };
}

export async function ensureDerivedMediaRoot(projectDir: FileSystemDirectoryHandle) {
  return await getOrCreateDir(projectDir, DERIVED_MEDIA_DIR);
}

export async function ensurePreviewProxyStorage(projectDir: FileSystemDirectoryHandle) {
  const rootDir = await ensureDerivedMediaRoot(projectDir);
  const proxyDir = await getOrCreateDir(rootDir, PREVIEW_PROXY_DIR);
  return {
    rootDir,
    proxyDir,
    indexFileName: PREVIEW_PROXY_INDEX_FILE,
  };
}

export async function readPreviewProxyIndex(projectDir: FileSystemDirectoryHandle): Promise<PreviewProxyIndexFile> {
  const { proxyDir } = await ensurePreviewProxyStorage(projectDir);
  const handle = await getOptionalFileHandle(proxyDir, PREVIEW_PROXY_INDEX_FILE);
  const parsed = await readJsonFile<PreviewProxyIndexFile>(handle);
  if (parsed && parsed.schema === DERIVED_MEDIA_SCHEMA_VERSION && Array.isArray(parsed.entries)) {
    let changed = false;
    const normalized: PreviewProxyIndexFile = {
      schema: parsed.schema,
      entries: parsed.entries.map((entry) => {
        const relativePath = buildPreviewProxyRelativePath(entry.generationKey);
        if (entry.relativePath === relativePath) {
          return entry;
        }
        changed = true;
        return {
          ...entry,
          relativePath,
        };
      }),
    };
    if (changed) {
      await writePreviewProxyIndex(projectDir, normalized);
    }
    return normalized;
  }
  return {
    schema: DERIVED_MEDIA_SCHEMA_VERSION,
    entries: [],
  };
}

export async function writePreviewProxyIndex(projectDir: FileSystemDirectoryHandle, index: PreviewProxyIndexFile) {
  const { proxyDir } = await ensurePreviewProxyStorage(projectDir);
  await writeJsonFile(proxyDir, PREVIEW_PROXY_INDEX_FILE, {
    schema: DERIVED_MEDIA_SCHEMA_VERSION,
    entries: index.entries,
  } satisfies PreviewProxyIndexFile);
}

export async function readPreviewProxyDerivedMediaJobQueue(
  projectDir: FileSystemDirectoryHandle,
): Promise<DerivedMediaJobQueueFile> {
  const { proxyDir } = await ensurePreviewProxyStorage(projectDir);
  const handle = await getOptionalFileHandle(proxyDir, DERIVED_MEDIA_JOB_QUEUE_FILE);
  const parsed = await readJsonFile<DerivedMediaJobQueueFile>(handle);
  const queue = parsed && parsed.schema === DERIVED_MEDIA_SCHEMA_VERSION && Array.isArray(parsed.jobs)
    ? parsed
    : {
        schema: DERIVED_MEDIA_SCHEMA_VERSION,
        jobs: [],
      } satisfies DerivedMediaJobQueueFile;
  let changed = false;
  const jobs = await Promise.all(queue.jobs.map(async (job) => {
    if (job.request.kind === 'preview_proxy_generate' && job.snapshot.kind === 'preview_proxy_generate') {
      const normalizedOutputPath = buildNormalizedPreviewProxyOutputPath(job.snapshot.generationKey);
      if (job.request.outputPath !== normalizedOutputPath || job.snapshot.outputPath !== normalizedOutputPath) {
        changed = true;
        job = {
          ...job,
          request: {
            ...job.request,
            outputPath: normalizedOutputPath,
          },
          snapshot: {
            ...job.snapshot,
            outputPath: normalizedOutputPath,
          },
        };
      }
    }
    if (
      job.request.kind !== 'preview_proxy_generate'
      || job.snapshot.kind !== 'preview_proxy_generate'
      || job.snapshot.status === 'ready'
      || job.snapshot.status === 'cancelled'
    ) {
      return job;
    }
    const fileExists = await fileExistsAtRelativePath(projectDir, job.request.outputPath);
    if (!fileExists) {
      return job;
    }
    changed = true;
      return {
        ...job,
        snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
          status: 'ready',
          error: undefined,
          remoteJobId: undefined,
          progress: {
            ...job.snapshot.progress,
            status: 'ready',
          label: 'Ready',
        },
      }),
    };
  }));
  if (!changed) {
    return queue;
  }
  const nextQueue = {
    schema: queue.schema,
    jobs,
  } satisfies DerivedMediaJobQueueFile;
  await writePreviewProxyDerivedMediaJobQueue(projectDir, nextQueue);
  return nextQueue;
}

export async function writePreviewProxyDerivedMediaJobQueue(
  projectDir: FileSystemDirectoryHandle,
  queue: DerivedMediaJobQueueFile,
) {
  const { proxyDir } = await ensurePreviewProxyStorage(projectDir);
  await writeJsonFile(proxyDir, DERIVED_MEDIA_JOB_QUEUE_FILE, {
    schema: DERIVED_MEDIA_SCHEMA_VERSION,
    jobs: queue.jobs,
  } satisfies DerivedMediaJobQueueFile);
}

export async function validatePreviewProxyIndex(projectDir: FileSystemDirectoryHandle): Promise<PreviewProxyIndexFile> {
  const index = await readPreviewProxyIndex(projectDir);
  const queue = await readPreviewProxyDerivedMediaJobQueue(projectDir);
  let changed = false;
  const entries = await Promise.all(index.entries.map(async (entry) => {
    const fileExists = await fileExistsAtRelativePath(projectDir, `derived-media/preview-proxies/${entry.relativePath}`);
    if (entry.status === 'ready') {
      if (fileExists) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        status: 'missing' as const,
        error: 'Derived preview proxy file is missing on disk',
      } satisfies PreviewProxyIndexEntry;
    }
    if (!fileExists || entry.status === 'stale') {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      status: 'ready' as const,
      error: undefined,
    } satisfies PreviewProxyIndexEntry;
  }));
  let nextIndex: PreviewProxyIndexFile = {
    schema: index.schema,
    entries,
  };
  for (const job of queue.jobs) {
    if (job.request.kind !== 'preview_proxy_generate' || job.snapshot.status === 'cancelled') {
      continue;
    }
    const relativePath = getPreviewProxyRelativePathFromOutputPath(job.request.outputPath);
    const existingEntry = getPreviewProxyIndexEntryByGenerationKey(nextIndex, job.snapshot.generationKey);
    if (job.snapshot.status === 'failed') {
      const nextEntry: PreviewProxyIndexEntry = {
        assetId: existingEntry?.assetId ?? buildPreviewProxyAssetId(job.request.sourceVideoId, job.snapshot.generationKey),
        generationKey: job.snapshot.generationKey,
        sourceVideoId: job.request.sourceVideoId,
        sourceFingerprint: job.request.sourceFingerprint,
        relativePath: existingEntry?.relativePath ?? relativePath,
        status: 'failed',
        profileVersion: job.request.profileVersion,
        createdAt: existingEntry?.createdAt ?? job.queuedAt,
        lastUsedAt: existingEntry?.lastUsedAt,
        byteSize: existingEntry?.byteSize,
        durationMs: existingEntry?.durationMs,
        error: job.snapshot.error ?? existingEntry?.error ?? 'Preview-proxy generation failed',
      };
      if (
        !existingEntry
        || existingEntry.status !== nextEntry.status
        || existingEntry.error !== nextEntry.error
        || existingEntry.relativePath !== nextEntry.relativePath
        || existingEntry.assetId !== nextEntry.assetId
      ) {
        nextIndex = upsertPreviewProxyIndexEntry(nextIndex, nextEntry);
        changed = true;
      }
      continue;
    }
    const fileExists = await fileExistsAtRelativePath(projectDir, job.request.outputPath);
    if (!fileExists || existingEntry || !isQueuedPreviewProxyJobCurrentForPromotion(queue, job.snapshot.jobId)) {
      continue;
    }
    nextIndex = upsertPreviewProxyIndexEntry(nextIndex, {
      assetId: buildPreviewProxyAssetId(job.request.sourceVideoId, job.snapshot.generationKey),
      generationKey: job.snapshot.generationKey,
      sourceVideoId: job.request.sourceVideoId,
      sourceFingerprint: job.request.sourceFingerprint,
      relativePath,
      status: 'ready',
      profileVersion: job.request.profileVersion,
      createdAt: job.queuedAt,
      error: undefined,
    });
    changed = true;
  }
  if (!changed) {
    return index;
  }
  await writePreviewProxyIndex(projectDir, nextIndex);
  return nextIndex;
}

export async function ensurePresentationDerivedMediaStorage(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
) {
  const rootDir = await ensureDerivedMediaRoot(projectDir);
  const presentationsDir = await getOrCreateDir(rootDir, PRESENTATION_DERIVED_DIR);
  const presentationDir = await getOrCreateDir(presentationsDir, presentationId);
  const motionAssetsDir = await getOrCreateDir(presentationDir, 'motion-assets');
  return {
    rootDir,
    presentationsDir,
    presentationDir,
    motionAssetsDir,
    indexFileName: EXACT_MOTION_INDEX_FILE,
    jobQueueFileName: DERIVED_MEDIA_JOB_QUEUE_FILE,
    preparationStatusFileName: PRESENTATION_PREPARATION_STATUS_FILE,
  };
}

export async function readExactMotionAssetIndex(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<ExactMotionAssetIndexFile> {
  const { presentationDir } = await ensurePresentationDerivedMediaStorage(projectDir, presentationId);
  const handle = await getOptionalFileHandle(presentationDir, EXACT_MOTION_INDEX_FILE);
  const parsed = await readJsonFile<ExactMotionAssetIndexFile>(handle);
  if (parsed && parsed.schema === DERIVED_MEDIA_SCHEMA_VERSION && Array.isArray(parsed.entries)) {
    let changed = false;
    const normalized: ExactMotionAssetIndexFile = {
      schema: parsed.schema,
      entries: parsed.entries.map((entry) => {
        const relativePath = buildExactMotionRelativePath(entry.generationKey);
        if (entry.relativePath === relativePath) {
          return entry;
        }
        changed = true;
        return {
          ...entry,
          relativePath,
        };
      }),
    };
    if (changed) {
      await writeExactMotionAssetIndex(projectDir, presentationId, normalized);
    }
    return normalized;
  }
  return {
    schema: DERIVED_MEDIA_SCHEMA_VERSION,
    entries: [],
  };
}

export async function writeExactMotionAssetIndex(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  index: ExactMotionAssetIndexFile,
) {
  const { presentationDir } = await ensurePresentationDerivedMediaStorage(projectDir, presentationId);
  await writeJsonFile(presentationDir, EXACT_MOTION_INDEX_FILE, {
    schema: DERIVED_MEDIA_SCHEMA_VERSION,
    entries: index.entries,
  } satisfies ExactMotionAssetIndexFile);
}

export async function validateExactMotionAssetIndex(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<ExactMotionAssetIndexFile> {
  const index = await readExactMotionAssetIndex(projectDir, presentationId);
  const queue = await readPresentationDerivedMediaJobQueue(projectDir, presentationId);
  let changed = false;
  const entries = await Promise.all(index.entries.map(async (entry) => {
    const fileExists = await fileExistsAtRelativePath(
      projectDir,
      `derived-media/presentations/${presentationId}/${entry.relativePath}`,
    );
    if (entry.status === 'ready') {
      if (fileExists) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        status: 'missing' as const,
        error: 'Derived exact-motion file is missing on disk',
      } satisfies ExactMotionAssetIndexEntry;
    }
    if (!fileExists || entry.status === 'stale') {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      status: 'ready' as const,
      error: undefined,
    } satisfies ExactMotionAssetIndexEntry;
  }));
  let nextIndex: ExactMotionAssetIndexFile = {
    schema: index.schema,
    entries,
  };
  for (const job of queue.jobs) {
    if (
      job.request.kind !== 'exact_motion_generate'
      || job.snapshot.presentationId !== presentationId
      || job.snapshot.status === 'obsolete'
      || job.snapshot.status === 'cancelled'
    ) {
      continue;
    }
    const relativePath = getExactMotionRelativePathFromOutputPath(presentationId, job.request.outputPath);
    const fileExists = await fileExistsAtRelativePath(projectDir, job.request.outputPath);
    if (!fileExists || getExactMotionAssetIndexEntryByGenerationKey(nextIndex, job.snapshot.generationKey)) {
      continue;
    }
    nextIndex = upsertExactMotionAssetIndexEntry(nextIndex, {
      assetId: buildExactMotionAssetId(
        presentationId,
        job.request.transitionOrClipId,
        job.snapshot.generationKey,
      ),
      generationKey: job.snapshot.generationKey,
      motionKind: job.request.motionKind,
      transitionOrClipId: job.request.transitionOrClipId,
      sourceVideoId: job.request.sourceVideoId,
      sourceFingerprint: job.request.sourceFingerprint,
      relativePath,
      status: 'ready',
      profileVersion: job.request.profileVersion,
      createdAt: job.queuedAt,
      lastUsedAt: undefined,
      error: undefined,
    });
    changed = true;
  }
  if (!changed) {
    return index;
  }
  await writeExactMotionAssetIndex(projectDir, presentationId, nextIndex);
  return nextIndex;
}

export async function syncExactMotionIndexWithFailedJobs(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  jobQueue: DerivedMediaJobQueueFile,
): Promise<ExactMotionAssetIndexFile> {
  let index = await readExactMotionAssetIndex(projectDir, presentationId);
  let changed = false;
  const prefix = `derived-media/presentations/${presentationId}/`;

  for (const job of jobQueue.jobs) {
    if (
      job.snapshot.kind !== 'exact_motion_generate'
      || job.snapshot.presentationId !== presentationId
      || job.snapshot.status !== 'failed'
      || job.request.kind !== 'exact_motion_generate'
    ) {
      continue;
    }

    const existing = getExactMotionAssetIndexEntryByGenerationKey(index, job.snapshot.generationKey);
    const nextEntry: ExactMotionAssetIndexEntry = {
      assetId: existing?.assetId ?? `failed:${job.snapshot.generationKey}`,
      generationKey: job.snapshot.generationKey,
      motionKind: job.request.motionKind,
      transitionOrClipId: job.request.transitionOrClipId,
      sourceVideoId: job.request.sourceVideoId,
      sourceFingerprint: job.request.sourceFingerprint,
      relativePath: existing?.relativePath ?? (job.request.outputPath.startsWith(prefix) ? job.request.outputPath.slice(prefix.length) : job.request.outputPath),
      status: 'failed',
      profileVersion: job.request.profileVersion,
      createdAt: existing?.createdAt ?? job.queuedAt,
      lastUsedAt: existing?.lastUsedAt,
      byteSize: existing?.byteSize,
      durationMs: existing?.durationMs,
      error: job.snapshot.error ?? existing?.error ?? 'Exact-motion generation failed',
    };

    if (
      existing
      && existing.status === nextEntry.status
      && existing.error === nextEntry.error
      && existing.relativePath === nextEntry.relativePath
      && existing.assetId === nextEntry.assetId
    ) {
      continue;
    }

    index = upsertExactMotionAssetIndexEntry(index, nextEntry);
    changed = true;
  }

  if (!changed) {
    return index;
  }

  await writeExactMotionAssetIndex(projectDir, presentationId, index);
  return index;
}

export async function cleanupPendingExactMotionFilesForActiveJobs(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  queue: DerivedMediaJobQueueFile,
) {
  await Promise.all(queue.jobs.map(async (job) => {
    if (
      job.request.kind !== 'exact_motion_generate'
      || job.snapshot.kind !== 'exact_motion_generate'
      || job.snapshot.presentationId !== presentationId
      || job.snapshot.status === 'ready'
      || job.snapshot.status === 'obsolete'
      || job.snapshot.status === 'cancelled'
    ) {
      return;
    }
    await deleteFileAtRelativePath(projectDir, buildExactMotionPendingOutputPath(job.request.outputPath));
  }));
}

export async function cleanupPendingPreviewProxyFilesForActiveJobs(
  projectDir: FileSystemDirectoryHandle,
  queue: DerivedMediaJobQueueFile,
) {
  await Promise.all(queue.jobs.map(async (job) => {
    if (
      job.request.kind !== 'preview_proxy_generate'
      || job.snapshot.kind !== 'preview_proxy_generate'
      || job.snapshot.status === 'ready'
      || job.snapshot.status === 'obsolete'
      || job.snapshot.status === 'cancelled'
    ) {
      return;
    }
    await deleteFileAtRelativePath(projectDir, buildPreviewProxyPendingOutputPath(job.request.outputPath));
  }));
}

export async function readPresentationDerivedMediaJobQueue(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<DerivedMediaJobQueueFile> {
  const { presentationDir } = await ensurePresentationDerivedMediaStorage(projectDir, presentationId);
  const handle = await getOptionalFileHandle(presentationDir, DERIVED_MEDIA_JOB_QUEUE_FILE);
  const parsed = await readJsonFile<DerivedMediaJobQueueFile>(handle);
  const queue = parsed && parsed.schema === DERIVED_MEDIA_SCHEMA_VERSION && Array.isArray(parsed.jobs)
    ? parsed
    : {
        schema: DERIVED_MEDIA_SCHEMA_VERSION,
        jobs: [],
      } satisfies DerivedMediaJobQueueFile;

  let changed = false;
  const jobs = await Promise.all(queue.jobs.map(async (job) => {
    if (
      job.request.kind === 'exact_motion_generate'
      && job.snapshot.kind === 'exact_motion_generate'
      && job.snapshot.presentationId === presentationId
    ) {
      const normalizedOutputPath = buildNormalizedExactMotionOutputPath(presentationId, job.snapshot.generationKey);
      if (job.request.outputPath !== normalizedOutputPath || job.snapshot.outputPath !== normalizedOutputPath) {
        changed = true;
        job = {
          ...job,
          request: {
            ...job.request,
            outputPath: normalizedOutputPath,
          },
          snapshot: {
            ...job.snapshot,
            outputPath: normalizedOutputPath,
          },
        };
      }
    }
    if (
      job.request.kind !== 'exact_motion_generate'
      || job.snapshot.kind !== 'exact_motion_generate'
      || job.snapshot.presentationId !== presentationId
      || job.snapshot.status === 'ready'
      || job.snapshot.status === 'obsolete'
      || job.snapshot.status === 'cancelled'
    ) {
      return job;
    }
    const fileExists = await fileExistsAtRelativePath(projectDir, job.request.outputPath);
    if (!fileExists) {
      return job;
    }
    changed = true;
    return {
      ...job,
      snapshot: updateDerivedMediaJobSnapshot(job.snapshot, {
        status: 'ready',
        error: undefined,
        progress: {
          ...job.snapshot.progress,
          status: 'ready',
          label: 'Ready',
        },
      }),
    };
  }));
  if (!changed) {
    return queue;
  }
  const nextQueue = {
    schema: queue.schema,
    jobs,
  } satisfies DerivedMediaJobQueueFile;
  await writePresentationDerivedMediaJobQueue(projectDir, presentationId, nextQueue);
  return nextQueue;
}

export async function writePresentationDerivedMediaJobQueue(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  queue: DerivedMediaJobQueueFile,
) {
  const { presentationDir } = await ensurePresentationDerivedMediaStorage(projectDir, presentationId);
  await writeJsonFile(presentationDir, DERIVED_MEDIA_JOB_QUEUE_FILE, {
    schema: DERIVED_MEDIA_SCHEMA_VERSION,
    jobs: queue.jobs,
  } satisfies DerivedMediaJobQueueFile);
}

export async function readPresentationPreparationStatus(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
): Promise<PresentationPreparationStatusFile> {
  const { presentationDir } = await ensurePresentationDerivedMediaStorage(projectDir, presentationId);
  const handle = await getOptionalFileHandle(presentationDir, PRESENTATION_PREPARATION_STATUS_FILE);
  const parsed = await readJsonFile<PresentationPreparationStatusFile>(handle);
  if (parsed && parsed.schema === DERIVED_MEDIA_SCHEMA_VERSION && 'preparation' in parsed) {
    return parsed;
  }
  return {
    schema: DERIVED_MEDIA_SCHEMA_VERSION,
    preparation: null,
  };
}

export async function writePresentationPreparationStatus(
  projectDir: FileSystemDirectoryHandle,
  presentationId: string,
  status: PresentationPreparationStatusFile,
) {
  const { presentationDir } = await ensurePresentationDerivedMediaStorage(projectDir, presentationId);
  await writeJsonFile(presentationDir, PRESENTATION_PREPARATION_STATUS_FILE, {
    schema: DERIVED_MEDIA_SCHEMA_VERSION,
    preparation: status.preparation,
  } satisfies PresentationPreparationStatusFile);
}
