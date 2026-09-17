import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NativeProjectStore, MAX_READ_BYTES, validateRelativePath } from '../core/project-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-native-'));
  const store = new NativeProjectStore();
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const project = await store.registerProject(root);
  return { root, store, project };
}

test('portable relative path contract rejects POSIX/Windows traversal and device/ADS names', () => {
  for (const value of ['', '../x', 'a/../x', '/tmp/x', 'C:\\x', '\\\\server\\share', 'C:x', 'a//b', 'nul.txt', 'a/COM1', 'x:stream', 'x.', 'x ', 'a\0b', 'a?b']) {
    assert.throws(() => validateRelativePath(value), { code: 'INVALID_PATH' }, value);
  }
  assert.deepEqual(validateRelativePath('analysis/clips/équipe one/clip.json'), ['analysis', 'clips', 'équipe one', 'clip.json']);
});

test('project registration deduplicates a folder and does not expose its path', async (t) => {
  const { root, store, project } = await fixture(t);
  assert.deepEqual(await store.registerProject(root), project);
  assert.deepEqual(Object.keys(project).sort(), ['id', 'name']);
  await assert.rejects(store.readDocument('untrusted-token', 'project.json'), { code: 'SESSION_CLOSED' });
});

test('JSON writes are create-only or revision-checked and commit atomically', async (t) => {
  const { root, store, project } = await fixture(t);
  const relative = 'analysis/équipe one/clip.json';
  const first = await store.replaceDocument(project.id, relative, { document: { value: 1 }, expectedRevision: null });
  const read = await store.readDocument(project.id, relative);
  assert.equal(read.revision, first.revision);
  assert.deepEqual(JSON.parse(read.text), { value: 1 });
  await assert.rejects(store.replaceDocument(project.id, relative, { document: {}, expectedRevision: null }), { code: 'CONFLICT' });
  const results = await Promise.allSettled([2, 3].map((value) => store.replaceDocument(project.id, relative, { document: { value }, expectedRevision: first.revision })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'CONFLICT');
  assert.equal(JSON.parse(await readFile(path.join(root, relative), 'utf8')).value, 2);
  assert.deepEqual(await readdir(path.dirname(path.join(root, relative))), ['clip.json']);
});

test('separate projects with identical filenames do not share revisions or contents', async (t) => {
  const { root, store, project } = await fixture(t);
  const folder = path.join(root, 'other');
  await mkdir(folder);
  const other = await store.registerProject(folder);
  await store.replaceDocument(project.id, 'project.json', { document: { name: 'a' }, expectedRevision: null });
  await store.replaceDocument(other.id, 'project.json', { document: { name: 'b' }, expectedRevision: null });
  assert.equal(JSON.parse((await store.readDocument(project.id, 'project.json')).text).name, 'a');
  assert.equal(JSON.parse((await store.readDocument(other.id, 'project.json')).text).name, 'b');
});

test('rejects symlink parents and leaf files without changing their targets', async (t) => {
  const { root, store, project } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'annotate-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'secret.json'), '{"secret":true}');
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.readDocument(project.id, 'escape/secret.json'), { code: 'UNSAFE_LINK' });
  await assert.rejects(store.replaceDocument(project.id, 'escape/new.json', { document: {}, expectedRevision: null }), { code: 'UNSAFE_LINK' });
  if (process.platform !== 'win32') {
    await symlink(path.join(outside, 'secret.json'), path.join(root, 'leaf.json'));
    await assert.rejects(store.authorizeFile(project.id, 'leaf.json'), { code: 'UNSAFE_LINK' });
  }
  assert.equal(await readFile(path.join(outside, 'secret.json'), 'utf8'), '{"secret":true}');
});

test('case-variant filenames are refused and malformed writes leave original data untouched', async (t) => {
  const { root, store, project } = await fixture(t);
  await writeFile(path.join(root, 'Clip.json'), '{}');
  await assert.rejects(store.replaceDocument(project.id, 'clip.json', { document: {}, expectedRevision: null }), { code: 'NAME_COLLISION' });
  await assert.rejects(store.replaceDocument(project.id, 'Clip.json', { document: {}, expectedRevision: 'wrong' }), { code: 'INVALID_REVISION' });
  assert.equal(await readFile(path.join(root, 'Clip.json'), 'utf8'), '{}');
});

test('media capabilities support bounded ranges, streams, and revocation', async (t) => {
  const { root, store, project } = await fixture(t);
  await writeFile(path.join(root, 'video.mp4'), '0123456789');
  const file = await store.authorizeFile(project.id, 'video.mp4');
  assert.deepEqual(Object.keys(file).sort(), ['id', 'name', 'size']);
  assert.equal((await store.readRange(file.id, 2, 4)).toString(), '2345');
  await assert.rejects(store.readRange(file.id, 0, MAX_READ_BYTES + 1), { code: 'INVALID_RANGE' });
  const { stream } = await store.openReadStream(file.id, 5, 8);
  let result = '';
  for await (const chunk of stream) result += chunk;
  assert.equal(result, '5678');
  await store.closeProject(project.id);
  await assert.rejects(store.readRange(file.id, 0, 1), { code: 'FILE_UNAVAILABLE' });
});

test('session closing drains pending writes and rejects subsequent requests', async (t) => {
  const { store, project } = await fixture(t);
  const write = store.replaceDocument(project.id, 'project.json', { document: {}, expectedRevision: null });
  const closing = store.closeProject(project.id);
  await assert.rejects(store.readDocument(project.id, 'project.json'), { code: 'SESSION_CLOSED' });
  await write;
  await closing;
});
