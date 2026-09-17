import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js';

export async function bundleWindowsRuntime(output, cache, download) {
  const archive = await download('https://download.visualstudio.microsoft.com/download/pr/9d270333-8b7b-4f96-9458-6fcdb2ec0b25/CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B/VC_redist.x64.exe',
    'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b', 'vc_redist.x64.exe');
  const sevenZip = await getPath7za();
  const unpack = path.join(cache, 'vc-unpack');
  await mkdir(unpack, { recursive: true });
  const bytes = await readFile(archive);
  let count = 0;
  // WiX Burn stores its bootstrap resources and attached payload in separate
  // CAB containers. Extract both from the checksum-pinned Microsoft installer.
  for (let offset = bytes.indexOf('MSCF'); offset >= 0; offset = bytes.indexOf('MSCF', offset + 4)) {
    const length = bytes.readUInt32LE(offset + 8);
    if (length < 36 || offset + length > bytes.length) throw new Error('Invalid VC runtime cabinet.');
    const cabinet = path.join(unpack, `container-${count++}.cab`);
    await writeFile(cabinet, bytes.subarray(offset, offset + length));
    execFileSync(sevenZip, ['x', cabinet, `-o${unpack}`, '-y'], { stdio: 'pipe' });
  }
  if (count !== 2) throw new Error('Unexpected VC redistributable layout.');
  const libraries = path.join(unpack, 'x64');
  execFileSync(sevenZip, ['x', path.join(unpack, 'a12'), `-o${libraries}`, '-y'], { stdio: 'pipe' });
  for (const name of await readdir(libraries)) {
    if (!name.endsWith('.dll_amd64')) continue;
    await cp(path.join(libraries, name), path.join(output, 'python', name.replace('_amd64', '')));
  }
  const notices = path.join(output, 'licenses/msvc');
  await mkdir(notices, { recursive: true });
  for (const name of await readdir(unpack)) {
    if (!/^u\d+$/.test(name)) continue;
    const content = await readFile(path.join(unpack, name));
    if (content.subarray(0, 6).toString().startsWith('{\\rtf')) await cp(path.join(unpack, name), path.join(notices, `${name}.rtf`));
  }
  await writeFile(path.join(notices, 'SOURCE.txt'), 'Microsoft Visual C++ Redistributable 14.44.35211.0, app-local x64 minimum-runtime DLLs.\nSource and checksum are pinned in desktop/scripts/bundle-windows-runtime.mjs.\n');
}
