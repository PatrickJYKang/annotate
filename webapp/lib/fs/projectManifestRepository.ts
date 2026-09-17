import type { ProjectDirectory } from "../host/contracts";
import { projectResourceKey } from '../host/projectScope';
import type { ProjectManifest } from '../types/project';
import {
  parseProjectManifest,
  readProjectManifest,
  writeProjectManifest,
} from './projectFolder';

export class ProjectManifestRepositoryError extends Error {
  readonly code: 'locks-unsupported' | 'read-failed';

  constructor(code: ProjectManifestRepositoryError['code'], message: string) {
    super(message);
    this.name = 'ProjectManifestRepositoryError';
    this.code = code;
  }
}

function getLockManager(): LockManager {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    throw new ProjectManifestRepositoryError(
      'locks-unsupported',
      'Annotate 0.2 requires Web Locks support to edit project data safely.',
    );
  }
  return locks;
}

export async function withProjectManifestExclusive<T>(
  projectDir: ProjectDirectory,
  operation: () => Promise<T>,
): Promise<T> {
  if (projectDir.withLock) return projectDir.withLock(projectResourceKey(projectDir, 'manifest'), 'exclusive', operation);
  return getLockManager().request(
    projectResourceKey(projectDir, 'manifest'),
    { mode: 'exclusive' },
    operation,
  );
}

export async function requireLatestProjectManifest(
  projectDir: ProjectDirectory,
): Promise<ProjectManifest> {
  const result = await readProjectManifest(projectDir);
  if (result.ok) return result.manifest;
  throw new ProjectManifestRepositoryError(
    'read-failed',
    `Cannot update project.json: ${result.reason}`,
  );
}

export async function requireProjectVideo(projectDir: ProjectDirectory, videoId: string): Promise<void> {
  const manifest = await requireLatestProjectManifest(projectDir);
  if (!manifest.videos.some((video) => video.id === videoId)) {
    throw new Error(`Video "${videoId}" is no longer in this project.`);
  }
}

export async function mutateProjectManifestExclusive(
  projectDir: ProjectDirectory,
  mutator: (latest: ProjectManifest) => ProjectManifest | Promise<ProjectManifest>,
): Promise<ProjectManifest> {
  if (projectDir.command) {
    const base = await requireLatestProjectManifest(projectDir);
    const next = parseProjectManifest(await mutator(structuredClone(base)));
    return projectDir.command('project.patch', [base, next]);
  }
  return withProjectManifestExclusive(projectDir, async () => {
    const latest = await requireLatestProjectManifest(projectDir);
    const next = parseProjectManifest(await mutator(structuredClone(latest)));
    await writeProjectManifest(projectDir, next);
    return next;
  });
}
