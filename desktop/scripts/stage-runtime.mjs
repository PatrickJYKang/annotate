import { spawn } from 'node:child_process';
import { access, chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';
import { bundleMacTools } from './bundle-macos-tools.mjs';
import { bundleWindowsRuntime } from './bundle-windows-runtime.mjs';
import { desktopPreviewVersion } from '../preview-version.mjs';
import { collectNotices } from './collect-notices.mjs';
import { stageLicenseSources } from './prepare-license-sources.mjs';
import { finalizePnLBundle, pnlcalibCommit } from './bundle-pnlcalib.mjs';
import { inspectRendererPackaging } from './renderer-packaging.mjs';
import { bundleControlledOpenCV } from './controlled-opencv.mjs';
import { inspectWindowsMedia } from './windows-media-evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = process.argv[2];
const sources = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', sha256: '81a359f1cfadd4da11766534c5913791cea55f26e1bb902cacd2a531bb1e4b2b' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', sha256: '7c45c9622400d578709a9b2cddbe8124cc21d382409d9f13406d706d28e31b14' },
};
if (!sources[target]) throw new Error('Choose darwin-arm64 or win32-x64.');
const windows = target === 'win32-x64';
const mediaOverride = process.argv.find(arg => arg.startsWith('--windows-media='))?.slice('--windows-media='.length);
if (mediaOverride && (!windows || !await inspectWindowsMedia(path.resolve(mediaOverride)))) throw new Error('Supply a source-verified Windows media candidate only for win32-x64.');
const output = path.join(root, 'desktop/build', target, 'runtime');
if (mediaOverride && (path.resolve(mediaOverride) === output || path.resolve(mediaOverride).startsWith(output + path.sep))) throw new Error('Keep the media candidate outside the runtime being restaged.');
const cache = path.join(root, 'desktop/build/downloads');
await mkdir(output, { recursive: true }); await mkdir(cache, { recursive: true });
async function run(command, args, options = {}) {
  console.log(command, ...args);
  const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); });
}
async function download(url, sha256, filename) {
  const file = path.join(cache, filename);
  try { if (await sha256File(file) === sha256) return file; } catch { /* Download missing file. */ }
  await run('curl', ['--fail', '--location', '--retry', '3', '--output', file, url]);
  if (await sha256File(file) !== sha256) throw new Error(`Download checksum mismatch: ${filename}`);
  return file;
}
const python = `cpython-3.12.14+20260901-${sources[target].triple}-install_only_stripped.tar.gz`;
const archive = await download(`https://github.com/astral-sh/python-build-standalone/releases/download/20260901/${encodeURIComponent(python)}`, sources[target].sha256, python);
try { await access(path.join(output, windows ? 'python/python.exe' : 'python/bin/python3.12')); }
catch { await run('tar', ['-xzf', archive, '-C', output]); }
const sitePackages = path.join(output, windows ? 'python/Lib/site-packages' : 'python/lib/python3.12/site-packages');
await run('uv', ['pip', 'install', '--python-version', '3.12.14',
  ...(windows ? ['--python-platform', sources[target].triple] : ['--python', path.join(output, 'python/bin/python3.12')]),
  '--target', sitePackages, '--only-binary', ':all:', '--link-mode', 'copy', '--strict',
  '-r', path.join(root, 'sidecar/requirements.lock.txt')]);

console.log('Staging renderer and sidecar source');
await rm(path.join(output, 'renderer'), { recursive: true, force: true });
await cp(path.join(root, 'webapp/.next-desktop/standalone'), path.join(output, 'renderer'), { recursive: true, dereference: true,
  filter: (source) => !source.split(path.sep).includes('cache') });
if (!await inspectRendererPackaging(path.join(output, 'renderer'))) throw new Error('Rebuild the renderer with the current packaging policy before staging.');
await rm(path.join(output, 'sidecar'), { recursive: true, force: true });
await cp(path.join(root, 'sidecar/annotate_sidecar'), path.join(output, 'sidecar/annotate_sidecar'), { recursive: true,
  filter: (source) => !source.includes('__pycache__') && !source.endsWith('.pyc') });
await cp(path.join(root, 'sidecar/requirements.lock.txt'), path.join(output, 'sidecar/requirements.lock.txt'));

console.log('Staging locked PnLCalib source and model weights');
const pnl = path.join(output, 'pnlcalib');
await mkdir(pnl, { recursive: true });
const localPnl = process.env.ANNOTATE_PNLCALIB_ROOT ?? path.join(root, 'sidecar/third_party/pnlcalib');
const sourceArchive = path.join(cache, `pnlcalib-${pnlcalibCommit}-${target}.tar`);
await run('git', ['-C', localPnl, 'archive', '--format=tar', '--output', sourceArchive, pnlcalibCommit]);
await run('tar', ['-xf', sourceArchive, '-C', pnl]);
await finalizePnLBundle(pnl);
for (const [name, sha] of [['SV_kp', '7ea78fa76aaf94976a8eca428d6e3c59697a93430cba1a4603e20284b61f5113'], ['SV_lines', 'd72f4ed71734a2e3df9fa084f666e9b8adaef21bf69bac8952d6d3f970ff7455']]) {
  const weight = path.join(localPnl, 'weights', name);
  if (await sha256File(weight) !== sha) throw new Error(`Invalid PnLCalib weight: ${name}`);
  await mkdir(path.join(pnl, 'weights'), { recursive: true });
  await cp(weight, path.join(pnl, 'weights', name));
}
await mkdir(path.join(output, 'models'), { recursive: true });
const yolo = path.join(root, 'sidecar/yolov8n.pt');
if (await sha256File(yolo) !== 'f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36') throw new Error('YOLO weights do not match the tested model.');
await cp(yolo, path.join(output, 'models/yolov8n.pt'));

