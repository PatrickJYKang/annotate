import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { inspectRendererPackaging, pruneUnusedImageOptimizer } from '../scripts/renderer-packaging.mjs';

async function fixture(t, unoptimized = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-renderer-packaging-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, contents) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), JSON.stringify(contents));
  };
  await put('.next-desktop/required-server-files.json', { config: { images: { unoptimized } } });
  for (const name of ['sharp', '@img/sharp-wasm32', '@img/sharp-libvips-darwin-arm64', 'next']) await put(`node_modules/${name}/package.json`, { name, version: '1.0.0' });
  return { root, put };
}

test('omits only the disabled image optimizer and records the actual built configuration', async t => {
  const f = await fixture(t);
  const record = await pruneUnusedImageOptimizer(f.root);
  assert.equal(record.omittedPackages.length, 3);
  assert.deepEqual(await inspectRendererPackaging(f.root), record);
  await access(path.join(f.root, 'node_modules/next/package.json'));
  await assert.rejects(access(path.join(f.root, 'node_modules/sharp')));
  await assert.rejects(access(path.join(f.root, 'node_modules/@img')));
});

test('legacy and changed renderers cannot silently lose native licence coverage', async t => {
  const f = await fixture(t, false);
  assert.equal(await inspectRendererPackaging(f.root), null);
  await assert.rejects(pruneUnusedImageOptimizer(f.root), /must be disabled/);
  await access(path.join(f.root, 'node_modules/sharp/package.json'));
  await f.put('.next-desktop/required-server-files.json', { config: { images: { unoptimized: true } } });
  await pruneUnusedImageOptimizer(f.root);
  await f.put('node_modules/sharp/package.json', { name: 'sharp' });
  await assert.rejects(inspectRendererPackaging(f.root), /still present/);
  await rm(path.join(f.root, 'node_modules/sharp'), { recursive: true });
  await f.put('.next-desktop/required-server-files.json', { config: { images: { unoptimized: true }, changed: true } });
  await assert.rejects(inspectRendererPackaging(f.root), /configuration changed/);
});

test('owned client-only marker remains inert normally and rejects server-component imports', async () => {
  const directory = fileURLToPath(new URL('../../webapp/vendor/client-only/', import.meta.url));
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json')));
  assert.equal(metadata.exports['.']['react-server'], './server.js');
  assert.equal(metadata.license, 'GPL-3.0-only');
  assert.match(await readFile(path.join(directory, 'LICENSE'), 'utf8'), /GNU GENERAL PUBLIC LICENSE/);
  assert.equal(execFileSync(process.execPath, ['-e', "require('client-only'); process.stdout.write('ok')"], { cwd: directory, encoding: 'utf8' }), 'ok');
  assert.throws(() => execFileSync(process.execPath, ['--conditions=react-server', '-e', "require('client-only')"], { cwd: directory, stdio: 'pipe' }), /Command failed/);
});
