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
  projectDir: FileSystemDirectoryHandle,
  manifestInput: ProjectManifest,
  source: File,
  options: ImportVideoOptions = {},
): Promise<{ manifest: ProjectManifest; video: VideoEntry }> {
  parseProjectManifest(manifestInput);
  const prepare = options.prepare ?? prepareVideoImportWithMetadata;

  // Authoritative metadata must exist before any project file is created.
  const prepared = await prepare(source, {
    onProgress: options.onProgress,
    signal: options.signal,
  });
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
