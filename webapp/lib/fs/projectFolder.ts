import {
  fetchDefaultTaggingBoard,
  parseTaggingBoard,
  readTaggingBoard,
  TAGGING_BOARD_FILENAME,
  type TaggingBoard,
} from '../tagging/board';
import {
  type MatchInfo,
} from '../types/metadata';
import type { ProjectManifest, VideoEntry } from '../types/project';
import {
  assertSafePathSegment,
  directoryIsEmpty,
  getDirectoryPath,
  isNotFoundError,
  readTextFile,
  splitSafeRelativePath,
  writeJsonFile,
  writeTextFile,
} from './fsAccess';

export type ProjectReadErrorCode =
  | 'missing-manifest'
  | 'invalid-json'
  | 'v1-project'
  | 'invalid-manifest'
  | 'io-error';

export type ProjectReadResult =
  | { ok: true; manifest: ProjectManifest }
  | { ok: false; code: ProjectReadErrorCode; reason: string };

export type ProjectOpenResult =
  | { ok: true; manifest: ProjectManifest; board: TaggingBoard }
  | { ok: false; code: ProjectReadErrorCode | 'missing-folder' | 'invalid-board'; reason: string };

export interface CreateProjectOptions {
  name: string;
  matchInfo?: MatchInfo;
  created?: string;
  defaultBoardSource?: string;
}

const AUTHORITATIVE_DIRECTORIES = [
  ['media'],
  ['analysis'],
  ['analysis', 'clips'],
  ['presentations'],
] as const;

const RECREATABLE_DIRECTORIES = [
  ['homography-cache'],
  ['derived-media'],
  ['exports'],
  ['cache'],
  ['.trash'],
  ['.trash', 'clips'],
  ['.trash', 'pins'],
  ['.trash', 'annotations'],
  ['.trash', 'tombstones'],
] as const;

const PROJECT_DIRECTORIES = [
  ...AUTHORITATIVE_DIRECTORIES,
  ...RECREATABLE_DIRECTORIES,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isPositiveFinite(value) && Number.isInteger(value);
}

function parseVideoEntry(raw: unknown, index: number): VideoEntry {
  if (!isRecord(raw)) throw new Error(`videos[${index}] must be an object.`);
  if (typeof raw.id !== 'string' || !raw.id) throw new Error(`videos[${index}].id is required.`);
  assertSafePathSegment(raw.id);
  if (typeof raw.label !== 'string') throw new Error(`videos[${index}].label is required.`);
  if (typeof raw.file !== 'string') throw new Error(`videos[${index}].file is required.`);
  const filePath = splitSafeRelativePath(raw.file);
  if (filePath.length < 2 || filePath[0] !== 'media') {
    throw new Error(`videos[${index}].file must be confined to the media/ folder.`);
  }
  if (!isPositiveFinite(raw.fps)) throw new Error(`videos[${index}].fps must be positive.`);
  if (!isPositiveInteger(raw.frameCount)) throw new Error(`videos[${index}].frameCount must be a positive integer.`);
  if (raw.frameCountSource !== 'normalize' && raw.frameCountSource !== 'probe') {
    throw new Error(`videos[${index}].frameCountSource must be normalize or probe.`);
  }
  if (!isPositiveInteger(raw.width) || !isPositiveInteger(raw.height)) {
    throw new Error(`videos[${index}] requires positive integer width and height.`);
  }
  return raw as unknown as VideoEntry;
}

export function parseProjectManifest(raw: unknown): ProjectManifest {
  if (!isRecord(raw)) throw new Error('project.json must contain an object.');
  if (raw.schema !== 'project.v2') throw new Error('project.json schema must be "project.v2".');
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('Project name is required.');
  if (typeof raw.created !== 'string' || !Number.isFinite(Date.parse(raw.created))) {
    throw new Error('Project created must be an ISO date string.');
  }
  if (!Array.isArray(raw.videos)) throw new Error('Project videos must be an array.');
  const videos = raw.videos.map(parseVideoEntry);
  if (new Set(videos.map((video) => video.id)).size !== videos.length) {
    throw new Error('Project video ids must be unique.');
  }
  return {
    schema: 'project.v2',
    name: raw.name,
    created: raw.created,
    videos,
    ...(raw.matchInfo === undefined ? {} : { matchInfo: raw.matchInfo as MatchInfo }),
  };
}

