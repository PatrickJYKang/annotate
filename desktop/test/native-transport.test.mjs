import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NativeProjectStore } from '../core/project-store.mjs';
import { createProjectConnection } from '../core/project-connection.mjs';
import { startMediaServer, parseByteRange } from '../core/media-server.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-transport-'));
  const store = new NativeProjectStore();
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const project = await store.registerProject(root);
  await writeFile(path.join(root, 'video.mp4'), '0123456789');
  return { store, project };
}

test('renderer connections reject unknown operations, project substitution, and foreign file tokens', async (t) => {
  const { store, project } = await fixture(t);
  const a = createProjectConnection(store, project.id);
  const b = createProjectConnection(store, project.id);
  const file = await a.dispatch({ type: 'authorizeFile', path: 'video.mp4' });
  assert.equal(file.ok, true);
  assert.deepEqual((await a.dispatch({ type: 'readRange', fileId: file.result.id, start: 1, length: 2 })).result, [49, 50]);
  assert.equal((await b.dispatch({ type: 'readRange', fileId: file.result.id, start: 1, length: 2 })).error.code, 'FILE_UNAVAILABLE');
  assert.equal((await a.dispatch({ type: 'listDirectory', path: '', projectId: 'another' })).error.code, 'INVALID_REQUEST');
  assert.equal((await a.dispatch({ type: 'executeShell', command: 'anything' })).error.code, 'INVALID_REQUEST');
  assert.equal((await a.dispatch({ type: 'readDocument', path: '../secret' })).error.code, 'INVALID_PATH');
  a.close();
  assert.equal((await a.dispatch({ type: 'listDirectory', path: '' })).error.code, 'SESSION_CLOSED');
  assert.equal((await b.dispatch({ type: 'listDirectory', path: '' })).ok, true);
  b.close();
});

test('byte ranges handle suffix/open-ended/bounded requests and reject invalid or multiple ranges', () => {
  assert.deepEqual(parseByteRange('bytes=2-4', 10), { start: 2, end: 4, partial: true });
  assert.deepEqual(parseByteRange('bytes=8-', 10), { start: 8, end: 9, partial: true });
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9, partial: true });
  for (const range of ['bytes=10-', 'bytes=-0', 'bytes=7-2', 'bytes=1-2,4-5', 'bytes=-', 'garbage']) assert.equal(parseByteRange(range, 10), null);
});

test('revocation also rejects queued file reads before they can start', async (t) => {
  const { store, project } = await fixture(t);
  for (const read of [
    (id) => store.readRange(id, 0, 2),
    (id) => store.openReadStream(id),
    (id) => store.fileInfo(id),
  ]) {
    const file = await store.authorizeFile(project.id, 'video.mp4');
    const reading = read(file.id);
    store.releaseFile(file.id);
    await assert.rejects(reading, { code: 'FILE_UNAVAILABLE' });
  }
});

test('loopback media uses authorized streaming with Range, HEAD, origin checks, and revocation', async (t) => {
  const { store, project } = await fixture(t);
  const server = await startMediaServer(store, { allowedOrigins: ['http://127.0.0.1:3000'] });
  try {
    const media = await server.register(project.id, 'video.mp4');
    let response = await fetch(media.url, { headers: { Range: 'bytes=2-5', Origin: 'http://127.0.0.1:3000' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
    assert.equal(await response.text(), '2345');
    response = await fetch(media.url, { method: 'HEAD' });
    assert.equal(response.headers.get('content-length'), '10');
    assert.equal(await response.text(), '');
    assert.equal((await fetch(media.url, { headers: { Origin: 'https://malicious.example' } })).status, 403);
    assert.equal((await fetch(media.url, { headers: { Range: 'bytes=20-' } })).status, 416);
    assert.equal((await fetch(`${server.origin}/etc/passwd`)).status, 404);
    server.release(media.id);
    assert.equal((await fetch(media.url)).status, 404);
  } finally { await server.close(); }
});
