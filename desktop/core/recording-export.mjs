import { openAsBlob } from 'node:fs';

// Each window owns its sessions. Neither input nor output filesystem paths cross IPC.
export function recordingExports(upstream, store) {
  const sessions = new Map();
  let closed = false;
  const discard = (id) => upstream('/export/' + id, null, 'DELETE').catch(() => {});
  return {
    async command(project, action, args) {
      const [id, value, image] = args;
      if (action === 'recording.start') {
        const { fps, width, height } = id ?? {};
        if (
          closed ||
          !Number.isFinite(fps) ||
          fps <= 0 ||
          ![width, height].every((n) => Number.isSafeInteger(n) && n > 0)
        )
          throw new Error('Invalid recording format.');
        const { sessionId } = await upstream('/export/start', { clipId: 'recording', fps, width, height });
        if (closed) {
          await discard(sessionId);
          throw new Error('Window closed.');
        }
        sessions.set(sessionId, { project, fps });
        return { sessionId };
      }
      const session = sessions.get(id);
      if (!session || session.project !== project) throw new Error('Unknown recording session.');
      if (
        action === 'recording.frame' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        typeof image === 'string' &&
        image.startsWith('data:image/jpeg;base64,') &&
        image.length <= 32 * 1024 * 1024
      ) {
        await upstream('/export/frame', { sessionId: id, frameIndex: value, image });
        return;
      }
      if (
        action === 'recording.finish' &&
        typeof value === 'string' &&
        /^[\p{L}\p{N} _-]{1,160}\.mp4$/u.test(value)
      ) {
        const { outputPath } = await upstream('/export/encode', { sessionId: id, fps: session.fps });
        if (closed) throw new Error('Window closed.');
        await store.ensureDirectory(project, 'exports/recordings');
        await store.writeBlob(project, 'exports/recordings/' + value, await openAsBlob(outputPath));
        return;
      }
      if (action === 'recording.cleanup') {
        sessions.delete(id);
        await discard(id);
        return;
      }
      throw new Error('Invalid recording command.');
    },
    async close() {
      closed = true;
      await Promise.all([...sessions.keys()].map(discard));
      sessions.clear();
    },
  };
}
