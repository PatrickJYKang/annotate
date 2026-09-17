import type { ProjectDirectory } from "../host/contracts";
import { getAppHost } from '../host';
import type { TaggingBoard } from '../tagging/board';
import type { ProjectManifest } from '../types/project';
import { validateProjectFolder } from '../fs/projectFolder';
import { cleanupTrash } from '../fs/trash';
import {
  checkProjectOnOpen,
  type ProjectIntegrityReport,
} from '../utils/projectIntegrity';

export interface RestoredProjectHandle {
  projectDir: ProjectDirectory;
  manifest: ProjectManifest;
  board: TaggingBoard;
  integrityReport: ProjectIntegrityReport;
}

export class ProjectPermissionRequiredError extends Error {
  constructor(readonly projectDir: ProjectDirectory) {
    super('Reconnect the project to renew access to its folder.');
    this.name = 'ProjectPermissionRequiredError';
  }
}

export async function saveProjectHandle(handle: ProjectDirectory): Promise<ProjectDirectory> {
  return getAppHost().projects.remember(handle);
}

export async function loadProjectHandle(): Promise<ProjectDirectory | null> {
  return getAppHost().projects.restore();
}

export async function clearProjectHandle(): Promise<void> {
  await getAppHost().projects.forget();
}

export function shareProjectHandle(handle: ProjectDirectory): (() => void) | undefined {
  return getAppHost().projects.share?.(handle);
}

async function requireReadWritePermission(handle: ProjectDirectory, allowRequest: boolean): Promise<void> {
  const current = handle.queryPermission
    ? await handle.queryPermission({ mode: 'readwrite' })
    : 'granted';
  if (current === 'granted') return;
  if (!allowRequest) throw new ProjectPermissionRequiredError(handle);
  const requested = handle.requestPermission
    ? await handle.requestPermission({ mode: 'readwrite' })
    : 'denied';
  if (requested !== 'granted') {
    throw new Error('Stored project permission is unavailable. Open the project again to continue.');
  }
}

export async function openProjectFromHandle(
  handle: ProjectDirectory,
  options: { requestPermission?: boolean } = {},
): Promise<RestoredProjectHandle> {
  await requireReadWritePermission(handle, options.requestPermission !== false);
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
    return await openProjectFromHandle(handle, { requestPermission: false });
  } catch (error) {
    if (error instanceof ProjectPermissionRequiredError) throw error;
    await getAppHost().projects.forget({ retainSession: true }).catch(() => undefined);
    throw error;
  }
}
