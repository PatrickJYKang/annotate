import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowsFFmpegInputs, windowsFFmpegConfigure } from '../scripts/controlled-windows-ffmpeg.mjs';

test('Windows media build pins source inputs and retains normal decoding, encoding and Windows APIs', () => {
  for (const input of windowsFFmpegInputs) assert.match(input.sha256, /^[a-f0-9]{64}$/);
  const args = windowsFFmpegConfigure('/prefix', '/compiler/x86_64-w64-mingw32-');
  for (const flag of ['--enable-libx264', '--enable-libdav1d', '--enable-zlib', '--enable-mediafoundation', '--enable-d3d11va', '--enable-dxva2', '--enable-schannel', '--disable-autodetect', '--enable-gpl', '--enable-version3']) assert.ok(args.includes(flag));
  assert.equal(args.some(arg => /^--disable-(everything|decoders|demuxers|filters|encoders)/.test(arg)), false);
  assert.equal(args.includes('--disable-x86asm'), false);
  assert.equal(args.includes('--enable-nonfree'), false);
});
