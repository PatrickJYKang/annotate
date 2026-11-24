import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateSourceLock, stageLicenseSources, validateNativeVersions, sourceNoticePath, readNativeVersions } from '../scripts/prepare-license-sources.mjs';
import { pruneUnusedImageOptimizer } from '../scripts/renderer-packaging.mjs';

const contents = 'source archive fixture';
const source = { name: 'example', version: '1.2.3', kind: 'python-sdist', filename: 'example-1.2.3.tar.gz', url: 'https://example.test/source.tar.gz', sha256: createHash('sha256').update(contents).digest('hex') };
const lock = () => ({ schema: 1, archives: [{ ...source }] });

test('repository Python source pins match locked requirements', async () => {
  const pins = JSON.parse(await readFile(new URL('../compliance/sources.lock.json', import.meta.url), 'utf8'));
  const requirements = await readFile(new URL('../../sidecar/requirements.lock.txt', import.meta.url), 'utf8');
  validateSourceLock(pins, requirements);
  assert.deepEqual(pins.archives.filter((item) => item.kind === 'python-sdist').map((item) => item.name).sort(), ['opencv-python', 'shapely', 'ultralytics', 'ultralytics-thop']);
});

test('source lock requires safe paths, HTTPS, checksums and exact Python versions', () => {
  validateSourceLock(lock(), 'example==1.2.3\n');
  assert.throws(() => validateSourceLock(lock(), 'example==1.2.4'), /stale/);
  for (const change of [{ filename: '../example.tar.gz' }, { filename: '/tmp/example.tar.gz' }, { name: '../unsafe' }, { targets: ['unknown'] }, { url: 'http://example.test/a' }, { sha256: 'abc' }]) {
    assert.throws(() => validateSourceLock({ schema: 1, archives: [{ ...source, ...change }] }, 'example==1.2.3'));
  }
  assert.throws(() => validateSourceLock({ schema: 1, archives: [source, source] }, 'example==1.2.3'), /duplicate/);
  for (const extension of ['tar.bz2', 'tar.lz', 'zip', 'rb', 'json', 'lock']) validateSourceLock({ schema: 1, archives: [{ ...source, filename: `source.${extension}` }] }, 'example==1.2.3');
  assert.throws(() => validateSourceLock({ schema: 1, archives: [{ ...source, filename: 'formula.rb', collectNotices: true }] }, 'example==1.2.3'), /Only source archives/);
});

test('native source pins must match every shipped libvips library exactly', () => {
  const archives = [{ kind: 'sharp-native-source', library: 'vips', version: '8.18.7' }];
  validateNativeVersions(archives, { vips: '8.18.7' });
  assert.throws(() => validateNativeVersions(archives, { vips: '8.18.8' }), /stale/);
  assert.throws(() => validateNativeVersions(archives, { vips: '8.18.7', glib: '2.90.0' }), /lacks libraries/);
  assert.throws(() => validateNativeVersions([{kind: 'sharp-subproject-source', name: 'gvdb', parent: { library: 'glib', version: '2.90.0' }}], { glib: '2.91.0' }), /subproject source lock is stale/);
});

test('missing traced versions.json requires identical binary, not just a matching package label', async (t) => {
  const f = await fixture(t);
  const relative = 'node_modules/@img/sharp-libvips-darwin-arm64';
  const original = path.join(f.root, 'webapp', relative);
  const staged = path.join(f.root, 'desktop/build/darwin-arm64/runtime/renderer', relative);
  for (const directory of [original, staged]) {
    await mkdir(path.join(directory, 'lib'), { recursive: true });
    await writeFile(path.join(directory, 'package.json'), '{"version":"1.3.4"}');
    await writeFile(path.join(directory, 'lib/vips.dylib'), 'same binary');
  }
  await writeFile(path.join(original, 'versions.json'), '{"vips":"8.18.7"}');
  assert.deepEqual((await readNativeVersions(f.root, 'darwin-arm64')).versions, { vips: '8.18.7' });
  await writeFile(path.join(staged, 'lib/vips.dylib'), 'different binary');
  await assert.rejects(readNativeVersions(f.root, 'darwin-arm64'), /binary differs/);
});

test('source notice paths cannot escape the destination', () => {
  for (const member of ['../../LICENSE', '/tmp/LICENSE', 'root/../LICENSE', 'root\\LICENSE', '-C/LICENSE']) assert.throws(() => sourceNoticePath(member), /Unsafe/);
  assert.equal(sourceNoticePath('vips/COPYING'), 'vips/COPYING');
  assert.equal(sourceNoticePath('freetype/docs/FTL.TXT'), 'freetype/docs/FTL.TXT');
  assert.equal(sourceNoticePath('vips/source.c'), null);
  assert.equal(sourceNoticePath('vmaf/matlab/MEX/-MacReadMe'), null);
  assert.equal(sourceNoticePath('vips/LICENSE/'), null);
});

