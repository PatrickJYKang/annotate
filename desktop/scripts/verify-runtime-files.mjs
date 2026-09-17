import { open, readdir, realpath, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveResourceLayout } from '../core/resource-layout.mjs';

const root = await realpath(path.resolve(process.argv[2]));
const manifest = JSON.parse(await readFile(path.join(root, 'runtime-manifest.json'), 'utf8'));
await resolveResourceLayout(root, path.join(os.tmpdir(), 'annotate-resource-verification'), { platform: manifest.platform, arch: manifest.arch });
if (manifest.platform === 'win32') {
  for (const name of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']) await access(path.join(root, 'python', name));
}
let binaries = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await realpath(file);
      if (!target.startsWith(root + path.sep)) throw new Error(`External symlink: ${file} -> ${target}`);
      continue;
    }
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!entry.isFile()) throw new Error(`Unexpected resource type: ${file}`);
    // Packaging libraries ship inert launcher templates for multiple platforms;
    // these are data, not executables used by the application runtime.
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative.includes('/pip/_vendor/distlib/') && relative.endsWith('.exe')) continue;
    if (/\/setuptools\/(cli|gui)(-[\w-]+)?\.exe$/.test(relative)) continue;
    const handle = await open(file);
    try {
      const header = Buffer.alloc(512);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead < 64) continue;
      const magic = header.readUInt32BE(0);
      if (magic === 0xcffaedfe) {
        if (manifest.platform !== 'darwin' || header.readUInt32LE(4) !== 0x100000c) throw new Error(`Wrong Mach-O architecture: ${file}`);
        binaries++;
      } else if (magic === 0xcafebabe || magic === 0xcafebabf) {
        const count = header.readUInt32BE(4);
        const stride = magic === 0xcafebabf ? 32 : 20;
        if (count > 16) continue; // Java class files share the same magic.
        const arches = Array.from({ length: count }, (_, i) => header.readUInt32BE(8 + i * stride));
        if (manifest.platform !== 'darwin' || !arches.includes(0x100000c)) throw new Error(`Wrong universal binary: ${file}`);
        binaries++;
      } else if (header[0] === 0x4d && header[1] === 0x5a) {
        const pe = Buffer.alloc(6);
        await handle.read(pe, 0, 6, header.readUInt32LE(60));
        if (pe.readUInt32LE(0) !== 0x4550) continue;
        if (manifest.platform !== 'win32' || pe.readUInt16LE(4) !== 0x8664) throw new Error(`Wrong Windows binary: ${file}`);
        binaries++;
      } else if (magic === 0x7f454c46) throw new Error(`Unexpected Linux binary: ${file}`);
    } finally { await handle.close(); }
  }
}
await walk(root);
console.log(`Verified ${binaries} native binaries for ${manifest.platform}/${manifest.arch}, required resource checksums and internal-only symlinks.`);
