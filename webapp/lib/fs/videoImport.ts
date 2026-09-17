import type { ProjectDirectory } from "../host/contracts";
import { nativeFileInfo } from '../host/media';
import { desktopBridge } from '../host/desktop/bridge';
import {
  prepareVideoImportWithMetadata,
  type NormalizeVideoImportOptions,
  type NormalizedVideoImportResult,
  type VideoNormalizationProgress,
} from '../clip/sidecarClient';
import { frameBoundary } from '../clip/frameMath';
import type { ProjectManifest, VideoEntry } from '../types/project';
import { uniqueFileName } from './utils';
import { getDirectoryPath, removePath } from './fsAccess';
import { parseProjectManifest } from './projectFolder';
import { mutateProjectManifestExclusive } from './projectManifestRepository';

export type PrepareVideoFor = (
  file: File,
  options?: NormalizeVideoImportOptions,
) => Promise<NormalizedVideoImportResult>;

export interface ImportVideoOptions {
  prepare?: PrepareVideoFor;
  videoId?: string;
  onProgress?: (progress: VideoNormalizationProgress) => void;
  signal?: AbortSignal;
}

function normalizedFileName(sourceName: string): string {
  const leaf = sourceName.split(/[\\/]/).pop() || 'video';
  const dot = leaf.lastIndexOf('.');
  const base = (dot > 0 ? leaf.slice(0, dot) : leaf).trim() || 'video';
  return `${base}.mp4`;
}

function generatedVideoId(): string {
  return `video-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
}

export async function importVideoIntoProject(
  projectDir: ProjectDirectory,
  manifestInput: ProjectManifest,
  source: File,
  options: ImportVideoOptions = {},
): Promise<{ manifest: ProjectManifest; video: VideoEntry }> {
  if (projectDir.command) {
    const native = nativeFileInfo(source);
    if (!native) throw new Error('Choose the source video through the native file dialog.');
    options.signal?.throwIfAborted();
    const requestId = crypto.randomUUID();
    options.onProgress?.({ phase: 'analyzing', progress: 0 });
    const stop = desktopBridge().onProgress((progress) => {
      if (progress.requestId === requestId) options.onProgress?.({ phase: progress.phase as VideoNormalizationProgress['phase'], progress: progress.progress, phaseProgress: progress.progress });
    });
    const cancel = () => { void desktopBridge().request('video.cancelImport', { requestId }); };
    try {
      const pending = projectDir.command<{ manifest: ProjectManifest; video: VideoEntry }>('video.import', [native.id, requestId]);
      options.signal?.addEventListener('abort', cancel, { once: true });
      const result = await pending;
      options.onProgress?.({ phase: 'complete', progress: 1 });
      return result;
    } finally { stop(); options.signal?.removeEventListener('abort', cancel); }
  }
  parseProjectManifest(manifestInput);
  const prepare = options.prepare ?? prepareVideoImportWithMetadata;

  // Authoritative metadata must exist before any project file is created.
  const prepared = await prepare(source, {
    onProgress: options.onProgress,
    signal: options.signal,
  });
  options.signal?.throwIfAborted();
  const { metadata } = prepared;
  if (
    (metadata.frameCountSource !== 'normalize' && metadata.frameCountSource !== 'probe')
    || !Number.isInteger(metadata.frameCount)
    || metadata.frameCount <= 0
    || !Number.isFinite(metadata.fps)
    || metadata.fps <= 0
    || !Number.isInteger(metadata.width)
    || metadata.width <= 0
    || !Number.isInteger(metadata.height)
    || metadata.height <= 0
  ) {
    throw new Error('Prepared video metadata does not define a valid per-video frame contract.');
  }

  const videoId = options.videoId ?? generatedVideoId();
  let video: VideoEntry | null = null;
  let fileName: string | null = null;
  let mediaCreated = false;
  try {
    const next = await mutateProjectManifestExclusive(projectDir, async (latest) => {
      options.signal?.throwIfAborted();
      if (latest.videos.some((entry) => entry.id === videoId)) {
        throw new Error(`A video with id "${videoId}" already exists.`);
      }
      const mediaDirectory = await getDirectoryPath(projectDir, ['media'], false);
      fileName = await uniqueFileName(mediaDirectory, normalizedFileName(source.name));
      video = {
        id: videoId,
        label: source.name || fileName,
        file: `media/${fileName}`,
        fps: metadata.fps,
        frameCount: frameBoundary(metadata.frameCount),
        frameCountSource: metadata.frameCountSource,
        width: metadata.width,
        height: metadata.height,
      };
      const destination = await mediaDirectory.getFileHandle(fileName, { create: true });
      mediaCreated = true;
      const writable = await destination.createWritable();
      await writable.write(prepared.blob);
      await writable.close();
      options.signal?.throwIfAborted();
      return {
        ...latest,
        videos: [...latest.videos, video],
      };
    });
    if (!video) throw new Error('Video import completed without creating a manifest entry.');
    return { manifest: next, video };
  } catch (error) {
    if (mediaCreated && fileName) {
      await removePath(projectDir, ['media', fileName]).catch(() => undefined);
    }
    throw error;
  }
}
