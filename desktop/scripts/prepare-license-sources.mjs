import { createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';

export function validateSourceLock(lock, requirements) {
  if (lock.schema !== 1 || !Array.isArray(lock.archives)) throw new Error('Invalid source lock.');
  const names = new Set();
  const identities = new Set();
  for (const source of lock.archives) {
    if (!/^[\w.-]+\.(tar\.(gz|xz)|patch)$/.test(source.filename) || !/^[a-f0-9]{64}$/.test(source.sha256)
      || new URL(source.url).protocol !== 'https:' || names.has(source.filename)) throw new Error('Invalid or duplicate source archive.');
    if (!/^[a-zA-Z0-9][\w.-]*$/.test(source.name) || identities.has(source.name) || (source.targets && (!Array.isArray(source.targets) || source.targets.some((target) => !['darwin-arm64', 'win32-x64'].includes(target))))) throw new Error('Invalid source identity or target.');
    names.add(source.filename);
    identities.add(source.name);
    if (source.kind === 'python-sdist' && !requirements.split(/\r?\n/).some((line) => line.trim().toLowerCase() === `${source.name}==${source.version}`.toLowerCase())) {
      throw new Error(`Source lock is stale: ${source.name} ${source.version}`);
    }
  }
}

export async function readNativeVersions(root, target) {
  const nativePackage = target === 'darwin-arm64' ? 'sharp-libvips-darwin-arm64' : 'sharp-win32-x64';
  const relative = path.join('node_modules/@img', nativePackage);
  const staged = path.join(root, 'desktop/build', target, 'runtime/renderer', relative);
  try {
    return { versions: JSON.parse(await readFile(path.join(staged, 'versions.json'), 'utf8')), provenance: 'Staged package versions.json' };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Next traces the dylib but can omit versions.json. Use build-input metadata
  // only after proving its package version AND each staged library are identical.
  const original = path.join(root, 'webapp', relative);
  const installed = JSON.parse(await readFile(path.join(original, 'package.json'), 'utf8'));
  const traced = JSON.parse(await readFile(path.join(staged, 'package.json'), 'utf8'));
  if (installed.version !== traced.version) throw new Error('Cannot identify traced native source: package versions differ.');
  const libraries = (await readdir(path.join(staged, 'lib'))).filter((name) => /\.(dylib|dll|node)$/.test(name));
  if (!libraries.length) throw new Error('Cannot identify traced native source: no library to compare.');
  const hashes = {};
  for (const name of libraries) {
    const hash = await sha256File(path.join(staged, 'lib', name));
    if (hash !== await sha256File(path.join(original, 'lib', name))) throw new Error(`Cannot identify traced native source: binary differs (${name}).`);
    hashes[name] = hash;
  }
  return { versions: JSON.parse(await readFile(path.join(original, 'versions.json'), 'utf8')), provenance: 'Build-input versions.json, package version and native binaries verified identical to traced runtime', hashes };
}

export function validateNativeVersions(archives, versions) {
  for (const source of archives.filter((item) => item.kind === 'sharp-native-source')) {
    if (versions[source.library] !== source.version) throw new Error(`Native source lock is stale: ${source.library} ${source.version}`);
  }
  const missing = Object.keys(versions).filter((library) => !archives.some((source) => source.kind === 'sharp-native-source' && source.library === library));
  if (missing.length) throw new Error(`Native source lock lacks libraries: ${missing.join(', ')}`);
}

export function sourceNoticePath(member) {
  if (member.includes('\\') || member.startsWith('/') || member.split('/').some((part) => part === '..' || part.startsWith('-'))) throw new Error('Unsafe source archive member.');
  if (member.endsWith('/')) return null;
  return /^(licen[cs]e|copying|copyright|notice|third[-_]?party[-_]?notices?|ftl)([.\-_]|$)/i.test(path.posix.basename(member)) ? member : null;
}

// Stream individual texts out of tar, never unpack or execute downloaded source.
async function collectSourceNotices(archive, destination) {
  const members = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\n').filter(Boolean);
  const notices = members.map(sourceNoticePath).filter(Boolean);
  if (notices.length > 2000) throw new Error('Unexpected number of source notices.');
  for (const member of notices) {
    const text = execFileSync('tar', ['-xOf', archive, '--', member], { maxBuffer: 2 * 1024 * 1024 });
    const output = path.join(destination, member);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, text);
  }
  return notices;
}

export async function stageLicenseSources(root, destination, target, fetchArchive = fetch, { evidence = false } = {}) {
  if (!['darwin-arm64', 'win32-x64'].includes(target)) throw new Error('Unsupported source target.');
  const lock = JSON.parse(await readFile(path.join(root, 'desktop/compliance/sources.lock.json'), 'utf8'));
  validateSourceLock(lock, await readFile(path.join(root, 'sidecar/requirements.lock.txt'), 'utf8'));
  const selected = lock.archives.filter((source) => !source.targets || source.targets.includes(target));
  let nativeVersionEvidence;
  if (selected.some((source) => source.kind === 'sharp-native-source')) {
    nativeVersionEvidence = await readNativeVersions(root, target);
    validateNativeVersions(selected, nativeVersionEvidence.versions);
  }
  const cache = path.join(root, 'desktop/build/downloads');
  await mkdir(cache, { recursive: true });
  await mkdir(destination, { recursive: true });
  const records = [];
  for (const source of selected) {
    const cached = path.join(cache, source.filename);
    let verified = false;
    try { verified = await sha256File(cached) === source.sha256; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!verified) {
      const temporary = `${cached}.${randomUUID()}.tmp`;
      try {
        const response = await fetchArchive(source.url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok || !response.body) throw new Error(`Source download failed: ${source.name} (${response.status})`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
        if (await sha256File(temporary) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.name}`);
        await rename(temporary, cached);
      } finally { await rm(temporary, { force: true }); }
    }
    const archiveIncluded = evidence || !source.evidenceOnly;
    if (archiveIncluded) await cp(cached, path.join(destination, source.filename));
    const notices = source.collectNotices ? await collectSourceNotices(cached, path.join(destination, 'notices', source.name)) : [];
    records.push({ ...source, archiveIncluded, notices });
  }
  const index = { schema: 1, target, completeCorrespondingSource: false, nativeVersionEvidence,
    note: 'Verified source inputs, not distribution clearance. Native source archives accompany the separate evidence bundle, not the installer. See distribution-compliance.md for missing inputs and permission gates.', archives: records };
  await writeFile(path.join(destination, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const target = process.argv[2];
  const destination = path.join(root, 'desktop/build', target ?? '', 'runtime/licenses/sources');
  const result = await stageLicenseSources(root, destination, target);
  console.log(`Verified ${result.archives.length} source archives for ${target}; complete distribution clearance remains pending.`);
}
