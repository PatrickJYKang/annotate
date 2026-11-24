import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';
import { machoEvidence } from './macho-evidence.mjs';

// Read-only fingerprints of the media/image binaries actually shipped, including
// libraries hidden inside wheels. Package metadata can understate their licences.
export async function nativeInventory(runtime, target) {
  const cv2 = target === 'win32-x64' ? 'python/Lib/site-packages/cv2' : 'python/lib/python3.12/site-packages/cv2';
  const files = [];
  async function scan(relative) {
    for (const entry of await readdir(path.join(runtime, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const filename = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await scan(filename);
      else if (/\.(dll|dylib|exe|node|so|wasm)$/.test(entry.name) || ['ffmpeg', 'ffprobe'].includes(entry.name)) {
        const absolute = path.join(runtime, filename);
        const metadata = await stat(absolute);
        const record = { path: filename, size: metadata.size, sha256: await sha256File(absolute) };
        if (target === 'darwin-arm64') {
          const bytes = await readFile(absolute);
          if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0xfeedfacf) record.macho = machoEvidence(bytes);
        }
        files.push(record);
      }
    }
  }
  for (const directory of ['ffmpeg', cv2]) await scan(directory);
  try { await scan('renderer/node_modules/@img'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const ffmpegEvidence = [];
  // Read strings from the library without loading executable code or a model.
  for (const file of files.filter((item) => /libavutil.*\.dylib$/.test(item.path))) {
    const bytes = await readFile(path.join(runtime, file.path));
    const strings = bytes.toString('latin1').split('\0');
    for (const value of strings.filter((value) => value.startsWith('--prefix=') || /^libavutil license:/.test(value))) {
      ffmpegEvidence.push({ path: file.path, value });
    }
  }
  return { target, files: files.sort((a, b) => a.path.localeCompare(b.path)), ffmpegEvidence,
    note: 'Binary fingerprints and embedded build strings, not complete source or licence clearance. No binaries were executed or modified.' };
}
