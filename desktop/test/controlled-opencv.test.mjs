import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlledOpenCVInputs, validateControlledOpenCV, legacyOpenCVMacSource, inspectControlledOpenCV } from '../scripts/controlled-opencv.mjs';

const module = 'python-3.12/cv2.cpython-312-darwin.so';
const files = { 'config.py': 'loader', [module]: 'before-signing' };
const native = { uuid: 'unique-build', instructions: [{ sha256: 'instruction-hash' }], dependencies: ['/usr/lib/libSystem.B.dylib'] };
const record = () => ({ schema: 1, opencv: '4.11.0', ffmpeg: '7.1', inputs: controlledOpenCVInputs, files, native, module });

test('controlled OpenCV source evidence is tied to actual code, loaders and linkage', () => {
  validateControlledOpenCV(record(), files, native);
  validateControlledOpenCV(record(), { ...files, [module]: 'after-signing' }, native);
  assert.throws(() => validateControlledOpenCV({ ...record(), inputs: [] }, files, native), /inputs/);
  assert.throws(() => validateControlledOpenCV(record(), { ...files, 'config.py': 'different loader' }, native), /package changed/);
  assert.throws(() => validateControlledOpenCV(record(), { ...files, '.dylibs/extra.dylib': 'extra' }, native), /package changed/);
  assert.throws(() => validateControlledOpenCV(record(), files, { ...native, instructions: [] }), /binary/);
  assert.throws(() => validateControlledOpenCV(record(), files, { ...native, dependencies: ['/opt/homebrew/lib/unknown.dylib'] }), /linkage/);
  assert.throws(() => validateControlledOpenCV(record(), files, { ...native, uuid: 'another-build' }), /binary/);
});

test('controlled build retains its FFmpeg source and never changes legacy source classification', async () => {
  assert.equal(legacyOpenCVMacSource({ name: 'opencv-macos-gmp' }), true);
  assert.equal(legacyOpenCVMacSource({ name: 'opencv-macos-ffmpeg-core' }), false);
  assert.equal(legacyOpenCVMacSource({ name: 'opencv-python' }), false);
  assert.equal(await inspectControlledOpenCV('/nonexistent-annotate-runtime'), null);
});
