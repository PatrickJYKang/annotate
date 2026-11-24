import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';
import { machoEvidence } from './macho-evidence.mjs';

const cvRelative = 'python/lib/python3.12/site-packages/cv2';
const recordName = 'ANNOTATE-BUILD.json';
export const controlledOpenCVInputs = [
  { name: 'opencv-python', filename: 'opencv-python-4.11.0.86.tar.gz', sha256: '03d60ccae62304860d232272e4a4fda93c39d595780cb40b161b310244b736a4', url: 'https://files.pythonhosted.org/packages/17/06/68c27a523103dad5837dc5b87e71285280c4f098c60e4fe8a8db6486ab09/opencv-python-4.11.0.86.tar.gz' },
  { name: 'ffmpeg', filename: 'opencv-macos-ffmpeg-core-7.1.tar.xz', sha256: '40973d44970dbc83ef302b0609f2e74982be2d85916dd2ee7472d30678a7abe6', url: 'https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz' },
  { name: 'x264', filename: 'x264-source.tar', sha256: 'e92edc35efe3f8c3effb0c04854de0f8428cc09a218b2062ec3fe44f8ad2aa4e', revision: 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55', url: 'https://code.videolan.org/videolan/x264.git' },
];

async function fingerprints(directory, relative = '') {
  const files = {};
  for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    if (item.name === recordName || item.name === '__pycache__' || item.name.endsWith('.pyc')) continue;
    const name = path.posix.join(relative, item.name);
    if (item.isSymbolicLink()) throw new Error('Controlled OpenCV must not depend on external symlinks.');
    if (item.isDirectory()) Object.assign(files, await fingerprints(directory, name));
    else files[name] = await sha256File(path.join(directory, name));
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

export function validateControlledOpenCV(record, files, native) {
  if (record.schema !== 1 || record.opencv !== '4.11.0' || record.ffmpeg !== '7.1'
    || JSON.stringify(record.inputs) !== JSON.stringify(controlledOpenCVInputs)) throw new Error('Unrecognized controlled OpenCV inputs.');
  // Signing changes file bytes, but not UUID, instructions or linkage. This is
  // packaging evidence, not a startup restriction on users replacing libraries.
  if (!native.uuid || !native.instructions.length || native.uuid !== record.native.uuid
    || JSON.stringify(native.instructions) !== JSON.stringify(record.native.instructions)
    || native.dependencies.some(name => !name.startsWith('/System/') && !name.startsWith('/usr/lib/'))
    || JSON.stringify(native.dependencies) !== JSON.stringify(record.native.dependencies)) throw new Error('Controlled OpenCV binary or linkage changed.');
  const withoutSignature = value => Object.fromEntries(Object.entries(value).filter(([name]) => name !== record.module));
  if (!files[record.module] || JSON.stringify(withoutSignature(files)) !== JSON.stringify(withoutSignature(record.files))) throw new Error('Controlled OpenCV package changed.');
}

export const legacyOpenCVMacSource = source => source.name.startsWith('opencv-macos-') && source.name !== 'opencv-macos-ffmpeg-core';

export async function inspectControlledOpenCV(runtime) {
  const cv = path.join(runtime, cvRelative);
  let record;
  try { record = JSON.parse(await readFile(path.join(cv, recordName), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (record.module !== 'python-3.12/cv2.cpython-312-darwin.so') throw new Error('Invalid controlled OpenCV module path.');
  validateControlledOpenCV(record, await fingerprints(cv), machoEvidence(await readFile(path.join(cv, record.module))));
  return record;
}

export async function bundleControlledOpenCV(root, runtime) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build controlled OpenCV on Apple Silicon.');
  const build = path.join(root, 'desktop/build/controlled-opencv');
  const cache = path.join(root, 'desktop/build/downloads');
  const prefix = path.join(build, 'ffmpeg-prefix');
  const python = path.join(runtime, 'python');
  const env = { ...process.env, MACOSX_DEPLOYMENT_TARGET: '14.0', PKG_CONFIG_PATH: '', PKG_CONFIG_LIBDIR: path.join(prefix, 'lib/pkgconfig'), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  const commands = [];
  async function run(command, args, cwd = build) {
    commands.push({ command, args, cwd });
    console.log(command, ...args);
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); });
  }
  await mkdir(build, { recursive: true }); await mkdir(cache, { recursive: true });
  for (const input of controlledOpenCVInputs) {
    const archive = input.name === 'x264' ? path.join(runtime, 'ffmpeg/licenses', input.filename) : path.join(cache, input.filename);
    let valid = false;
    try { valid = await sha256File(archive) === input.sha256; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!valid && input.name !== 'x264') await run('curl', ['--fail', '--location', '--retry', '3', '--output', archive, input.url]);
    if (await sha256File(archive) !== input.sha256) throw new Error(`Unverified OpenCV build input: ${input.name}`);
    if (input.name === 'x264') {
      await mkdir(path.join(build, 'x264'), { recursive: true });
      await run('tar', ['-xf', archive, '-C', path.join(build, 'x264')]);
    } else await run('tar', ['-xf', archive, '-C', build]);
  }
  const x264 = path.join(build, 'x264'), ffmpeg = path.join(build, 'ffmpeg-7.1');
  await run('./configure', [`--prefix=${prefix}`, '--enable-static', '--disable-cli', '--disable-opencl', '--disable-lsmash', '--disable-swscale', '--disable-ffms', '--extra-cflags=-mmacosx-version-min=14.0', '--extra-ldflags=-mmacosx-version-min=14.0'], x264);
  await run('make', ['-j4'], x264); await run('make', ['install'], x264);
  await run('./configure', [`--prefix=${prefix}`, '--disable-autodetect', '--disable-doc', '--disable-debug', '--disable-programs', '--disable-shared', '--enable-static', '--enable-gpl', '--enable-libx264', '--enable-videotoolbox', '--enable-audiotoolbox', '--enable-zlib', '--enable-bzlib', '--enable-iconv', '--extra-libs=-liconv', '--pkg-config-flags=--static', `--extra-cflags=-mmacosx-version-min=14.0 -I${prefix}/include`, `--extra-ldflags=-mmacosx-version-min=14.0 -L${prefix}/lib`], ffmpeg);
  await run('make', ['-j4'], ffmpeg); await run('make', ['install'], ffmpeg);
  const source = path.join(build, 'opencv-python-4.11.0.86/opencv');
  const systemLinks = '-framework AudioToolbox -framework VideoToolbox -framework CoreFoundation -framework CoreMedia -framework CoreVideo -framework CoreServices -liconv';
  const args = ['-U', '*FFMPEG*', '-S', source, '-B', path.join(build, 'build'),
    ...['EXE', 'MODULE', 'SHARED'].map(kind => `-DCMAKE_${kind}_LINKER_FLAGS=${systemLinks}`),
    '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0', `-DCMAKE_INSTALL_PREFIX=${build}/prefix`, '-DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local', '-DPKG_CONFIG_ARGN=--static', '-DBUILD_SHARED_LIBS=OFF',
    '-DBUILD_TESTS=OFF', '-DBUILD_PERF_TESTS=OFF', '-DBUILD_EXAMPLES=OFF', '-DBUILD_JAVA=OFF', '-DBUILD_opencv_apps=OFF', '-DBUILD_opencv_python2=OFF', '-DBUILD_opencv_python3=ON', '-DBUILD_opencv_gapi=OFF', '-DWITH_ADE=OFF',
    '-DOPENCV_FORCE_3RDPARTY_BUILD=ON', '-DWITH_IPP=OFF', '-DWITH_ITT=OFF', '-DWITH_EIGEN=OFF', '-DWITH_FFMPEG=ON', '-DWITH_GSTREAMER=OFF',
    `-DPYTHON3_EXECUTABLE=${python}/bin/python3.12`, `-DPYTHON3_INCLUDE_DIR=${python}/include/python3.12`, `-DPYTHON3_LIBRARY=${python}/lib/libpython3.12.dylib`, `-DPYTHON3_NUMPY_INCLUDE_DIRS=${python}/lib/python3.12/site-packages/numpy/core/include`, `-DPYTHON3_PACKAGES_PATH=${build}/prefix/site-packages`];
  await run('cmake', args);
  if (!/__VALID_FFMPEG:INTERNAL=TRUE/.test(await readFile(path.join(build, 'build/CMakeCache.txt'), 'utf8'))) throw new Error('OpenCV FFmpeg backend is missing.');
  await run('cmake', ['--build', path.join(build, 'build'), '--parallel', '4']);
  await run('cmake', ['--install', path.join(build, 'build')]);
  const staged = path.join(build, 'prefix/site-packages/cv2');
  // CMake emits absolute development paths; the statically linked package needs
  // only its relative Python extension directory, with no library search path.
  await writeFile(path.join(staged, 'config.py'), 'BINARIES_PATHS = [] + BINARIES_PATHS\n');
  await writeFile(path.join(staged, 'config-3.12.py'), 'import os\nPYTHON_EXTENSIONS_PATHS = [os.path.join(LOADER_DIR, "python-3.12")] + PYTHON_EXTENSIONS_PATHS\n');
  const module = 'python-3.12/cv2.cpython-312-darwin.so';
  const native = machoEvidence(await readFile(path.join(staged, module)));
  if (native.dependencies.some(name => !name.startsWith('/System/') && !name.startsWith('/usr/lib/'))) throw new Error('Non-system dependency in controlled OpenCV.');
  const record = { schema: 1, opencv: '4.11.0', ffmpeg: '7.1', inputs: controlledOpenCVInputs, module, native, files: await fingerprints(staged), commands };
  await writeFile(path.join(staged, recordName), JSON.stringify(record, null, 2) + '\n');
  const destination = path.join(runtime, cvRelative);
  await rm(destination, { recursive: true, force: true });
  await cp(staged, destination, { recursive: true });
  const notices = path.join(runtime, 'licenses/opencv-controlled');
  await mkdir(notices, { recursive: true });
  await cp(fileURLToPath(import.meta.url), path.join(notices, 'build-recipe.mjs'));
  await cp(path.join(staged, recordName), path.join(notices, 'build-record.json'));
  await cp(path.join(source, 'LICENSE'), path.join(notices, 'OpenCV-Apache-2.0.txt'));
  await cp(path.join(ffmpeg, 'COPYING.GPLv2'), path.join(notices, 'FFmpeg-GPLv2.txt'));
  await cp(path.join(x264, 'COPYING'), path.join(notices, 'x264-GPLv2.txt'));
  await cp(path.join(root, 'LICENSE'), path.join(notices, 'Combined-GPLv3.txt'));
  await cp(path.join(build, 'build/CMakeCache.txt'), path.join(notices, 'CMakeCache.txt'));
  const buildInfo = execFileSync(path.join(python, 'bin/python3.12'), ['-c', 'import cv2; print(cv2.getBuildInformation())'], { env, encoding: 'utf8' });
  await writeFile(path.join(notices, 'opencv-build.txt'), buildInfo);
  await writeFile(path.join(notices, 'README.txt'), 'Annotate-controlled OpenCV 4.11.0, statically linked to FFmpeg 7.1 and x264. This combined binary is distributed under GPLv3, preserving upstream Apache-2.0, GPL-2.0-or-later and bundled third-party notices. It is not the unmodified PyPI wheel. Sources: the checksum-pinned OpenCV and FFmpeg archives in the release source companion; x264 source in runtime/ffmpeg/licenses/x264-source.tar. The OpenCV sdist includes its bundled third-party source. See build-record.json for all inputs and commands and licenses/sources/notices/opencv-python for notices. No GAPI/ADE component is included; Annotate does not use it. Build tools are not required by end users.\n');
  return inspectControlledOpenCV(runtime);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  if (!process.argv[2]) throw new Error('Supply an isolated runtime directory.');
  await bundleControlledOpenCV(root, path.resolve(process.argv[2]));
}
