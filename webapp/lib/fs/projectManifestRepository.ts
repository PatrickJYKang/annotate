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

export const PROJECT_MANIFEST_LOCK_NAME = 'annotate:project-manifest';

export async function withProjectManifestExclusive<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return getLockManager().request(
    PROJECT_MANIFEST_LOCK_NAME,
    { mode: 'exclusive' },
    operation,
  );
}

async function requireLatestProjectManifest(
  projectDir: FileSystemDirectoryHandle,
): Promise<ProjectManifest> {
  const result = await readProjectManifest(projectDir);
  if (result.ok) return result.manifest;
  throw new ProjectManifestRepositoryError(
    'read-failed',
    `Cannot update project.json: ${result.reason}`,
  );
}

export async function mutateProjectManifestExclusive(
  projectDir: FileSystemDirectoryHandle,
  mutator: (latest: ProjectManifest) => ProjectManifest | Promise<ProjectManifest>,
): Promise<ProjectManifest> {
  return withProjectManifestExclusive(async () => {
    const latest = await requireLatestProjectManifest(projectDir);
    const next = parseProjectManifest(await mutator(structuredClone(latest)));
    await writeProjectManifest(projectDir, next);
    return next;
  });
}
