import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeInventory } from '../scripts/native-inventory.mjs';

test('fingerprints native code and records actual FFmpeg licence strings without execution', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotate-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cv2 = 'python/lib/python3.12/site-packages/cv2/.dylibs';
  for (const dir of [cv2, 'ffmpeg', 'renderer/node_modules/@img/native']) await mkdir(path.join(root, dir), { recursive: true });
  const bytes = '\0--prefix=/build --enable-gpl\0libavutil license: GPL version 3 or later\0';
  await writeFile(path.join(root, cv2, 'libavutil.59.dylib'), bytes);
  await writeFile(path.join(root, 'ffmpeg/ffmpeg'), 'binary fixture, must not execute');
  await writeFile(path.join(root, 'renderer/node_modules/@img/native/LICENSE'), 'not a binary');
  const result = await nativeInventory(root, 'darwin-arm64');
  assert.equal(result.files.length, 2);
  assert.equal(result.ffmpegEvidence.length, 2);
  assert.match(result.ffmpegEvidence[1].value, /GPL version 3/);
  assert.deepEqual(await nativeInventory(root, 'darwin-arm64'), result);
  assert.equal(await readFile(path.join(root, cv2, 'libavutil.59.dylib'), 'utf8'), bytes);
  await writeFile(path.join(root, 'ffmpeg/ffmpeg'), 'changed');
  assert.notDeepEqual((await nativeInventory(root, 'darwin-arm64')).files, result.files);
});
