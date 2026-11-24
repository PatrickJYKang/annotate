import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inspectWindowsMedia } from './windows-media-evidence.mjs';
import { sha256File } from '../core/resource-layout.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node desktop/scripts/package-windows-media-check.mjs <media-candidate> <new-output-directory>');
const media = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
if (!await inspectWindowsMedia(media)) throw new Error('Verify the controlled media source record first.');
try { if ((await readdir(output)).length) throw new Error('Choose an empty output folder.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output, { recursive: true });
await cp(media, path.join(output, 'media'), { recursive: true });
for (const extension of ['cmd', 'ps1', 'py']) await cp(path.join(root, `desktop/scripts/check-windows-media.${extension}`), path.join(output, `check-windows-media.${extension}`));
const files = [];
for (const relative of ['media/bin/ffmpeg.exe', 'media/bin/ffprobe.exe', 'check-windows-media.py']) files.push({ path: relative, sha256: await sha256File(path.join(output, relative)) });
await writeFile(path.join(output, 'check-files.json'), JSON.stringify({ schema: 1, files }, null, 2) + '\n');
await writeFile(path.join(output, 'README.txt'), [
  'Annotate Windows media compatibility check',
  '1. Extract this ZIP on Windows. Leave the existing Annotate app installed.',
  '2. Double-click check-windows-media.cmd and choose a football video.',
  '3. Wait for completion, then return results.json and commands.log from the new Annotate-media-check-* folder beside the launcher.',
  'Nothing is installed, replaced or uploaded. Your video and project files are not changed. The launcher uses the Python already inside Annotate; you do not need to install Python.',
  'The launcher permits its local PowerShell script for this process only; it does not change system execution policy. Close it or cancel the chooser to decline.',
  'Logs contain local file paths and video metadata. Review them before sharing. A failure also saves launcher-error.txt or results.json rather than closing without a record.',
  'This is a diagnostic candidate, not an app update or a release approval. The source archives, notices and recorded build commands for the media executables are under media/licenses/. The diagnostic scripts are GPL-3.0-only; see LICENSE.',
].join('\r\n\r\n') + '\r\n');
await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
execFileSync('ditto', ['-c', '-k', '--keepParent', output, `${output}.zip`]);
await writeFile(`${output}.zip.sha256`, `${await sha256File(`${output}.zip`)}  ${path.basename(output)}.zip\n`);
console.log(`${output}.zip`);
