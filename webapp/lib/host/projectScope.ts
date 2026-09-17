import type { ProjectDirectory } from './contracts';

export function projectResourceKey(project: ProjectDirectory, resource: string): string {
  return `annotate:project:${project.scopeId}:${resource}`;
}
