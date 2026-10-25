import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectNotices, supplementNotices } from '../scripts/collect-notices.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-notices-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (relative, value) => {
    const filename = path.join(root, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, typeof value === 'string' ? value : JSON.stringify(value));
  };
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/licence-review.md', 'docs/distribution-compliance.md', 'webapp/node_modules/@fontsource-variable/ibm-plex-sans/LICENSE']) await put(file, 'licence text');
  await put('runtime/renderer/node_modules/server/package.json', { name: 'server', version: '1.0.0' });
  await put('webapp/node_modules/server/package.json', { name: 'server', version: '1.0.0', license: 'MIT' });
  await put('webapp/node_modules/server/LICENSE', 'server licence');
  await put('webapp/node_modules/server/dist/compiled/other/LICENSE', 'vendored licence');
  await put('webapp/node_modules/client/package.json', { name: 'client', version: '2.0.0', license: 'MIT' });
  await put('webapp/node_modules/client/LICENSE', 'browser licence');
  await put('webapp/node_modules/no-notices/package.json', { name: 'no-notices', version: '1.0.0', license: 'LGPL-3.0' });
  await put('webapp/node_modules/no-notices/README.md', 'See upstream for licenses.');
  await put('webapp/node_modules/no-notices/versions.json', { nativeLibrary: '1.2.3' });
  const lock = { packages: { '': {}, 'node_modules/server': { version: '1.0.0' }, 'node_modules/client': { version: '2.0.0' }, 'node_modules/no-notices': { version: '1.0.0' }, 'node_modules/dev-only': { dev: true }, 'node_modules/absent-platform': { optional: true } } };
  await put('webapp/package-lock.json', lock);
  await put('site-packages/opencv-1.0.dist-info/METADATA', 'Name: opencv\nVersion: 1.0\nClassifier: License :: OSI Approved :: Apache Software License\n');
  await put('site-packages/opencv-1.0.dist-info/licenses/LICENSE', 'wrapper licence');
  await put('site-packages/cv2/LICENSE-3RD-PARTY.txt', 'native LGPL notices');
  return { root, put, lock, runtime: path.join(root, 'runtime'), site: path.join(root, 'site-packages'), output: path.join(root, 'evidence') };
}

test('collects browser, server, nested vendor and native wheel notices separately from runtime', async (t) => {
  const f = await fixture(t);
  await collectNotices(f.root, f.runtime, f.site, f.output);
  const { packages } = JSON.parse(await readFile(path.join(f.output, 'dependency-inventory.json')));
  assert.deepEqual(packages.find((p) => p.name === 'server').scopes, ['server-runtime', 'production-build-input']);
  assert.deepEqual(packages.find((p) => p.name === 'client').scopes, ['production-build-input']);
  assert.equal(await readFile(path.join(f.output, 'javascript/server@1.0.0/dist/compiled/other/LICENSE'), 'utf8'), 'vendored licence');
  assert.equal(await readFile(path.join(f.output, 'python/bundled-notices/cv2/LICENSE-3RD-PARTY.txt'), 'utf8'), 'native LGPL notices');
  assert.match(packages.find((p) => p.name === 'opencv').license, /Apache Software License/);
  assert.equal(packages.find((p) => p.name === 'no-notices').noticeReviewRequired, true);
  await access(path.join(f.output, 'javascript/no-notices@1.0.0/versions.json'));
  assert.equal(packages.some((p) => p.name === 'dev-only'), false);
  await assert.rejects(access(path.join(f.runtime, 'licenses')));
});

test('rejects stale production package versions, including installed optional packages', async (t) => {
  const f = await fixture(t);
  f.lock.packages['node_modules/client'] = { version: '3.0.0', optional: true };
  await f.put('webapp/package-lock.json', f.lock);
  await assert.rejects(collectNotices(f.root, f.runtime, f.site, f.output), /differs from lockfile/);
});

test('removes stale generated notices but preserves independently staged legal material', async (t) => {
  const f = await fixture(t);
  await f.put('evidence/javascript/deleted/LICENSE', 'stale');
  await f.put('evidence/msvc/EULA.txt', 'preserve');
  await collectNotices(f.root, f.runtime, f.site, f.output);
  await assert.rejects(access(path.join(f.output, 'javascript/deleted/LICENSE')));
  assert.equal(await readFile(path.join(f.output, 'msvc/EULA.txt'), 'utf8'), 'preserve');
});

test('restores exact Next monorepo and bundled dotenv notices without inventing attribution', async (t) => {
  const f = await fixture(t);
  await mkdir(f.output);
  const env = await supplementNotices({ name: '@next/env', version: '15.5.28' }, f.output);
  assert.equal(env.length, 3);
  assert.match(await readFile(path.join(f.output, env[0]), 'utf8'), /2025 Vercel/);
  assert.match(await readFile(path.join(f.output, env[1]), 'utf8'), /2015, Scott Motte/);
  assert.equal((await supplementNotices({ name: '@next/swc-darwin-arm64', version: '15.5.28' }, f.output)).length, 1);
  assert.deepEqual(await supplementNotices({ name: '@next/env', version: '15.5.29' }, f.output), []);
  assert.deepEqual(await supplementNotices({ name: 'client-only', version: '0.0.1' }, f.output), []);
});

test('libvips receives real native notices while retaining the separate source-review flag', async (t) => {
  const f = await fixture(t);
  const name = '@img/sharp-libvips-darwin-arm64';
  await f.put(`webapp/node_modules/${name}/package.json`, { name, version: '1.3.4', license: 'LGPL-3.0-or-later' });
  f.lock.packages[`node_modules/${name}`] = { version: '1.3.4' };
  await f.put('webapp/package-lock.json', f.lock);
  await f.put('sources/index.json', { archives: [{ name: 'sharp-native-vips', version: '8.18.7', kind: 'sharp-native-source', url: 'https://example.test/vips.tar.xz', sha256: 'test', coverage: 'partial native source' }] });
  await f.put('sources/notices/sharp-native-vips/vips/COPYING', 'upstream LGPL text');
  await collectNotices(f.root, f.runtime, f.site, f.output, path.join(f.root, 'sources'));
  const { packages } = JSON.parse(await readFile(path.join(f.output, 'dependency-inventory.json')));
  const record = packages.find((item) => item.name === name);
  assert.equal(record.noticeReviewRequired, false);
  assert.equal(record.nativeDependencyReviewRequired, true);
  assert.match(record.notices[0], /native\/sharp-native-vips\/vips\/COPYING/);
});