test('native notices ship without bloating installers with evidence-only source archives', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'upstream'));
  await writeFile(path.join(f.root, 'upstream/LICENSE'), 'authentic upstream notice');
  await writeFile(path.join(f.root, 'upstream/source.c'), 'int main() {}');
  const archive = execFileSync('tar', ['-czf', '-', '-C', f.root, 'upstream']);
  const native = { ...source, kind: 'native-source-input', evidenceOnly: true, collectNotices: true, sha256: createHash('sha256').update(archive).digest('hex') };
  await writeFile(path.join(f.root, 'desktop/compliance/sources.lock.json'), JSON.stringify({ schema: 1, archives: [native] }));
  const fetchArchive = async () => new Response(archive);
  const packaged = await stageLicenseSources(f.root, f.output, 'darwin-arm64', fetchArchive);
  assert.equal(packaged.archives[0].archiveIncluded, false);
  assert.deepEqual(packaged.archives[0].notices, ['upstream/LICENSE']);
  await assert.rejects(access(path.join(f.output, source.filename)));
  assert.equal(await readFile(path.join(f.output, 'notices/example/upstream/LICENSE'), 'utf8'), 'authentic upstream notice');
  await assert.rejects(access(path.join(f.output, 'notices/example/upstream/source.c')));
  const evidence = await stageLicenseSources(f.root, f.output, 'darwin-arm64', fetchArchive, { evidence: true });
  assert.equal(evidence.archives[0].archiveIncluded, true);
  await access(path.join(f.output, source.filename));
});

test('pinned Cargo lock expands into verified source evidence and packaged notices', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'example-1.2.3'));
  await writeFile(path.join(f.root, 'example-1.2.3/LICENSE'), 'original crate licence');
  const crate = execFileSync('tar', ['-czf', '-', '-C', f.root, 'example-1.2.3']);
  const checksum = createHash('sha256').update(crate).digest('hex');
  const cargo = `version = 3\n\n[[package]]\nname = "workspace"\nversion = "0.1.0"\n\n[[package]]\nname = "example"\nversion = "1.2.3"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"\n`;
  const parent = { ...source, name: 'cargo-lock', kind: 'build-input', filename: 'Cargo.lock', sha256: createHash('sha256').update(cargo).digest('hex'), evidenceOnly: true, expandCargoLock: true, targets: ['darwin-arm64'] };
  await writeFile(path.join(f.root, 'desktop/compliance/sources.lock.json'), JSON.stringify({ schema: 1, archives: [parent] }));
  const urls = [];
  const fetchArchive = async (url) => {
    urls.push(url);
    return new Response(url === parent.url ? cargo : crate);
  };
  const packaged = await stageLicenseSources(f.root, f.output, 'darwin-arm64', fetchArchive);
  assert.deepEqual(urls, [parent.url, 'https://static.crates.io/crates/example/example-1.2.3.crate']);
  assert.equal(packaged.archives.length, 2);
  const dependency = packaged.archives[1];
  assert.equal(dependency.sha256, checksum);
  assert.equal(dependency.cargoParent.sha256, parent.sha256);
  assert.equal(dependency.archiveIncluded, false);
  await assert.rejects(access(path.join(f.output, dependency.filename)));
  assert.equal(await readFile(path.join(f.output, 'notices', dependency.name, 'example-1.2.3/LICENSE'), 'utf8'), 'original crate licence');
  const evidence = await stageLicenseSources(f.root, f.output, 'darwin-arm64', () => { throw new Error('verified cache should be reused'); }, { evidence: true });
  assert.equal(evidence.archives[1].archiveIncluded, true);
  assert.deepEqual(await readFile(path.join(f.output, dependency.filename)), crate);
  const windows = await stageLicenseSources(f.root, f.output, 'win32-x64', () => { throw new Error('Mac-only lock must not expand on Windows'); });
  assert.deepEqual(windows.archives, []);
});