export async function readProjectManifest(
  projectDir: FileSystemDirectoryHandle,
): Promise<ProjectReadResult> {
  let source: string;
  try {
    source = await readTextFile(projectDir, ['project.json']);
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ok: false, code: 'missing-manifest', reason: 'Missing project.json.' };
    }
    return { ok: false, code: 'io-error', reason: error instanceof Error ? error.message : String(error) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-json',
      reason: `project.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (isRecord(raw) && raw.schema === 'project.v1') {
    return {
      ok: false,
      code: 'v1-project',
      reason: 'This project was created by Annotate 0.1 and cannot be opened by Annotate 0.2.',
    };
  }
  try {
    return { ok: true, manifest: parseProjectManifest(raw) };
  } catch (error) {
    return { ok: false, code: 'invalid-manifest', reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function writeProjectManifest(
  projectDir: FileSystemDirectoryHandle,
  manifest: ProjectManifest,
): Promise<void> {
  const parsed = parseProjectManifest(manifest);
  await writeJsonFile(projectDir, ['project.json'], parsed);
}

async function loadDefaultBoardSource(provided?: string): Promise<{ source: string; board: TaggingBoard }> {
  const source = provided ?? await fetchDefaultTaggingBoard();
  return { source, board: parseTaggingBoard(source) };
}

export async function createProject(
  projectDir: FileSystemDirectoryHandle,
  options: CreateProjectOptions,
): Promise<{ manifest: ProjectManifest; board: TaggingBoard }> {
  if (!(await directoryIsEmpty(projectDir))) {
    throw new Error('Create project requires an empty folder and will not overwrite existing content.');
  }
  const { source: boardSource, board } = await loadDefaultBoardSource(options.defaultBoardSource);
  const manifest: ProjectManifest = {
    schema: 'project.v2',
    name: options.name.trim() || 'Untitled Project',
    created: options.created ?? new Date().toISOString(),
    videos: [],
    matchInfo: options.matchInfo,
  };
  parseProjectManifest(manifest);

  for (const path of PROJECT_DIRECTORIES) {
    await getDirectoryPath(projectDir, path, true);
  }
  await writeTextFile(projectDir, [TAGGING_BOARD_FILENAME], boardSource);
  // The manifest is the commit marker: a partially created tree is not a project.
  await writeProjectManifest(projectDir, manifest);
  return { manifest, board };
}

export async function ensureProjectBoard(
  projectDir: FileSystemDirectoryHandle,
  defaultBoardSource?: string,
): Promise<TaggingBoard> {
  const existing = await readTaggingBoard(projectDir);
  if (existing) return existing;
  const { source, board } = await loadDefaultBoardSource(defaultBoardSource);
  await writeTextFile(projectDir, [TAGGING_BOARD_FILENAME], source);
  return board;
}

export async function validateProjectFolder(
  projectDir: FileSystemDirectoryHandle,
  defaultBoardSource?: string,
): Promise<ProjectOpenResult> {
  const manifestResult = await readProjectManifest(projectDir);
  if (!manifestResult.ok) return manifestResult;
  for (const path of AUTHORITATIVE_DIRECTORIES) {
    try {
      await getDirectoryPath(projectDir, path, false);
    } catch (error) {
      if (isNotFoundError(error)) {
        return { ok: false, code: 'missing-folder', reason: `Missing required folder: ${path.join('/')}/` };
      }
      return { ok: false, code: 'io-error', reason: error instanceof Error ? error.message : String(error) };
    }
  }
  for (const path of RECREATABLE_DIRECTORIES) {
    try {
      await getDirectoryPath(projectDir, path, true);
    } catch (error) {
      return { ok: false, code: 'io-error', reason: error instanceof Error ? error.message : String(error) };
    }
  }
  try {
    const board = await ensureProjectBoard(projectDir, defaultBoardSource);
    return { ok: true, manifest: manifestResult.manifest, board };
  } catch (error) {
    return { ok: false, code: 'invalid-board', reason: error instanceof Error ? error.message : String(error) };
  }
}
