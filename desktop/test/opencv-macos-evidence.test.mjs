import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectOpenCVMac, verifyOriginalBottle } from '../scripts/opencv-macos-evidence.mjs';
import { machoEvidence } from '../scripts/macho-evidence.mjs';

function binary() {
  const bytes = Buffer.alloc(212);
  for (const [offset, value] of [[0, 0xfeedfacf], [4, 0x100000c], [16, 2], [20, 176], [32, 0x1b], [36, 24], [56, 0x19], [60, 152], [120, 1], [176, 208], [192, 0x80000400], [208, 0xd65f03c0]]) bytes.writeUInt32LE(value, offset);
  bytes.fill(42, 40, 56);
  bytes.write('__text', 128);
  bytes.write('__TEXT', 144);
  bytes.writeBigUInt64LE(4n, 168);
  return bytes;
}

test('wheel provenance fails closed on changed, missing, extra or misidentified native libraries', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotate-opencv-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = binary();
  const original = machoEvidence(bytes);
  const library = { file: 'libfixture.dylib', formula: 'fixture', sha256: original.sha256, original };
  const lock = { schema: 1, package: 'opencv-python', version: '4.11.0.86', builds: [{ formula: 'fixture', bottleSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64) }], libraries: [library] };
  await writeFile(path.join(directory, library.file), bytes);
  const result = await inspectOpenCVMac(directory, lock);
  assert.equal(result.matchedLibraries, 1);
  assert.equal(result.completeCorrespondingSource, false);
  library.original = { ...original, uuid: '00'.repeat(16) };
  await assert.rejects(inspectOpenCVMac(directory, lock), /identity differs/);
  delete library.original;
  assert.deepEqual((await inspectOpenCVMac(directory, lock)).unresolvedLibraries, [library.file]);
  await writeFile(path.join(directory, library.file), Buffer.concat([bytes, Buffer.from('changed')]));
  await assert.rejects(inspectOpenCVMac(directory, lock), /library changed/);
  await writeFile(path.join(directory, library.file), bytes);
  await writeFile(path.join(directory, 'extra.dylib'), bytes);
  await assert.rejects(inspectOpenCVMac(directory, lock), /inventory changed/);
  await rm(path.join(directory, 'extra.dylib'));
  await rm(path.join(directory, library.file));
  await assert.rejects(inspectOpenCVMac(directory, lock), /inventory changed/);
  library.file = '../outside.dylib';
  await assert.rejects(inspectOpenCVMac(directory, lock), /paths/);
});

test('archived Homebrew recipes are unmodified and every original library has build provenance', async () => {
  const root = new URL('../compliance/opencv-macos/', import.meta.url);
  const lock = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8'));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const build of lock.builds) assert.equal(sha(await readFile(new URL(`recipes/${build.formula}.rb`, root))), build.recipeSha256);
  assert.equal(lock.libraries.length, new Set(lock.libraries.map(item => item.file)).size);
  for (const library of lock.libraries.filter(item => item.original)) assert.ok(lock.builds.some(build => build.formula === library.formula));
  assert.ok(lock.libraries.some(item => !item.original), 'Unresolved evidence must not be silently cleared.');
});

test('original-bottle verification refuses wrong bytes before inspecting an archive', async t => {
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'annotate-bottle-')), 'bottle.tar.gz');
  t.after(() => rm(path.dirname(file), { recursive: true, force: true }));
  await writeFile(file, 'not an executable or archive');
  await assert.rejects(verifyOriginalBottle(file, { bottleSha256: '0'.repeat(64) }, []), /checksum mismatch/);
});
