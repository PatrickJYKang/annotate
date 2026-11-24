// Component-level replacement check, not a signed-app compliance certification.
// All source builds and binary substitutions stay in a fresh ignored directory.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sha256File } from '../core/resource-layout.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const video = process.argv[2] && path.resolve(process.argv[2]);
if (process.platform !== 'darwin' || process.arch !== 'arm64' || !video) {
  throw new Error('Usage on Apple silicon: node desktop/scripts/check-lgpl-replacement.mjs /absolute/video.mp4');
}
const runtime = path.join(root, 'desktop/build/darwin-arm64/runtime');
const original = path.join(runtime, 'python/lib/python3.12/site-packages/cv2');
const python = path.join(runtime, 'python/bin/python3');
const libName = 'libsoxr.0.1.2.dylib';
const directory = await mkdtemp(path.join(root, 'desktop/build/lgpl-replacement-'));
const commands = [];
const run = (command, args, options = {}) => {
  commands.push({ command, args });
  const result = execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  return result;
};
async function fingerprints() {
  const files = (await readdir(path.join(original, '.dylibs'))).map(file => `.dylibs/${file}`);
  files.push(...(await readdir(original)).filter(file => file.endsWith('.so')));
  const result = {};
  for (const file of files.sort()) result[file] = await sha256File(path.join(original, file));
  return result;
}
const before = await fingerprints();
const sources = JSON.parse(await readFile(path.join(root, 'desktop/compliance/sources.lock.json'), 'utf8')).archives;
const inputNames = ['opencv-macos-libsoxr', 'opencv-macos-libsoxr-arm64-patch'];
const inputs = [];
for (const name of inputNames) {
  const source = sources.find(item => item.name === name);
  assert.ok(source, `Missing pinned input: ${name}`);
  const file = path.join(root, 'desktop/build/downloads', source.filename);
  assert.equal(await sha256File(file), source.sha256, `Unverified build input: ${name}`);
  inputs.push({ ...source, file });
}

const probe = String.raw`
import ctypes, hashlib, json, os, sys
import cv2
import numpy as np
expected, video, marker = sys.argv[1:]
assert os.path.realpath(os.path.dirname(cv2.__file__)) == os.path.realpath(expected)
# Check which library OpenCV's FFmpeg dependencies actually loaded, before
# explicitly opening libsoxr for the resampling test.
dyld = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
dyld._dyld_image_count.restype = ctypes.c_uint32
dyld._dyld_get_image_name.argtypes = [ctypes.c_uint32]
dyld._dyld_get_image_name.restype = ctypes.c_char_p
loaded = [dyld._dyld_get_image_name(i).decode() for i in range(dyld._dyld_image_count())]
soxr_paths = [p for p in loaded if 'libsoxr.' in p]
assert len(soxr_paths) == 1 and os.path.realpath(soxr_paths[0]).startswith(os.path.realpath(expected) + os.sep), soxr_paths
lib = ctypes.CDLL(soxr_paths[0])
lib.soxr_version.restype = ctypes.c_char_p
version = lib.soxr_version().decode()
assert version == marker, version
cap = cv2.VideoCapture(video)
assert cap.isOpened()
frames = []
for frame_number in [0, 300, 16483]:
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
    ok, frame = cap.read()
    assert ok, frame_number
    frames.append({'frame': frame_number, 'shape': list(frame.shape), 'sha256': hashlib.sha256(frame.tobytes()).hexdigest()})
cap.release()
samples = np.sin(np.arange(44100, dtype=np.float64) * 2 * np.pi * 440 / 44100).astype(np.float32)
output = np.zeros(50000, dtype=np.float32)
used, produced = ctypes.c_size_t(), ctypes.c_size_t()
lib.soxr_oneshot.restype = ctypes.c_char_p
lib.soxr_oneshot.argtypes = [ctypes.c_double, ctypes.c_double, ctypes.c_uint, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
error = lib.soxr_oneshot(44100, 48000, 1, samples.ctypes.data, samples.size, ctypes.byref(used), output.ctypes.data, output.size, ctypes.byref(produced), None, None, None)
assert error is None, error
assert used.value == 44100 and produced.value == 48000
assert np.isfinite(output[:produced.value]).all()
reference = np.sin(np.arange(produced.value) * 2 * np.pi * 440 / 48000)
rms_error = float(np.sqrt(np.mean((output[100:47900] - reference[100:47900]) ** 2)))
assert rms_error < 0.00001, rms_error
print(json.dumps({'version': version, 'loadedLibrary': soxr_paths[0], 'frames': frames, 'inputSamples': used.value, 'outputSamples': produced.value, 'resamplingRmsError': rms_error}))
`;

try {
  console.log(`Isolated replacement check: ${directory}`);
  run('tar', ['-xf', inputs[0].file, '-C', directory]);
  const sourceDir = path.join(directory, 'soxr-0.1.3-Source');
  run('patch', ['-p1', '-i', inputs[1].file], { cwd: sourceDir });
  // The sole test modification makes it observable that the rebuilt library,
  // rather than the original, is loaded. This is an automated test fixture.
  const sourceFile = path.join(sourceDir, 'src/soxr.c');
  const source = await readFile(sourceFile, 'utf8');
  const old = 'return "libsoxr-" SOXR_THIS_VERSION_STR;';
  assert.equal(source.split(old).length, 2);
  await writeFile(sourceFile, source.replace(old, 'return "libsoxr-" SOXR_THIS_VERSION_STR "-annotate-replacement-test";'));
  const build = path.join(directory, 'build');
  const configure = run('cmake', ['-S', sourceDir, '-B', build, '-DCMAKE_POLICY_VERSION_MINIMUM=3.5', '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=ON', '-DWITH_OPENMP=OFF', '-DBUILD_TESTS=ON', '-DBUILD_EXAMPLES=OFF']);
  await writeFile(path.join(directory, 'configure.log'), configure);
  await writeFile(path.join(directory, 'build.log'), run('cmake', ['--build', build, '--parallel', '2']));
  await writeFile(path.join(directory, 'tests.log'), run('ctest', ['--test-dir', build, '--output-on-failure']));
  const copy = path.join(directory, 'site-packages/cv2');
  await mkdir(path.dirname(copy), { recursive: true });
  await cp(original, copy, { recursive: true });
  const replacement = path.join(copy, '.dylibs', libName);
  await cp(path.join(build, 'src', libName), replacement);
  run('install_name_tool', ['-id', `@loader_path/${libName}`, replacement]);
  run('codesign', ['--force', '--sign', '-', replacement]);
  const check = (cv2Path, version) => JSON.parse(run(python, ['-c', probe, cv2Path, video, version], {
    cwd: directory,
    env: { ...process.env, PYTHONPATH: path.dirname(cv2Path), PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
  }));
  const baseline = check(original, 'libsoxr-0.1.3');
  const modified = check(copy, 'libsoxr-0.1.3-annotate-replacement-test');
  assert.deepEqual(modified.frames, baseline.frames);
  const report = { schema: 1, scope: 'Isolated OpenCV component, not the signed Electron app or static libvips relinking', completeDistributionClearance: false, inputs, commands, baseline, modified, replacementSha256: await sha256File(replacement), originalBinaries: before, originalBinariesUnchanged: true };
  assert.deepEqual(await fingerprints(), before);
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: modified library loaded; three real-video frames identical; 44.1 to 48 kHz resampling passed. Report: ${directory}/report.json`);
} finally {
  assert.deepEqual(await fingerprints(), before, 'Original OpenCV runtime must remain unchanged.');
  await writeFile(path.join(directory, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
}
