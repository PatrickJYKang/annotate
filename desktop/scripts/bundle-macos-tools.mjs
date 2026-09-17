import { spawn, execFileSync } from 'node:child_process';
import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';

// Build against the oldest supported SDK target, without linking Homebrew
// libraries. Copying the local bottle would silently require the build Mac's OS.
export async function bundleMacTools(destination) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const build = path.join(root, 'desktop/build/mac-native');
  const prefix = path.join(build, 'prefix');
  const env = { ...process.env, MACOSX_DEPLOYMENT_TARGET: '14.0', PKG_CONFIG_PATH: '', PKG_CONFIG_LIBDIR: path.join(prefix, 'lib/pkgconfig') };
  async function run(command, args, cwd = build) {
    console.log(command, ...args);
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); });
  }
  await mkdir(build, { recursive: true });
  const x264 = path.join(build, 'x264');
  const revision = 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55';
  try { await access(path.join(prefix, 'lib/libx264.a')); } catch {
    await mkdir(x264, { recursive: true });
    await run('git', ['init', x264]);
    await run('git', ['fetch', '--depth=1', 'https://code.videolan.org/videolan/x264.git', revision], x264);
    await run('git', ['checkout', '--detach', revision], x264);
    await run('./configure', [`--prefix=${prefix}`, '--enable-static', '--disable-cli', '--disable-opencl', '--disable-lsmash', '--disable-swscale', '--disable-ffms', '--extra-cflags=-mmacosx-version-min=14.0', '--extra-ldflags=-mmacosx-version-min=14.0'], x264);
    await run('make', ['-j4'], x264);
    await run('make', ['install'], x264);
  }
  const archive = path.join(build, 'ffmpeg-8.1.1.tar.xz');
  const digest = 'b6863adde98898f42602017462871b5f6333e65aec803fdd7a6308639c52edf3';
  let verified = false;
  try { verified = await sha256File(archive) === digest; } catch { /* Download below. */ }
  if (!verified) await run('curl', ['--fail', '--location', '--retry', '3', '-o', archive, 'https://ffmpeg.org/releases/ffmpeg-8.1.1.tar.xz']);
  if (await sha256File(archive) !== digest) throw new Error('FFmpeg source checksum mismatch.');
  const ffmpeg = path.join(build, 'ffmpeg-8.1.1');
  try { await access(path.join(prefix, 'bin/ffmpeg')); } catch {
    await run('tar', ['-xf', archive]);
    await run('./configure', [`--prefix=${prefix}`, '--disable-autodetect', '--disable-doc', '--disable-debug', '--disable-ffplay',
      '--disable-shared', '--enable-static', '--enable-gpl', '--enable-libx264', '--enable-videotoolbox', '--enable-audiotoolbox',
      '--enable-zlib', '--enable-bzlib', '--enable-iconv', '--extra-libs=-liconv', '--pkg-config-flags=--static',
      `--extra-cflags=-mmacosx-version-min=14.0 -I${prefix}/include`, `--extra-ldflags=-mmacosx-version-min=14.0 -L${prefix}/lib`], ffmpeg);
    await run('make', ['-j4'], ffmpeg);
    await run('make', ['install'], ffmpeg);
  }
  await mkdir(path.join(destination, 'bin'), { recursive: true });
  await mkdir(path.join(destination, 'licenses'), { recursive: true });
  for (const name of ['ffmpeg', 'ffprobe']) {
    const binary = path.join(destination, 'bin', name);
    await cp(path.join(prefix, 'bin', name), binary);
    const links = execFileSync('otool', ['-L', binary], { encoding: 'utf8' });
    for (const line of links.split('\n').slice(1)) {
      const dependency = line.trim().split(' (compatibility')[0];
      if (dependency && !dependency.startsWith('/System/') && !dependency.startsWith('/usr/lib/')) throw new Error(`Nonportable FFmpeg library: ${dependency}`);
    }
    execFileSync('codesign', ['--force', '--sign', '-', binary]);
  }
  await cp(path.join(ffmpeg, 'COPYING.GPLv2'), path.join(destination, 'licenses/FFmpeg-GPLv2.txt'));
  await cp(path.join(x264, 'COPYING'), path.join(destination, 'licenses/x264-GPLv2.txt'));
  await cp(archive, path.join(destination, 'licenses/ffmpeg-8.1.1-source.tar.xz'));
  await run('git', ['archive', '--format=tar', '--output', path.join(destination, 'licenses/x264-source.tar'), revision], x264);
  await cp(fileURLToPath(import.meta.url), path.join(destination, 'licenses/build-recipe.mjs'));
  await writeFile(path.join(destination, 'licenses/ffmpeg-build.txt'), execFileSync(path.join(destination, 'bin/ffmpeg'), ['-version'], { encoding: 'utf8' }));
}
