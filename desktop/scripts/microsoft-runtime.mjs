import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';

export const isMicrosoftRuntime = name => /^(msvc[pbr]|vcruntime|concrt|vcamp|vccorlib|vcomp)\d.*\.dll$/i.test(name);

// Packaging-time verification, not a runtime restriction on replacement libraries.
export async function inspectMicrosoftRuntime(root, runtime, { lock: suppliedLock } = {}) {
  const lock = suppliedLock ?? JSON.parse(await readFile(path.join(root, 'desktop/compliance/msvc-runtime.json'), 'utf8'));
  if (lock.schema !== 1 || !lock.maintainerConfirmation?.installedAndTermsAccepted || !lock.files?.length || !lock.notices?.length) throw new Error('Microsoft runtime review is incomplete.');
  const paths = new Set();
  for (const file of [...lock.files, ...lock.notices]) {
    if (!file.path || file.path.includes('\\') || path.posix.isAbsolute(file.path) || file.path.split('/').includes('..') || paths.has(file.path)) throw new Error('Invalid Microsoft runtime review path.');
    paths.add(file.path);
    if (await sha256File(path.join(runtime, file.path)) !== file.sha256) throw new Error(`Microsoft runtime or notice changed: ${file.path}`);
  }
  const found = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (isMicrosoftRuntime(entry.name)) {
        const relative = path.relative(runtime, file).split(path.sep).join('/');
        if (!entry.isFile() || !lock.files.some(item => item.path === relative)) throw new Error(`Unreviewed Microsoft runtime: ${relative}`);
        found.push(relative);
      }
    }
  }
  await walk(runtime);
  if (found.length !== lock.files.length) throw new Error('Microsoft runtime inventory is incomplete.');
  return { filesVerified: true, reviewedAt: lock.reviewedAt, maintainerConfirmation: lock.maintainerConfirmation, references: lock.references, files: lock.files, notices: lock.notices, note: 'Documented redistribution basis and byte/notice verification. Not a legal opinion or native Windows execution test.' };
}

export function windowsRuntimeLicensePage(original) {
  if (!original.startsWith('{\\rtf1') || !original.includes('MICROSOFT VISUAL C++ 2015 - 2022 RUNTIME')) throw new Error('Unexpected Microsoft runtime terms.');
  const start = original.indexOf('\\pard');
  if (start < 0) throw new Error('Microsoft runtime terms have no document body.');
  const intro = '\\pard\\sb120\\sa120\\b Annotate - bundled Microsoft runtime terms\\b0\\par These terms apply ONLY to the Microsoft Visual C++ runtime DLLs bundled with this Windows installation. They do not restrict your rights in Annotate (GPL-3.0-only) or other open-source components. Their licences and source information remain available in Help > Open-source licences and in the matching release source download.\\par\\par ';
  return original.slice(0, start) + intro + original.slice(start).replace(/\0+$/, '');
}

export async function prepareWindowsRuntimeLicense(root, runtime, destination) {
  await inspectMicrosoftRuntime(root, runtime);
  const original = await readFile(path.join(runtime, 'licenses/msvc/u4.rtf'), 'utf8');
  await writeFile(destination, windowsRuntimeLicensePage(original));
  return destination;
}
