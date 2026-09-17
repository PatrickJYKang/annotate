import * as clips from '../../webapp/lib/fs/clipRepository';
import * as pins from '../../webapp/lib/fs/pinAnnotationStorage';
import * as projects from '../../webapp/lib/fs/projectFolder';
import * as manifests from '../../webapp/lib/fs/projectManifestRepository';
import * as presentations from '../../webapp/lib/fs/presentationStorage';
import * as trash from '../../webapp/lib/fs/trash';
import { deleteVideoExclusive } from '../../webapp/lib/fs/videoDeletion';
import type { ProjectDirectory } from '../../webapp/lib/host/contracts';
import { parseClip } from '../../webapp/lib/types/clip';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeOwnedFields<T extends object>(latest: T, base: T, next: T, allowed: string[]): T {
  const merged = { ...latest };
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const field = key as keyof T;
    if (equal(base[field], next[field])) continue;
    if (!allowed.includes(key)) throw new Error(`Changing ${key} is not permitted.`);
    if (!equal(latest[field], base[field]) && !equal(latest[field], next[field])) throw new Error(`Save conflict: ${key} changed in another editor. Reload before saving.`);
    merged[field] = next[field];
  }
  return merged;
}

export async function runDomainCommand(directory: ProjectDirectory, name: string, args: unknown[], boardSource: string): Promise<unknown> {
  if (!Array.isArray(args) || args.length > 8) throw new Error('Invalid command arguments.');
  const commands: Record<string, (...values: any[]) => unknown> = {
    'project.create': (options) => projects.createProject(directory, { ...options, defaultBoardSource: boardSource }),
    'project.validate': () => projects.validateProjectFolder(directory, boardSource),
    'project.patch': (base, next) => manifests.mutateProjectManifestExclusive(directory, (latest) => mergeOwnedFields(latest, projects.parseProjectManifest(base), projects.parseProjectManifest(next), ['name', 'matchInfo'])),
    'clip.patch': (id, base, next) => clips.mutateClipExclusive(directory, id, (latest) => mergeOwnedFields(latest, parseClip(base, { folderId: id }), parseClip(next, { folderId: id }), ['label', 'tags', 'startFrame', 'endFrame', 'pins', 'annotations'])),
    'clip.create': (clip) => clips.createClipExclusive(directory, clip),
    'video.delete': (id) => deleteVideoExclusive(directory, id),
    'clip.delete': (id, options) => clips.deleteClipExclusive(directory, id, options),
    'clip.restore': (id, operation) => clips.restoreClipExclusive(directory, id, operation),
    'pin.create': (id, pin) => pins.createPinExclusive(directory, id, pin),
    'pin.rename': (id, pin, label) => pins.renamePinExclusive(directory, id, pin, label),
    'pin.delete': (id, pin, options) => pins.deletePinExclusive(directory, id, pin, options),
    'pin.restore': (id, pin, operation) => pins.restorePinExclusive(directory, id, pin, operation),
    'annotation.create': (document, options) => pins.createPinAnnotationExclusive(directory, document, options),
    'annotation.save': (document) => pins.savePinAnnotationExclusive(directory, document),
    'annotation.delete': (id, pin, annotation, options) => pins.deletePinAnnotationExclusive(directory, id, pin, annotation, options),
    'annotation.restore': (id, pin, annotation, operation) => pins.restorePinAnnotationExclusive(directory, id, pin, annotation, operation),
    'presentation.save': (document) => presentations.writePresentation(directory, document),
    'presentation.rename': (id, label, now) => presentations.renamePresentation(directory, id, label, now),
    'presentation.duplicate': (id, options) => presentations.duplicatePresentation(directory, id, options),
    'presentation.delete': (id) => presentations.deletePresentation(directory, id),
    'trash.cleanup': (options) => trash.cleanupTrash(directory, options),
  };
  if (!Object.hasOwn(commands, name)) throw new Error('Unknown project command.');
  return commands[name](...args);
}

export { projects, clips, pins, presentations, manifests };