if (windows) {
  await bundleWindowsRuntime(output, cache, download);
  if (mediaOverride) {
    await rm(path.join(output, 'ffmpeg'), { recursive: true, force: true });
    await cp(path.resolve(mediaOverride), path.join(output, 'ffmpeg'), { recursive: true });
  } else {
    const zip = await download('https://github.com/GyanD/codexffmpeg/releases/download/8.1.1/ffmpeg-8.1.1-essentials_build.zip',
      '6f58ce889f59c311410f7d2b18895b33c03456463486f3b1ebc93d97a0f54541', 'ffmpeg-8.1.1-win64.zip');
    const unpack = path.join(cache, 'ffmpeg-win');
    await mkdir(unpack, { recursive: true });
    await run('tar', ['-xf', zip, '-C', unpack]);
    await rm(path.join(output, 'ffmpeg'), { recursive: true, force: true });
    await cp(path.join(unpack, 'ffmpeg-8.1.1-essentials_build'), path.join(output, 'ffmpeg'), { recursive: true });
    await rm(path.join(output, 'ffmpeg/bin/ffplay.exe'), { force: true });
  }
  // The unused image optimizer is omitted on both targets. SWC is compile-only.
  const rendererModules = path.join(output, 'renderer/node_modules');
  await rm(path.join(rendererModules, '@next/swc-darwin-arm64'), { recursive: true, force: true });
} else {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The macOS tools must be assembled on Apple Silicon.');
  await rm(path.join(output, 'ffmpeg'), { recursive: true, force: true });
  await bundleMacTools(path.join(output, 'ffmpeg'));
  await bundleControlledOpenCV(root, output);
}

// Omit build-time bytecode and Python command wrappers with absolute staging
// paths. The application invokes the interpreter and modules directly.
async function clean(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) await rm(file, { recursive: true, force: true });
    else if (entry.isDirectory()) await clean(file);
  }
}
await clean(path.join(output, 'python'));
const entries = {
  renderer: ['file', 'renderer/server.js'], python: ['file', windows ? 'python/python.exe' : 'python/bin/python3.12'],
  sidecar: ['directory', 'sidecar'], ffmpeg: ['file', `ffmpeg/bin/ffmpeg${windows ? '.exe' : ''}`],
  ffprobe: ['file', `ffmpeg/bin/ffprobe${windows ? '.exe' : ''}`], yolo: ['file', 'models/yolov8n.pt'],
  pnlcalib: ['directory', 'pnlcalib'], keypoints: ['file', 'pnlcalib/weights/SV_kp'], lines: ['file', 'pnlcalib/weights/SV_lines'],
};
const resources = {};
for (const [key, [kind, relative]] of Object.entries(entries)) resources[key] = {
  kind, path: relative, ...(kind === 'file' ? { sha256: await sha256File(path.join(output, relative)) } : {}),
};
await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
await stageLicenseSources(root, path.join(output, 'licenses/sources'), target);
await collectNotices(root, output, sitePackages, path.join(output, 'licenses'), path.join(output, 'licenses/sources'));
await writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), [
  `Annotate ${desktopPreviewVersion}. Annotate-owned source: GPL-3.0-only. Third-party components retain their own terms. https://github.com/PatrickJYKang/annotate`,
  'Python 3.12.14 standalone build 20260901: https://github.com/astral-sh/python-build-standalone/releases/tag/20260901',
  'Python package versions and licenses: sidecar/requirements.lock.txt and python/**/site-packages/*.dist-info/{METADATA,licenses,LICENSE*}.',
  `PnLCalib: https://github.com/mguti97/PnLCalib commit ${pnlcalibCommit}. Author code GPL-2.0-or-later; HRNet MIT; unmodified v1.0.0 SV_kp/SV_lines weights CC BY 4.0. Full licences and author citation: licenses/pnlcalib/. SoccerNet evaluation code and example footage omitted.`,
  'YOLOv8n weights and Ultralytics: https://github.com/ultralytics/ultralytics (AGPL-3.0).',
  'FFmpeg and codec dependencies: see ffmpeg/licenses for controlled builds; ffmpeg/LICENSE and ffmpeg/README.txt for legacy Windows staging.',
  mediaOverride ? 'Windows FFmpeg: Annotate-controlled FFmpeg 8.1.1/x264/dav1d/zlib-ng. Source archives, build recipe and runtime notices: ffmpeg/licenses/.' : 'Legacy Windows FFmpeg 8.1.1 source/build recipe: https://github.com/GyanD/codexffmpeg/releases/tag/8.1.1. Linked-library source closure remains unresolved for that binary.',
  'macOS FFmpeg/x264 complete source archives, GPL licenses and build recipe: ffmpeg/licenses/. Only Apple system libraries are linked dynamically.',
  'macOS OpenCV: Annotate-controlled OpenCV 4.11.0 + FFmpeg 7.1/x264, combined GPLv3. Build inputs and notices: licenses/opencv-controlled/ and licenses/sources/. This replaces the PyPI wheel native module; see the companion source archive.',
  'Electron licenses are included alongside the application. Web renderer dependency notices and a dependency inventory are collected in licenses/.',
  'Distribution review: see licenses/licence-review.md. Microsoft and PnLCalib permission reviews are recorded; matching release source and final target testing are still required. Do not treat a test build as publication clearance.',
  'This unsigned preview is for evaluation; no Windows runtime validation or publisher signature is claimed.',
].join('\n\n') + '\n');
await writeFile(path.join(output, 'runtime-manifest.json'), JSON.stringify({ version: 1, platform: windows ? 'win32' : 'darwin', arch: windows ? 'x64' : 'arm64', resources }, null, 2) + '\n');
console.log(`Self-contained runtime staged: ${output}`);
