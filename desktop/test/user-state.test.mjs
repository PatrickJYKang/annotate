import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UserState } from '../core/user-state.mjs';

const resource = 'analysis/clips/clip-1/annotations/pin-1.json';
const entry = { contentHash: 'test', updatedAt: '2026-10-24T12:00:00Z', data: { shapes: [{ id: 'highlight-1' }] } };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = new UserState(root);
  await state.load();
  return { root, state };
}

test('native preferences and recovery survive relaunch independently of origins and project capabilities', async (t) => {
  const { root, state } = await fixture(t);
  await Promise.all([
    state.setPreference('annotate:locale', 'fr'),
    state.setPreference('react-resizable-panels:annotate:clip:viewer-timeline', '{"layout":[70,30]}'),
    state.writeRecovery('/projects/match', resource, entry),
  ]);
  await state.flush();
  const relaunched = new UserState(root);
  await relaunched.load();
  assert.deepEqual(relaunched.snapshot(), state.snapshot());
  assert.deepEqual(await relaunched.readRecovery('/projects/match', resource), entry);
  assert.equal(await relaunched.readRecovery('/projects/other', resource), null);
  await relaunched.setPreference('annotate:locale', null);
  assert.equal(relaunched.snapshot()['annotate:locale'], undefined);
  assert.equal((await readdir(root)).some((name) => name.endsWith('.tmp')), false);
});

test('damaged preferences are preserved without losing annotation recovery', async (t) => {
  const { root, state } = await fixture(t);
  await state.writeRecovery('/projects/match', resource, entry);
  await writeFile(path.join(root, 'preferences.json'), '{broken');
  const relaunched = new UserState(root);
  await relaunched.load();
  assert.deepEqual(relaunched.snapshot(), {});
  const damaged = (await readdir(root)).find((name) => name.startsWith('preferences-damaged-'));
  assert.equal(await readFile(path.join(root, damaged), 'utf8'), '{broken');
  assert.deepEqual(await relaunched.readRecovery('/projects/match', resource), entry);
});

test('failed recovery is not cleared by unrelated successful preferences; retry repairs it', async (t) => {
  const { root, state } = await fixture(t);
  await writeFile(path.join(root, 'recovery'), 'not a directory');
  await assert.rejects(state.writeRecovery('/projects/match', resource, entry));
  await state.setPreference('annotate:locale', 'es');
  await assert.rejects(state.flush(), /could not be saved/);
  await rm(path.join(root, 'recovery'));
  await state.writeRecovery('/projects/match', resource, entry);
  await state.flush();
});

test('failed settings write does not publish uncommitted preferences', async (t) => {
  const { root, state } = await fixture(t);
  await mkdir(path.join(root, 'preferences.json'));
  await assert.rejects(state.setPreference('annotate:locale', 'fr'));
  assert.deepEqual(state.snapshot(), {});
  await assert.rejects(state.flush());
  await rm(path.join(root, 'preferences.json'), { recursive: true });
  await state.setPreference('annotate:locale', 'en');
  await state.flush();
});

test('native state rejects unknown preferences, oversized snapshots and arbitrary recovery paths', async (t) => {
  const { state } = await fixture(t);
  assert.throws(() => state.setPreference('token', 'secret'), /Unknown preference/);
  assert.throws(() => state.setPreference('annotate:locale', 'invalid'), /Invalid language/);
  assert.throws(() => state.writeRecovery('/projects/match', '../../project.json', entry), /Invalid recovery/);
  assert.throws(() => state.writeRecovery('/projects/match', resource, { ...entry, data: 'a'.repeat(17 * 1024 * 1024) }), /too large/);
});
