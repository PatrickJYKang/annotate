import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recordingExports } from '../core/recording-export.mjs';

test('only the owning window/project can save the encoded take; close cleans up', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'result.mp4');
  await writeFile(outputPath, 'encoded frames');
  const calls = [];
  const upstream = async (url, body, method) => {
    calls.push({ url, body, method });
    return url === '/export/start' ? { sessionId: 'local-session', framesDir: root } : { outputPath };
  };
  const files = [];
  const store = {
    ensureDirectory: async () => {},
    writeBlob: async (project, name, blob) => files.push([project, name, await blob.text()]),
  };
  const first = recordingExports(upstream, store),
    second = recordingExports(upstream, store);
  const { sessionId } = await first.command('a', 'recording.start', [{ fps: 25, width: 640, height: 360 }]);
  await assert.rejects(second.command('a', 'recording.finish', [sessionId, 'Take.mp4']));
  await assert.rejects(first.command('b', 'recording.finish', [sessionId, 'Take.mp4']));
  await assert.rejects(first.command('a', 'recording.finish', [sessionId, '../Take.mp4']));
  await first.command('a', 'recording.frame', [sessionId, 0, 'data:image/jpeg;base64,eA==']);
  await first.command('a', 'recording.finish', [sessionId, 'Toma 2.mp4']);
  assert.deepEqual(files, [['a', 'exports/recordings/Toma 2.mp4', 'encoded frames']]);
  assert.deepEqual(calls[2].body, { sessionId, fps: 25 });
  await first.close();
  assert.equal(calls.at(-1).method, 'DELETE');
});
