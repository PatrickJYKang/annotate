import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectWindowsMedia } from '../scripts/windows-media-evidence.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const required = ['LLVM-LICENSE.txt', 'build-recipe.mjs', 'ffmpeg-config.mak', 'windows.cmake', 'windows.ini', 'FFmpeg-GPLv3.txt', 'x264-GPLv2.txt', 'dav1d-BSD.txt', 'zlib-ng-LICENSE.md', 'evidence-recipe.mjs', 'mingw-COPYING', 'mingw-COPYING.MinGW-w64-runtime-COPYING.MinGW-w64-runtime.txt', 'mingw-COPYING.MinGW-w64-COPYING.MinGW-w64.txt', 'mingw-mingw-w64-libraries-winpthreads-COPYING'];
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'annotate-media-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const licenses = path.join(directory, 'licenses');
  await mkdir(licenses);
  await mkdir(path.join(directory, 'bin'));
  const inputs = [{ name: 'ffmpeg', filename: 'source.tar.xz', sha256: digest('source') }];
  const runtimeSource = { name: 'mingw-w64', filename: 'runtime.tar.gz', sha256: digest('runtime') };
  const record = { schema: 1, type: 'annotate-controlled-windows-ffmpeg', version: '8.1.1', inputs, windowsWorkflowVerified: false, binaries: ['ffmpeg.exe', 'ffprobe.exe'].map(name => ({ path: `bin/${name}`, sha256: digest(name) })) };
  const closure = { schema: 1, sources: [runtimeSource], notices: required.map(filename => ({ filename, sha256: digest(filename) })) };
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) await writeFile(path.join(directory, 'bin', name), name);
  await writeFile(path.join(licenses, 'source.tar.xz'), 'source');
  await writeFile(path.join(licenses, 'runtime.tar.gz'), 'runtime');
  for (const name of required) await writeFile(path.join(licenses, name), name);
  const save = async () => {
    await writeFile(path.join(licenses, 'ANNOTATE-BUILD.json'), JSON.stringify(record));
    await writeFile(path.join(licenses, 'ANNOTATE-SOURCE-CLOSURE.json'), JSON.stringify(closure));
  };
  await save();
  return { directory, licenses, record, closure, save, inspect: () => inspectWindowsMedia(directory, { inputs, runtimeSource }) };
}
test('legacy media has no controlled-build clearance; verified inputs do not imply Windows execution', async t => {
  const f = await fixture(t);
  const result = await f.inspect();
  assert.equal(result.sourceInputsVerified, true);
  assert.equal(result.windowsWorkflowVerified, false);
  await rm(path.join(f.licenses, 'ANNOTATE-BUILD.json'));
  assert.equal(await f.inspect(), null);
});
test('changed executable, source archive or notice fails verification', async t => {
  const f = await fixture(t);
  for (const [name, original, error] of [['bin/ffmpeg.exe', 'ffmpeg.exe', /binary/], ['licenses/source.tar.xz', 'source', /source changed/], ['licenses/runtime.tar.gz', 'runtime', /verification failed/], ['licenses/windows.ini', 'windows.ini', /verification failed/]]) {
    await writeFile(path.join(f.directory, name), 'changed');
    await assert.rejects(f.inspect(), error);
    await writeFile(path.join(f.directory, name), original);
  }
});
test('missing or malformed build and closure records fail closed', async t => {
  const f = await fixture(t);
  f.record.binaries = undefined;
  await f.save();
  await assert.rejects(f.inspect(), /Incomplete/);
  f.record.binaries = ['ffmpeg.exe', 'ffprobe.exe'].map(name => ({ path: `bin/${name}`, sha256: digest(name) }));
  f.closure.notices.pop();
  await f.save();
  await assert.rejects(f.inspect(), /missing/);
  await rm(path.join(f.licenses, 'ANNOTATE-SOURCE-CLOSURE.json'));
  await assert.rejects(f.inspect(), /ENOENT/);
  await writeFile(path.join(f.licenses, 'ANNOTATE-BUILD.json'), '{');
  await assert.rejects(f.inspect(), SyntaxError);
});
test('unreviewed inputs, duplicate binaries and escaping paths are rejected', async t => {
  const f = await fixture(t);
  f.record.inputs = [{ name: 'unreviewed' }];
  await f.save();
  await assert.rejects(f.inspect(), /inputs differ/);
  f.record.inputs = [{ name: 'ffmpeg', filename: 'source.tar.xz', sha256: digest('source') }];
  f.record.binaries[1] = f.record.binaries[0];
  await f.save();
  await assert.rejects(f.inspect(), /Incomplete/);
  f.record.binaries[1] = { path: '../ffprobe.exe', sha256: digest('ffprobe.exe') };
  await f.save();
  await assert.rejects(f.inspect(), /binary/);
  f.record.binaries[1].path = 'bin/ffprobe.exe';
  f.closure.notices.push({ filename: '../outside', sha256: digest('outside') });
  await f.save();
  await assert.rejects(f.inspect(), /verification failed/);
});
