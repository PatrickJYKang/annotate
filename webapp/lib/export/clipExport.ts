import { annotationPayloadFromDocument } from '../annotate/documentPayload';
import { createFrameRasterQueue, type FrameRasterQueue } from '../media/frameRaster';
import { getFilePath, isNotFoundError, removePath, splitSafeRelativePath, writeTextFile } from '../fs/fsAccess';
import { readPinAnnotationDocument } from '../fs/pinAnnotationStorage';
import { findBoardButton, type TaggingBoard } from '../tagging/board';
import type { TaggingSelection } from '../tagging/selection';
import type { Clip } from '../types/clip';
import type { ProjectManifest, VideoEntry } from '../types/project';
import { renderAnnotatedPng } from './d7Render';

export interface ClipExportRow {
  id: string;
  label: string;
  videoId: string;
  videoLabel: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  duration: string;
  primaryTag: string;
  primaryTagLabel: string;
  facets: Record<string, string | string[]>;
  pinCount: number;
  animatedAnnotationTotal: number;
  pinAnnotationDocumentTotal: number;
  pinAnnotationShapeTotal: number;
  annotatedFiles: string[];
}

export interface ClipExportFailure {
  clipId: string;
  pinId?: string;
  annotationId?: string;
  path?: string;
  error: string;
}

export interface ClipExportProgress {
  done: number;
  total: number;
  phase: 'rendering' | 'rendered' | 'writing' | 'complete';
  clipLabel?: string;
  frame?: number;
  annotationLabel?: string;
  annotationDone?: number;
  annotationTotal?: number;
  file?: string;
  failures?: number;
}

export interface ClipExportResult {
  rows: ClipExportRow[];
  failures: ClipExportFailure[];
  files: string[];
}

const REPORT_ROOT = ['exports', 'report'] as const;
const ANNOTATED_ROOT = [...REPORT_ROOT, 'annotated'] as const;

function safeFilePart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[-.]+|[-.]+$/g, '');
  return sanitized || 'item';
}

export function annotatedPinExportName(
  clipId: string,
  frame: number,
  pinId: string,
  annotationId: string,
): string {
  return `${safeFilePart(clipId)}-f${Math.max(0, Math.trunc(frame))}-${safeFilePart(pinId)}-${safeFilePart(annotationId)}.png`;
}

function formatDuration(frames: number, fps: number): string {
  const totalMs = Math.round((Math.max(0, frames) * 1000) / fps);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function facetsForCsv(facets: TaggingSelection['facets']): string {
  return Object.entries(facets)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([groupId, value]) => (
      Array.isArray(value)
        ? value.slice().sort().map((optionId) => `${groupId}=${optionId}`)
        : [`${groupId}=${value}`]
    ))
    .join('|');
}

function csvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function clipRowsToCsv(rows: readonly ClipExportRow[]): string {
  const fields: Array<keyof ClipExportRow | 'facetsCsv' | 'annotatedFilesCsv'> = [
    'id', 'label', 'videoId', 'videoLabel', 'startFrame', 'endFrame',
    'durationFrames', 'duration', 'primaryTag', 'primaryTagLabel', 'facetsCsv',
    'pinCount', 'animatedAnnotationTotal', 'pinAnnotationDocumentTotal',
    'pinAnnotationShapeTotal', 'annotatedFilesCsv',
  ];
  const lines = [fields.join(',')];
  for (const row of rows) {
    lines.push(fields.map((field) => {
      if (field === 'facetsCsv') return csvCell(facetsForCsv(row.facets));
      if (field === 'annotatedFilesCsv') return csvCell(row.annotatedFiles.join('|'));
      return csvCell(row[field]);
    }).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function ensureWritePermission(projectDir: FileSystemDirectoryHandle): Promise<void> {
  const current = projectDir.queryPermission ? await projectDir.queryPermission({ mode: 'readwrite' }) : 'granted';
  if (current === 'granted') return;
  const requested = projectDir.requestPermission ? await projectDir.requestPermission({ mode: 'readwrite' }) : 'denied';
  if (requested !== 'granted') throw new Error('Write permission was not granted.');
}

async function writeBlob(
  projectDir: FileSystemDirectoryHandle,
  segments: readonly string[],
  blob: Blob,
): Promise<void> {
  const handle = await getFilePath(projectDir, segments, true);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function rowBase(
  clip: Clip,
  video: VideoEntry | null,
  board: TaggingBoard,
): ClipExportRow {
  const primary = clip.tags.primary ?? '';
  return {
    id: clip.id,
    label: clip.label ?? '',
    videoId: clip.videoId,
    videoLabel: video?.label ?? '',
    startFrame: clip.startFrame,
    endFrame: clip.endFrame,
    durationFrames: clip.endFrame - clip.startFrame,
    duration: video ? formatDuration(clip.endFrame - clip.startFrame, video.fps) : '',
    primaryTag: primary,
    primaryTagLabel: primary ? findBoardButton(board, primary)?.label ?? '' : '',
    facets: structuredClone(clip.tags.facets),
    pinCount: clip.pins.length,
    animatedAnnotationTotal: clip.annotations.length,
    pinAnnotationDocumentTotal: clip.pins.reduce((sum, pin) => sum + pin.annotations.length, 0),
    pinAnnotationShapeTotal: 0,
    annotatedFiles: [],
  };
}

export async function exportAllClips(args: {
  projectDir: FileSystemDirectoryHandle;
  manifest: ProjectManifest;
  clips: readonly Clip[];
  board: TaggingBoard;
  onProgress?: (progress: ClipExportProgress) => void;
}): Promise<ClipExportResult> {
  const { projectDir, manifest, board, onProgress } = args;
  const clips = args.clips.slice().sort((left, right) => (
    left.videoId.localeCompare(right.videoId)
    || left.startFrame - right.startFrame
    || left.id.localeCompare(right.id)
  ));
  const annotationTotal = clips.reduce(
    (sum, clip) => sum + clip.pins.reduce((pinSum, pin) => pinSum + pin.annotations.length, 0),
    0,
  );
  const total = annotationTotal + 2;
  let done = 0;
  const failures: ClipExportFailure[] = [];
  const files: string[] = [];
  const rows: ClipExportRow[] = [];
  const queues = new Map<string, FrameRasterQueue>();
  const videos = new Map(manifest.videos.map((video) => [video.id, video]));

  await ensureWritePermission(projectDir);
  await removePath(projectDir, REPORT_ROOT, true).catch((error) => {
    if (!isNotFoundError(error)) throw error;
  });

  try {
    for (const clip of clips) {
      const video = videos.get(clip.videoId) ?? null;
      const row = rowBase(clip, video, board);
      rows.push(row);
      let queue = video ? queues.get(video.id) : undefined;
      if (video && !queue && clip.pins.some((pin) => pin.annotations.length > 0)) {
        try {
          const file = await getFilePath(projectDir, splitSafeRelativePath(video.file), false).then((handle) => handle.getFile());
          queue = createFrameRasterQueue(file);
          queues.set(video.id, queue);
        } catch (error) {
          failures.push({ clipId: clip.id, error: error instanceof Error ? error.message : String(error) });
        }
      }

      for (const pin of clip.pins) {
        let raster: Awaited<ReturnType<FrameRasterQueue['rasterize']>> | null = null;
        if (pin.annotations.length > 0 && queue && video) {
          try {
            raster = await queue.rasterize({ frame: pin.frame, fps: video.fps, outputWidth: video.width });
          } catch (error) {
            failures.push({ clipId: clip.id, pinId: pin.id, error: error instanceof Error ? error.message : String(error) });
          }
        }
        for (const reference of pin.annotations) {
          const name = annotatedPinExportName(clip.id, pin.frame, pin.id, reference.id);
          const relativePath = [...ANNOTATED_ROOT, name].join('/');
          onProgress?.({
            done,
            total,
            phase: 'rendering',
            clipLabel: clip.label || clip.id,
            frame: pin.frame,
            annotationLabel: reference.label || reference.id,
          });
          try {
            if (!raster) throw new Error(video ? 'The pin frame could not be rasterized.' : `Video "${clip.videoId}" does not resolve.`);
            const result = await readPinAnnotationDocument(projectDir, clip.id, reference.id);
            if (!result.document) throw new Error(result.error ?? `Annotation document "${reference.id}" is missing.`);
            const bitmap = await createImageBitmap(raster.blob);
            let rendered: Blob;
            try {
              rendered = await renderAnnotatedPng({ bmp: bitmap, payload: annotationPayloadFromDocument(result.document) });
            } finally {
              bitmap.close();
            }
            await writeBlob(projectDir, [...ANNOTATED_ROOT, name], rendered);
            row.pinAnnotationShapeTotal += result.document.shapes.length;
            row.annotatedFiles.push(relativePath);
            files.push(relativePath);
          } catch (error) {
            failures.push({
              clipId: clip.id,
              pinId: pin.id,
              annotationId: reference.id,
              path: relativePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          done += 1;
          onProgress?.({ done, total, phase: 'rendered', annotationDone: done, annotationTotal });
        }
      }
    }

    const jsonPath = [...REPORT_ROOT, 'clips.json'];
    onProgress?.({ done, total, phase: 'writing', file: 'clips.json' });
    await writeTextFile(projectDir, jsonPath, JSON.stringify(rows, null, 2));
    files.push(jsonPath.join('/'));
    done += 1;

    const csvPath = [...REPORT_ROOT, 'clips.csv'];
    onProgress?.({ done, total, phase: 'writing', file: 'clips.csv' });
    await writeTextFile(projectDir, csvPath, clipRowsToCsv(rows));
    files.push(csvPath.join('/'));
    done += 1;
    onProgress?.({ done, total, phase: 'complete', failures: failures.length });
    return { rows, failures, files };
  } finally {
    queues.forEach((queue) => queue.dispose());
  }
}