test('source archives without standalone notices remain collected and explicitly flagged', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'upstream'));
  await writeFile(path.join(f.root, 'upstream/source.c'), '/* inline attribution, no standalone licence file */');
  const archive = execFileSync('tar', ['-czf', '-', '-C', f.root, 'upstream']);
  const item = { ...source, kind: 'cargo-crate', filename: 'example.crate', collectNotices: true, sha256: createHash('sha256').update(archive).digest('hex') };
  await writeFile(path.join(f.root, 'desktop/compliance/sources.lock.json'), JSON.stringify({ schema: 1, archives: [item] }));
  const result = await stageLicenseSources(f.root, f.output, 'darwin-arm64', async () => new Response(archive));
  assert.equal(result.archives[0].noticeReviewRequired, true);
  assert.deepEqual(result.archives[0].notices, []);
  assert.deepEqual(await readdir(path.join(f.output, 'notices/example')), []);
  assert.deepEqual(await readFile(path.join(f.output, item.filename)), archive);
});

test('unused libvips sources are omitted only for a verified optimizer-free renderer', async t => {
  const f = await fixture(t);
  const renderer = path.join(f.root, 'desktop/build/darwin-arm64/runtime/renderer');
  await mkdir(path.join(renderer, '.next-desktop'), { recursive: true });
  await writeFile(path.join(renderer, '.next-desktop/required-server-files.json'), JSON.stringify({ config: { images: { unoptimized: true } } }));
  await pruneUnusedImageOptimizer(renderer);
  await writeFile(path.join(f.root, 'desktop/compliance/sources.lock.json'), JSON.stringify({ schema: 1, archives: [{ ...source, name: 'sharp-native-vips', kind: 'sharp-native-source', library: 'vips' }] }));
  const result = await stageLicenseSources(f.root, f.output, 'darwin-arm64', () => { throw new Error('unused image libraries must not be fetched'); });
  assert.deepEqual(result.archives, []);
  assert.equal(result.omittedSourceGroups[0].group, 'sharp/libvips');
  assert.equal(result.rendererPackaging.imageOptimization, false);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'desktop/compliance'), { recursive: true });
  await mkdir(path.join(root, 'sidecar'), { recursive: true });
  await writeFile(path.join(root, 'desktop/compliance/sources.lock.json'), JSON.stringify(lock()));
  await writeFile(path.join(root, 'sidecar/requirements.lock.txt'), 'example==1.2.3\n');
  return { root, output: path.join(root, 'output') };
}

test('verifies downloads, reuses verified cache, never calls evidence complete source', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const fetchArchive = async () => { calls++; return new Response(contents); };
  const result = await stageLicenseSources(f.root, f.output, 'darwin-arm64', fetchArchive);
  assert.equal(result.completeCorrespondingSource, false);
  await stageLicenseSources(f.root, f.output, 'darwin-arm64', fetchArchive);
  assert.equal(calls, 1);
  assert.equal(await readFile(path.join(f.output, source.filename), 'utf8'), contents);
  await writeFile(path.join(f.root, 'desktop/build/downloads', source.filename), 'corrupted cache');
  await stageLicenseSources(f.root, f.output, 'darwin-arm64', fetchArchive);
  assert.equal(calls, 2);
});

test('bad downloads are not staged and temporary files are cleaned up', async (t) => {
  const f = await fixture(t);
  await assert.rejects(stageLicenseSources(f.root, f.output, 'darwin-arm64', async () => new Response('wrong')), /checksum mismatch/);
  assert.deepEqual(await readdir(path.join(f.root, 'desktop/build/downloads')), []);
  await assert.rejects(access(path.join(f.output, source.filename)));
  await assert.rejects(stageLicenseSources(f.root, f.output, 'darwin-arm64', async () => new Response('error', { status: 503 })), /download failed/);
  await assert.rejects(stageLicenseSources(f.root, f.output, 'invalid'), /Unsupported/);
});

test('platform-specific source archives are not downloaded for another platform', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'desktop/compliance/sources.lock.json'), JSON.stringify({ schema: 1, archives: [{ ...source, targets: ['win32-x64'] }] }));
  const result = await stageLicenseSources(f.root, f.output, 'darwin-arm64', async () => { throw new Error('must not fetch'); });
  assert.deepEqual(result.archives, []);
});

test('upstream HTTP-client rejection can use curl without bypassing the source checksum', async t => {
  const f = await fixture(t);
  const rejected = async () => new Response('client blocked', { status: 406 });
  await assert.rejects(stageLicenseSources(f.root, f.output, 'darwin-arm64', rejected, {
    downloadWithCurl: async (url, file) => { assert.equal(url, source.url); await writeFile(file, 'wrong content'); },
  }), /checksum mismatch/);
  assert.deepEqual(await readdir(path.join(f.root, 'desktop/build/downloads')), []);
  await stageLicenseSources(f.root, f.output, 'darwin-arm64', rejected, {
    downloadWithCurl: async (_url, file) => writeFile(file, contents),
  });
  assert.equal(await readFile(path.join(f.output, source.filename), 'utf8'), contents);
});
