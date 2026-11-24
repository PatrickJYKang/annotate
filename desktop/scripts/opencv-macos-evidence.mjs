import { readFile, readdir, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { machoEvidence, sameMachOBuild } from './macho-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safeName = value => typeof value === 'string' && /^[a-zA-Z0-9][\w.@-]*$/.test(value);
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// This is evidence for one wheel, not permission to substitute a same-version
// library from another build. Any changed, missing or added dylib needs review.
export async function inspectOpenCVMac(directory, lock) {
  if (lock.schema !== 1 || lock.package !== 'opencv-python' || lock.version !== '4.11.0.86'
    || !Array.isArray(lock.libraries) || !Array.isArray(lock.builds)) throw new Error('Invalid OpenCV provenance lock.');
  const expected = lock.libraries.map(item => item.file).sort();
  if (!expected.length || expected.some(file => !safeName(file) || !file.endsWith('.dylib'))
    || new Set(expected).size !== expected.length) throw new Error('Invalid OpenCV library paths.');
  const actual = (await readdir(directory)).filter(file => file.endsWith('.dylib')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('OpenCV bundled-library inventory changed; review provenance.');
  const builds = new Map();
  for (const build of lock.builds) {
    if (!safeName(build.formula) || !checksum(build.bottleSha256) || !checksum(build.recipeSha256)
      || builds.has(build.formula)) throw new Error('Invalid Homebrew build evidence.');
    builds.set(build.formula, build);
  }
  const libraries = [];
  for (const item of lock.libraries) {
    if (!safeName(item.formula) || !checksum(item.sha256)) throw new Error('Invalid OpenCV library fingerprint.');
    const bytes = await readFile(path.join(directory, item.file));
    if (hash(bytes) !== item.sha256) throw new Error(`OpenCV library changed: ${item.file}`);
    const evidence = machoEvidence(bytes);
    if (item.original && (!builds.has(item.formula) || !sameMachOBuild(evidence, item.original))) {
      throw new Error(`OpenCV build identity differs: ${item.file}`);
    }
    libraries.push({ file: item.file, formula: item.formula, sha256: item.sha256, matched: !!item.original, uuid: evidence.uuid });
  }
  return { completeCorrespondingSource: false, libraries,
    matchedLibraries: libraries.filter(item => item.matched).length,
    unresolvedLibraries: libraries.filter(item => !item.matched).map(item => item.file) };
}

export async function stageOpenCVMacEvidence(root, runtime, destination, archives) {
  const source = path.join(root, 'desktop/compliance/opencv-macos');
  const lock = JSON.parse(await readFile(path.join(source, 'provenance.json'), 'utf8'));
  const result = await inspectOpenCVMac(path.join(runtime, 'python/lib/python3.12/site-packages/cv2/.dylibs'), lock);
  for (const archive of archives.filter(item => item.kind === 'opencv-macos-source')) {
    if (!result.libraries.some(item => item.formula === archive.formula && item.matched)) throw new Error(`No verified OpenCV build for ${archive.formula}`);
  }
  await mkdir(path.join(destination, 'recipes'), { recursive: true });
  for (const build of lock.builds) {
    const file = `${build.formula}.rb`;
    if (hash(await readFile(path.join(source, 'recipes', file))) !== build.recipeSha256) throw new Error(`Homebrew recipe changed: ${file}`);
    await cp(path.join(source, 'recipes', file), path.join(destination, 'recipes', file));
  }
  for (const file of ['provenance.json', 'Homebrew-LICENSE.txt', 'README.md']) await cp(path.join(source, file), path.join(destination, file));
  return result;
}

// Optional offline recheck against cached original bottles. Nothing is loaded,
// installed or unpacked: read the exact named members through tar's stdout.
export async function verifyOriginalBottle(bottle, build, libraries) {
  if (hash(await readFile(bottle)) !== build.bottleSha256) throw new Error('Homebrew bottle checksum mismatch.');
  const member = name => {
    if (typeof name !== 'string' || name.startsWith('/') || name.includes('\\')
      || name.split('/').some(part => part === '..' || part.startsWith('-'))) throw new Error('Unsafe bottle member.');
    return execFileSync('tar', ['-xOf', bottle, '--', name], { maxBuffer: 128 * 1024 * 1024 });
  };
  if (hash(member(build.recipeMember)) !== build.recipeSha256) throw new Error('Homebrew bottle recipe mismatch.');
  for (const item of libraries.filter(item => item.formula === build.formula)) {
    const original = machoEvidence(member(item.originalMember));
    if (!item.original || original.sha256 !== item.original.sha256 || !sameMachOBuild(original, item.original)) throw new Error(`Original bottle differs: ${item.file}`);
  }
}
