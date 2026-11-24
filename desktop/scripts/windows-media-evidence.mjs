import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';
import { windowsFFmpegInputs } from './controlled-windows-ffmpeg.mjs';

const mingw = { name: 'mingw-w64', filename: 'mingw-w64-c28e9555bb8800c53449f42a465ad9a5676fce88.tar.gz', sha256: 'f07cfc452676fe1061c4b6c062335903dbe0d5d18cda6ab8ee6d94637d32a87a', url: 'https://codeload.github.com/mingw-w64/mingw-w64/tar.gz/c28e9555bb8800c53449f42a465ad9a5676fce88' };

export async function completeWindowsMediaEvidence(root, directory) {
  const licenses = path.join(directory, 'licenses');
  const build = JSON.parse(await readFile(path.join(licenses, 'ANNOTATE-BUILD.json'), 'utf8'));
  if (build.type !== 'annotate-controlled-windows-ffmpeg') throw new Error('Not a controlled Windows media build.');
  const archive = path.join(root, 'desktop/build/downloads', mingw.filename);
  let valid = false;
  try { valid = await sha256File(archive) === mingw.sha256; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!valid) execFileSync('curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--retry', '3', '-o', archive, mingw.url], { stdio: 'inherit' });
  if (await sha256File(archive) !== mingw.sha256) throw new Error('MinGW source checksum mismatch.');
  await cp(archive, path.join(licenses, mingw.filename));
  const prefix = 'mingw-w64-c28e9555bb8800c53449f42a465ad9a5676fce88/';
  const notices = [];
  for (const member of ['COPYING', 'COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt', 'COPYING.MinGW-w64/COPYING.MinGW-w64.txt', 'mingw-w64-libraries/winpthreads/COPYING']) {
    const name = `mingw-${member.replaceAll('/', '-')}`;
    await writeFile(path.join(licenses, name), execFileSync('tar', ['-xOf', archive, prefix + member]));
    notices.push({ filename: name, sha256: await sha256File(path.join(licenses, name)) });
  }
  const compiler = windowsFFmpegInputs.find(input => input.name === 'llvm-mingw');
  const toolchain = path.join(root, 'desktop/build/controlled-windows-ffmpeg', compiler.directory);
  await cp(path.join(toolchain, 'LICENSE.TXT'), path.join(licenses, 'LLVM-LICENSE.txt'));
  notices.push({ filename: 'LLVM-LICENSE.txt', sha256: await sha256File(path.join(licenses, 'LLVM-LICENSE.txt')) });
  for (const name of ['build-recipe.mjs', 'ffmpeg-config.mak', 'windows.cmake', 'windows.ini', 'FFmpeg-GPLv3.txt', 'x264-GPLv2.txt', 'dav1d-BSD.txt', 'zlib-ng-LICENSE.md']) notices.push({ filename: name, sha256: await sha256File(path.join(licenses, name)) });
  await cp(fileURLToPath(import.meta.url), path.join(licenses, 'evidence-recipe.mjs'));
  notices.push({ filename: 'evidence-recipe.mjs', sha256: await sha256File(path.join(licenses, 'evidence-recipe.mjs')) });
  await writeFile(path.join(licenses, 'ANNOTATE-SOURCE-CLOSURE.json'), JSON.stringify({ schema: 1, sources: [mingw], notices, note: 'Complete retained inputs for the controlled media tools, not a claim of native Windows workflow testing or release-wide legal clearance.' }, null, 2) + '\n');
  return inspectWindowsMedia(directory);
}

export async function inspectWindowsMedia(directory, { inputs = windowsFFmpegInputs, runtimeSource = mingw } = {}) {
  let record;
  const licenses = path.join(directory, 'licenses');
  try { record = JSON.parse(await readFile(path.join(licenses, 'ANNOTATE-BUILD.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (record.schema !== 1 || record.type !== 'annotate-controlled-windows-ffmpeg' || record.version !== '8.1.1') throw new Error('Unknown controlled Windows media build.');
  if (JSON.stringify(record.inputs) !== JSON.stringify(inputs)) throw new Error('Windows media source inputs differ from the reviewed recipe.');
  for (const input of record.inputs.filter(input => !input.buildTool)) {
    if (await sha256File(path.join(licenses, input.filename)) !== input.sha256) throw new Error(`Windows media source changed: ${input.name}`);
  }
  if (!Array.isArray(record.binaries) || record.binaries.length !== 2 || new Set(record.binaries.map(file => file.path)).size !== 2) throw new Error('Incomplete Windows media binaries.');
  for (const binary of record.binaries) {
    if (!['bin/ffmpeg.exe', 'bin/ffprobe.exe'].includes(binary.path) || await sha256File(path.join(directory, binary.path)) !== binary.sha256) throw new Error('Windows media binary does not match its build record.');
  }
  const closure = JSON.parse(await readFile(path.join(licenses, 'ANNOTATE-SOURCE-CLOSURE.json'), 'utf8'));
  if (closure.schema !== 1 || JSON.stringify(closure.sources) !== JSON.stringify([runtimeSource])) throw new Error('Windows runtime source closure is incomplete.');
  const required = ['LLVM-LICENSE.txt', 'build-recipe.mjs', 'ffmpeg-config.mak', 'windows.cmake', 'windows.ini', 'FFmpeg-GPLv3.txt', 'x264-GPLv2.txt', 'dav1d-BSD.txt', 'zlib-ng-LICENSE.md', 'evidence-recipe.mjs', 'mingw-COPYING', 'mingw-COPYING.MinGW-w64-runtime-COPYING.MinGW-w64-runtime.txt', 'mingw-COPYING.MinGW-w64-COPYING.MinGW-w64.txt', 'mingw-mingw-w64-libraries-winpthreads-COPYING'];
  if (!Array.isArray(closure.notices) || required.some(name => !closure.notices.some(file => file.filename === name))) throw new Error('Windows media build recipe or notices are missing.');
  if (new Set(closure.notices.map(file => file.filename)).size !== closure.notices.length) throw new Error('Duplicate Windows media notice.');
  for (const item of [...closure.sources, ...closure.notices]) {
    if (!/^[\w.-]+$/.test(item.filename) || await sha256File(path.join(licenses, item.filename)) !== item.sha256) throw new Error('Windows media source/notice verification failed.');
  }
  return { ...record, sourceClosure: closure, sourceInputsVerified: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply the isolated Windows media candidate directory.');
  const result = await completeWindowsMediaEvidence(fileURLToPath(new URL('../../', import.meta.url)), path.resolve(process.argv[2]));
  console.log(JSON.stringify({ sourceInputsVerified: result.sourceInputsVerified, binaries: result.binaries }, null, 2));
}
