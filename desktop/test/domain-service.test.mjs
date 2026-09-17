import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { NativeProjectStore } from '../core/project-store.mjs';
import { repositoryDirectory } from '../core/repository-directory.mjs';
const domain = createRequire(import.meta.url)('../dist/domain-service.cjs');
const fixture = new URL('../../webapp/e2e/fixtures/clip-editor-project/', import.meta.url);

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-domain-'));
  await cp(fixture, root, { recursive: true });
  const store = new NativeProjectStore();
  const project = await store.registerProject(root);
  t.after(async () => { await store.close(); await rm(root, { force: true, recursive: true }); });
  const directory = repositoryDirectory(store, project.id);
  return { root, store, project, directory, command: (name, ...args) => domain.runDomainCommand(directory, name, args, '') };
}

test('real native repositories preserve unrelated clip edits and reject stale same-field changes', async (t) => {
  const { command, root } = await setup(t);
  const base = JSON.parse(await readFile(path.join(root, 'analysis/clips/clip-sequence/clip.json'), 'utf8'));
  await command('pin.rename', base.id, 'pin-shape', 'Native pin');
  const saved = await command('clip.patch', base.id, base, { ...base, label: 'Native clip' });
  assert.equal(saved.label, 'Native clip');
  assert.equal(saved.pins[0].label, 'Native pin');
  await assert.rejects(command('clip.patch', base.id, base, { ...base, label: 'Stale editor' }), /Save conflict/);
  await assert.rejects(command('clip.patch', base.id, base, { ...base, videoId: 'different' }), /not permitted/);
  await assert.rejects(command('not-a-command'), /Unknown project command/);
});

test('native pin saves, clip trash and restore use the shared domain invariants', async (t) => {
  const { command, root } = await setup(t);
  const document = JSON.parse(await readFile(path.join(root, 'analysis/clips/clip-sequence/annotations/ann-shape.json'), 'utf8'));
  await command('annotation.save', { ...document, label: 'Saved natively' });
  assert.equal(JSON.parse(await readFile(path.join(root, 'analysis/clips/clip-sequence/annotations/ann-shape.json'), 'utf8')).label, 'Saved natively');
  const deleted = await command('clip.delete', 'clip-sequence');
  await assert.rejects(command('annotation.save', document), /deleted|trash|exist|found/i);
  await command('clip.restore', 'clip-sequence', deleted.operationId);
  await command('annotation.save', document);
  await assert.rejects(command('project.create', { name: 'Overwrite' }), /empty folder/);
});

test('native blob cancellation leaves the previous file intact and removes staging files', async (t) => {
  const { store, project } = await setup(t);
  const before = await store.readDocument(project.id, 'project.json');
  await assert.rejects(store.writeBlob(project.id, 'project.json', new Blob(['new']), { signal: AbortSignal.abort() }));
  assert.equal((await store.readDocument(project.id, 'project.json')).text, before.text);
  assert.equal((await store.listDirectory(project.id)).some((entry) => entry.name.endsWith('.tmp')), false);
});

test('native video deletion cascades to clips and pin documents but retains presentations', async (t) => {
  const { command, root } = await setup(t);
  const before = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));
  const clip = JSON.parse(await readFile(path.join(root, 'analysis/clips/clip-sequence/clip.json'), 'utf8'));
  const deckFile = path.join(root, 'presentations/presentation-sequence.json');
  const deck = await readFile(deckFile, 'utf8');
  const result = await command('video.delete', before.videos[0].id);
  assert.equal(result.manifest.videos.length, 0);
  assert.deepEqual(result.deletedClipIds, ['clip-sequence']);
  await assert.rejects(readFile(path.join(root, before.videos[0].file)), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(root, 'analysis/clips/clip-sequence/annotations/ann-shape.json')), { code: 'ENOENT' });
  assert.equal(await readFile(deckFile, 'utf8'), deck);
  await assert.rejects(command('clip.create', { ...clip, id: 'late-clip' }), /no longer in this project/);
  await assert.rejects(command('clip.restore', clip.id), /no longer in this project/);
  await assert.rejects(command('clip.patch', clip.id, clip, { ...clip, label: 'Late save' }), /deleted|found/);
});
