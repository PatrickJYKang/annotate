import type { ProjectDirectory } from '../host/contracts';
import type { ProjectManifest } from '../types/project';
import { broadcastClipChanged, broadcastProjectChanged } from './clipEvents';
import { withClipExclusive } from './clipRepository';
import { listClips, readClip } from './clipStorage';
import { assertSafePathSegment, getDirectoryPath, splitSafeRelativePath } from './fsAccess';
import { writeProjectManifest } from './projectFolder';
import { requireLatestProjectManifest, withProjectManifestExclusive } from './projectManifestRepository';
import { deleteClipToTrash, hasClipTombstone, restoreClipFromTrash, type TrashOperationRecord } from './trash';

export interface VideoDeletionResult {
  manifest: ProjectManifest;
  deletedClipIds: string[];
}

export async function deleteVideoExclusive(projectDir: ProjectDirectory, videoId: string): Promise<VideoDeletionResult> {
  assertSafePathSegment(videoId);
  if (projectDir.command) return projectDir.command('video.delete', [videoId]);
  return withProjectManifestExclusive(projectDir, async () => {
    const manifest = await requireLatestProjectManifest(projectDir);
    const video = manifest.videos.find((entry) => entry.id === videoId);
    if (!video) throw new Error(`Video "${videoId}" is no longer in this project.`);
    const listed = await listClips(projectDir);
    if (listed.errors.length) throw new Error('Cannot delete video: some clips could not be read. Resolve the project integrity errors first.');
    const ids = listed.clips.filter((clip) => clip.videoId === videoId).map((clip) => clip.id).sort();
    const next = { ...manifest, videos: manifest.videos.filter((entry) => entry.id !== videoId) };

    // Hold every affected clip lock through commit/rollback so queued autosaves
    // cannot recreate a deleted clip or overwrite a restored one.
    const lockClips = (index: number): Promise<VideoDeletionResult> => index < ids.length
      ? withClipExclusive(projectDir, ids[index], () => lockClips(index + 1), { allowTombstone: true })
      : remove();
    const remove = async (): Promise<VideoDeletionResult> => {
      const deleted: TrashOperationRecord[] = [];
      let manifestWritten = false;
      try {
        for (const id of ids) {
          const current = await readClip(projectDir, id);
          if (!current.ok) {
            if (current.error.code === 'not-found' && await hasClipTombstone(projectDir, id)) continue;
            throw new Error(current.error.message);
          }
          deleted.push(await deleteClipToTrash(projectDir, id));
        }
        await writeProjectManifest(projectDir, next);
        manifestWritten = true;
        if (!next.videos.some((entry) => entry.file === video.file)) {
          const segments = splitSafeRelativePath(video.file);
          try {
            const parent = await getDirectoryPath(projectDir, segments.slice(0, -1));
            // Refuse directories, and never recursively remove anything in media/.
            await parent.getFileHandle(segments.at(-1)!);
            await parent.removeEntry(segments.at(-1)!);
          } catch (error) {
            if ((error as { name?: string })?.name !== 'NotFoundError') throw error;
          }
        }
      } catch (error) {
        const failures: unknown[] = [];
        if (manifestWritten) {
          await writeProjectManifest(projectDir, manifest).catch((cause) => failures.push(cause));
        }
        for (const record of deleted.reverse()) {
          await restoreClipFromTrash(projectDir, record.clipId, record.operationId).catch((cause) => failures.push(cause));
        }
        if (failures.length) {
          broadcastProjectChanged(projectDir);
          throw new Error(`Video deletion failed and could not be fully rolled back. Clip backups remain in .trash; reopen the project to inspect it. ${String(error)}`);
        }
        throw error;
      }
      broadcastClipChanged(projectDir, '*');
      broadcastProjectChanged(projectDir);
      return { manifest: next, deletedClipIds: deleted.map((record) => record.clipId) };
    };
    return lockClips(0);
  });
}
