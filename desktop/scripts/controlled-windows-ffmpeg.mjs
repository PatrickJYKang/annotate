import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';

export const windowsFFmpegInputs = [
  { name: 'ffmpeg', version: '8.1.1', filename: 'ffmpeg-8.1.1.tar.xz', sha256: 'b6863adde98898f42602017462871b5f6333e65aec803fdd7a6308639c52edf3', url: 'https://ffmpeg.org/releases/ffmpeg-8.1.1.tar.xz', directory: 'ffmpeg-8.1.1' },
  { name: 'x264', version: 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55', filename: 'x264-source.tar', sha256: 'e92edc35efe3f8c3effb0c04854de0f8428cc09a218b2062ec3fe44f8ad2aa4e', directory: 'x264', local: 'desktop/build/darwin-arm64/runtime/ffmpeg/licenses/x264-source.tar' },
  { name: 'zlib-ng', version: '2.3.3', filename: 'sharp-zlib-ng-2.3.3.tar.gz', sha256: 'f9c65aa9c852eb8255b636fd9f07ce1c406f061ec19a2e7d508b318ca0c907d1', url: 'https://github.com/zlib-ng/zlib-ng/archive/2.3.3.tar.gz', directory: 'zlib-ng-2.3.3' },
  { name: 'dav1d', version: '1.5.0', filename: 'opencv-macos-dav1d-1.5.0.tar.bz2', sha256: 'a6ca64e34cec56ae1c2d359e1da5c5386ecd7a3a62f931d026ac4f2ff72ade64', url: 'https://code.videolan.org/videolan/dav1d/-/archive/1.5.0/dav1d-1.5.0.tar.bz2', directory: 'dav1d-1.5.0' },
  { name: 'nasm', version: '2.16.03', filename: 'nasm-2.16.03.tar.xz', sha256: '1412a1c760bbd05db026b6c0d1657affd6631cd0a63cddb6f73cc6d4aa616148', url: 'https://www.nasm.us/pub/nasm/releasebuilds/2.16.03/nasm-2.16.03.tar.xz', directory: 'nasm-2.16.03', buildTool: true },
  { name: 'llvm-mingw', version: '20260616', filename: 'llvm-mingw-20260616-ucrt-macos-universal.tar.xz', sha256: '2cab02a2e964bd4aae981150a45985d07c657cfa8d244959eb9e2dcc5eedd7b1', url: 'https://github.com/mstorsjo/llvm-mingw/releases/download/20260616/llvm-mingw-20260616-ucrt-macos-universal.tar.xz', directory: 'llvm-mingw-20260616-ucrt-macos-universal', buildTool: true },
];

export function windowsFFmpegConfigure(prefix, cross) {
  return [`--prefix=${prefix}`, '--target-os=mingw32', '--arch=x86_64', '--enable-cross-compile', `--cross-prefix=${cross}`, '--cc=x86_64-w64-mingw32-clang', '--cxx=x86_64-w64-mingw32-clang++', '--ar=llvm-ar', '--ranlib=llvm-ranlib', '--nm=llvm-nm',
    '--disable-autodetect', '--disable-doc', '--disable-debug', '--disable-ffplay', '--disable-filter=gfxcapture', '--disable-shared', '--enable-static', '--enable-gpl', '--enable-version3', '--enable-libx264', '--enable-libdav1d', '--enable-zlib', '--enable-mediafoundation', '--enable-d3d11va', '--enable-dxva2', '--enable-schannel', '--enable-w32threads', '--pkg-config=pkg-config', '--pkg-config-flags=--static', `--extra-cflags=-I${prefix}/include`, `--extra-ldflags=-L${prefix}/lib -static`];
}

// A separate candidate only. Promotion requires the Windows media workflow check.
export async function buildWindowsFFmpeg(root, output) {
  if (process.platform !== 'darwin') throw new Error('This cross-build recipe currently requires macOS and Apple command-line tools.');
  try { if ((await readdir(output)).length) throw new Error('Refusing to overwrite an existing media directory. Choose a new candidate output.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const recipe = await readFile(fileURLToPath(import.meta.url));
  const build = path.join(root, 'desktop/build/controlled-windows-ffmpeg');
  const cache = path.join(root, 'desktop/build/downloads');
  const prefix = path.join(build, 'prefix');
  const host = path.join(build, 'host');
  await mkdir(build, { recursive: true });
  await mkdir(cache, { recursive: true });
  const commands = [];
  const env = { ...process.env };
  async function run(command, args, cwd = build, extraEnv = {}) {
    commands.push({ command, args, cwd: path.relative(build, cwd) || '.', env: extraEnv });
    console.log(command, ...args);
    const child = spawn(command, args, { cwd, env: { ...env, ...extraEnv }, stdio: 'inherit' });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); });
  }
  for (const input of windowsFFmpegInputs) {
    const archive = path.join(cache, input.filename);
    let valid = false;
    try { valid = await sha256File(archive) === input.sha256; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!valid) {
      if (input.local) {
        try { await cp(path.join(root, input.local), archive); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const checkout = path.join(build, 'x264-source-checkout');
          await mkdir(checkout, { recursive: true });
          await run('git', ['init', checkout]);
          await run('git', ['fetch', '--depth=1', 'https://code.videolan.org/videolan/x264.git', input.version], checkout);
          await run('git', ['archive', '--format=tar', `--output=${archive}`, input.version], checkout);
        }
      }
      else await run('curl', ['--fail', '--location', '--retry', '3', '--proto', '=https', '-o', archive, input.url]);
    }
    if (await sha256File(archive) !== input.sha256) throw new Error(`Source checksum mismatch: ${input.name}`);
    const destination = path.join(build, input.directory);
    try { await access(destination); } catch {
      if (input.name === 'x264') { await mkdir(destination); await run('tar', ['-xf', archive, '-C', destination]); }
      else await run('tar', ['-xf', archive]);
    }
  }
  const toolchain = path.join(build, windowsFFmpegInputs.find(x => x.name === 'llvm-mingw').directory, 'bin');
  const cross = path.join(toolchain, 'x86_64-w64-mingw32-');
  env.PATH = `${host}/bin:${build}/tools/bin:${toolchain}:${process.env.PATH}`;
  env.PKG_CONFIG_PATH = '';
  env.PKG_CONFIG_LIBDIR = `${prefix}/lib/pkgconfig`;
  const nasm = path.join(build, 'nasm-2.16.03');
  try { await access(path.join(host, 'bin/nasm')); } catch {
    await run('./configure', [`--prefix=${host}`], nasm);
    await run('make', ['-j4'], nasm);
    await run('make', ['install'], nasm);
  }
  try { await access(path.join(build, 'tools/bin/meson')); } catch {
    await run('python3.12', ['-m', 'venv', path.join(build, 'tools')]);
    await run(path.join(build, 'tools/bin/python'), ['-m', 'pip', 'install', '--only-binary=:all:', 'meson==1.9.1', 'ninja==1.13.0']);
  }
  const compiler = `${cross}clang`;
  const cmake = path.join(build, 'windows.cmake');
  await writeFile(cmake, `set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_SYSTEM_PROCESSOR AMD64)\nset(CMAKE_C_COMPILER "${compiler}")\nset(CMAKE_CXX_COMPILER "${cross}clang++")\nset(CMAKE_RC_COMPILER "${cross}windres")\nset(CMAKE_AR "${toolchain}/llvm-ar")\nset(CMAKE_RANLIB "${toolchain}/llvm-ranlib")\n`);
  await run('cmake', ['-S', path.join(build, 'zlib-ng-2.3.3'), '-B', path.join(build, 'zlib-build'), `-DCMAKE_TOOLCHAIN_FILE=${cmake}`, `-DCMAKE_INSTALL_PREFIX=${prefix}`, '-DCMAKE_BUILD_TYPE=Release', '-DZLIB_COMPAT=ON', '-DZLIB_ENABLE_TESTS=OFF', '-DWITH_GTEST=OFF', '-DBUILD_SHARED_LIBS=OFF']);
  await run('cmake', ['--build', path.join(build, 'zlib-build'), '--parallel', '4']);
  await run('cmake', ['--install', path.join(build, 'zlib-build')]);
  const x264 = path.join(build, 'x264');
  await run('./configure', [`--prefix=${prefix}`, '--host=x86_64-w64-mingw32', `--cross-prefix=${cross}`, '--enable-static', '--disable-cli', '--disable-opencl', '--disable-lsmash', '--disable-swscale', '--disable-ffms'], x264, { CC: compiler, AR: `${toolchain}/llvm-ar`, RANLIB: `${toolchain}/llvm-ranlib` });
  await run('make', ['-j4'], x264);
  await run('make', ['install'], x264);
  const meson = path.join(build, 'windows.ini');
  await writeFile(meson, `[binaries]\nc = '${compiler}'\nar = '${toolchain}/llvm-ar'\nstrip = '${toolchain}/llvm-strip'\nwindres = '${cross}windres'\n[host_machine]\nsystem = 'windows'\ncpu_family = 'x86_64'\ncpu = 'x86_64'\nendian = 'little'\n[properties]\nneeds_exe_wrapper = true\n`);
  await run('meson', ['setup', '--reconfigure', path.join(build, 'dav1d-build'), path.join(build, 'dav1d-1.5.0'), '--cross-file', meson, '--buildtype=release', '--default-library=static', `--prefix=${prefix}`, '--libdir=lib', '-Denable_tools=false', '-Denable_tests=false']);
  await run('meson', ['compile', '-C', path.join(build, 'dav1d-build'), '-j', '4']);
  await run('meson', ['install', '-C', path.join(build, 'dav1d-build')]);
  const ffmpeg = path.join(build, 'ffmpeg-8.1.1');
  await run('./configure', windowsFFmpegConfigure(prefix, cross), ffmpeg);
  await run('make', ['-j4'], ffmpeg);
  await run('make', ['install'], ffmpeg);
  await mkdir(path.join(output, 'bin'), { recursive: true });
  const binaries = [];
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
    const file = path.join(prefix, 'bin', name);
    const imports = execFileSync(path.join(toolchain, 'llvm-readobj'), ['--coff-imports', file], { encoding: 'utf8' });
    const dlls = [...imports.matchAll(/^\s+Name: (.+)$/gm)].map(match => match[1]);
    if (!dlls.length || dlls.some(name => !/^(api-ms-win-[\w-]+|kernel32|user32|advapi32|bcrypt|ncrypt|crypt32|ole32|oleaut32|gdi32|shell32|shlwapi|ws2_32|secur32|mfplat|mfuuid|strmiids|avicap32|vfw32|winmm|psapi|d3d11|dxgi|msvcrt|ucrtbase|comdlg32)\.dll$/i.test(name))) throw new Error(`Unexpected external Windows library: ${dlls.join(', ')}`);
    await cp(file, path.join(output, 'bin', name));
    binaries.push({ path: `bin/${name}`, sha256: await sha256File(file), imports: dlls });
  }
  const licenses = path.join(output, 'licenses');
  await mkdir(licenses, { recursive: true });
  for (const input of windowsFFmpegInputs.filter(x => !x.buildTool)) await cp(path.join(cache, input.filename), path.join(licenses, input.filename));
  for (const [from, to] of [['ffmpeg-8.1.1/COPYING.GPLv3', 'FFmpeg-GPLv3.txt'], ['x264/COPYING', 'x264-GPLv2.txt'], ['dav1d-1.5.0/COPYING', 'dav1d-BSD.txt'], ['zlib-ng-2.3.3/LICENSE.md', 'zlib-ng-LICENSE.md']]) await cp(path.join(build, from), path.join(licenses, to));
  await writeFile(path.join(licenses, 'build-recipe.mjs'), recipe);
  await cp(cmake, path.join(licenses, 'windows.cmake'));
  await cp(meson, path.join(licenses, 'windows.ini'));
  await cp(path.join(ffmpeg, 'ffbuild/config.mak'), path.join(licenses, 'ffmpeg-config.mak'));
  const record = { schema: 1, type: 'annotate-controlled-windows-ffmpeg', version: '8.1.1', createdAt: new Date().toISOString(), windowsWorkflowVerified: false, inputs: windowsFFmpegInputs, binaries, commands, environment: { PATH: env.PATH, PKG_CONFIG_PATH: env.PKG_CONFIG_PATH, PKG_CONFIG_LIBDIR: env.PKG_CONFIG_LIBDIR }, buildTools: { meson: '1.9.1', ninja: '1.13.0', cmake: execFileSync('cmake', ['--version'], { encoding: 'utf8' }).split('\n')[0] } };
  await writeFile(path.join(licenses, 'ANNOTATE-BUILD.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply a separate output directory, not the installed app.');
  await buildWindowsFFmpeg(fileURLToPath(new URL('../../', import.meta.url)), path.resolve(process.argv[2]));
}
