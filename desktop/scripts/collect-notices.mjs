import { cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../core/resource-layout.mjs';

const isNotice = (name) => /^(licen[cs]e|copying|notice|copyright|third[-_]?party[-_]?notices?)([.\-_]|$)/i.test(name);
const relativePath = (root, file) => path.relative(root, file).split(path.sep).join('/');

export async function supplementNotices(metadata, destination) {
  if (metadata.version !== '15.5.28' || !(metadata.name === '@next/env' || metadata.name.startsWith('@next/swc-'))) return [];
  const directory = fileURLToPath(new URL('../compliance/notices/', import.meta.url));
  const { files } = JSON.parse(await readFile(path.join(directory, 'provenance.json'), 'utf8'));
  const selected = metadata.name === '@next/env' ? files : files.slice(0, 1);
  for (const file of selected) {
    const source = path.join(directory, file.filename);
    if (await sha256File(source) !== file.sha256) throw new Error(`Supplemental notice checksum mismatch: ${file.filename}`);
    await cp(source, path.join(destination, file.filename));
  }
  await writeFile(path.join(destination, 'notice-provenance.json'), JSON.stringify({
    note: 'Upstream Next monorepo MIT notice for this exact package version. @next/env bundles dotenv 16.3.1 and dotenv-expand 10.0.0. This is not a transitive native-code licence audit.',
    files: selected,
  }, null, 2) + '\n');
  return selected.map((file) => file.filename);
}

// Include notices for vendored libraries inside packages (for example Next's
// dist/compiled), without following links or treating another npm package as ours.
async function copyNotices(source, destination, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await copyNotices(source, destination, name));
    else if (isNotice(entry.name)) {
      await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
      await cp(path.join(source, name), path.join(destination, name));
      files.push(name.split(path.sep).join('/'));
    }
  }
  return files;
}

// Next's output tracing does not promise to retain non-executed license files.
export async function collectNotices(root, runtime, sitePackages, notices = path.join(runtime, 'licenses'), sourceDirectory) {
  await mkdir(notices, { recursive: true });
  for (const directory of ['javascript', 'python']) await rm(path.join(notices, directory), { recursive: true, force: true });
  await cp(path.join(root, 'LICENSE'), path.join(notices, 'Annotate-GPL-3.0.txt'));
  await cp(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(notices, 'THIRD_PARTY_NOTICES.md'));
  await cp(path.join(root, 'docs/licence-review.md'), path.join(notices, 'licence-review.md'));
  await cp(path.join(root, 'docs/distribution-compliance.md'), path.join(notices, 'distribution-compliance.md'));
  await cp(path.join(root, 'webapp/node_modules/@fontsource-variable/ibm-plex-sans/LICENSE'), path.join(notices, 'IBM-Plex-Sans-OFL.txt'));
  const packages = [];
  const javascript = new Map();
  async function collectPackage(directory, scope, expectedVersion) {
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    if (expectedVersion && expectedVersion !== metadata.version) throw new Error(`Notice input differs from lockfile: ${metadata.name}`);
    const id = `${metadata.name.replaceAll('/', '__')}@${metadata.version}`;
    if (javascript.has(id)) {
      const record = javascript.get(id);
      if (!record.scopes.includes(scope)) record.scopes.push(scope);
      return;
    }
    const destination = path.join(notices, 'javascript', id);
    await mkdir(destination, { recursive: true });
    let source = path.join(root, 'webapp/node_modules', metadata.name);
    try {
      const original = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
      if (original.version !== metadata.version) source = directory;
    } catch { source = directory; }
    const files = await copyNotices(source, destination);
    const supplementalNotices = await supplementNotices(metadata, destination);
    files.push(...supplementalNotices);
    const nativeLibraries = [];
    if (sourceDirectory && metadata.name === '@img/sharp-libvips-darwin-arm64' && metadata.version === '1.3.4') {
      const index = JSON.parse(await readFile(path.join(sourceDirectory, 'index.json'), 'utf8'));
      for (const archive of index.archives.filter((item) => item.kind === 'sharp-native-source')) {
        const prefix = path.join('native', archive.name);
        const copied = await copyNotices(path.join(sourceDirectory, 'notices', archive.name), path.join(destination, prefix));
        files.push(...copied.map((file) => `${prefix}/${file}`));
        nativeLibraries.push({ name: archive.name, version: archive.version, url: archive.url, sha256: archive.sha256, coverage: archive.coverage });
      }
      await writeFile(path.join(destination, 'native-notice-provenance.json'), JSON.stringify({
        completeCorrespondingSource: false, note: 'Actual base-library notices from verified upstream sources. Rust dependencies and replacement/relinking verification remain open.', libraries: nativeLibraries,
      }, null, 2) + '\n');
    }
    // sharp-libvips describes its bundled libraries in README and versions.json,
    // rather than a top-level LICENSE. Preserve this evidence, but do not mistake
    // it for complete licence texts or corresponding source.
    for (const name of ['README.md', 'versions.json']) {
      try {
        const text = await readFile(path.join(source, name), 'utf8');
        if (name === 'versions.json' || /licen[cs]/i.test(text)) await writeFile(path.join(destination, name), text);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const record = { ecosystem: 'npm', name: metadata.name, version: metadata.version, license: metadata.license ?? 'REVIEW REQUIRED', scopes: [scope], notices: files,
      supplementalNotices, noticeReviewRequired: files.length === 0 };
    if (nativeLibraries.length) record.nativeDependencyReviewRequired = true;
    if (metadata.name === 'client-only') record.noticeReviewReason = 'Published package declares MIT but supplies no copyright/licence text. Do not infer the original copyright holder from Next bundling it.';
    javascript.set(id, record);
    packages.push(record);
  }
  async function scanModules(modules) {
    for (const entry of await readdir(modules, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const directory = path.join(modules, entry.name);
      if (entry.name.startsWith('@')) { await scanModules(directory); continue; }
      await collectPackage(directory, 'server-runtime');
      await scanModules(path.join(directory, 'node_modules'));
    }
  }
  await scanModules(path.join(runtime, 'renderer/node_modules'));
  // Bundled client code is absent from the standalone server's node_modules.
  // Include installed non-dev inputs conservatively, even if tree-shaken later.
  const lock = JSON.parse(await readFile(path.join(root, 'webapp/package-lock.json'), 'utf8'));
  for (const [relative, metadata] of Object.entries(lock.packages)) {
    if (!relative.startsWith('node_modules/') || metadata.dev) continue;
    const directory = path.join(root, 'webapp', relative);
    try { await readFile(path.join(directory, 'package.json')); }
    catch (error) { if (error.code === 'ENOENT' && metadata.optional) continue; throw error; }
    await collectPackage(directory, 'production-build-input', metadata.version);
  }
  for (const name of await readdir(sitePackages)) {
    if (!name.endsWith('.dist-info')) continue;
    const metadata = await readFile(path.join(sitePackages, name, 'METADATA'), 'utf8');
    const field = (key) => new RegExp(`^${key}: (.+)$`, 'm').exec(metadata)?.[1];
    const destination = path.join(notices, 'python', name);
    await mkdir(destination, { recursive: true });
    const files = await copyNotices(path.join(sitePackages, name), destination);
    await writeFile(path.join(destination, 'METADATA'), metadata);
    const classifiers = [...metadata.matchAll(/^Classifier: (License :: .+)$/gm)].map((match) => match[1]);
    packages.push({ ecosystem: 'pypi', name: field('Name'), version: field('Version'), license: field('License-Expression') ?? field('License') ?? (classifiers.join('; ') || 'REVIEW REQUIRED'),
      metadata: relativePath(runtime, path.join(sitePackages, name, 'METADATA')), notices: files });
  }
  // Binary wheels can keep third-party notices outside .dist-info (OpenCV does).
  await copyNotices(sitePackages, path.join(notices, 'python/bundled-notices'));
  const agpl = packages.find((item) => item.ecosystem === 'pypi' && item.name === 'ultralytics');
  if (agpl) {
    const dist = (await readdir(sitePackages)).find((name) => name.startsWith(`ultralytics-${agpl.version}.dist-info`));
    const candidates = ['licenses/LICENSE', 'LICENSE'];
    let copied = false;
    for (const candidate of candidates) {
      try { await cp(path.join(sitePackages, dist, candidate), path.join(notices, 'Ultralytics-AGPL-3.0.txt')); copied = true; break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!copied) throw new Error('Ultralytics AGPL licence text is missing.');
  }
  packages.sort((a, b) => `${a.ecosystem}/${a.name}`.localeCompare(`${b.ecosystem}/${b.name}`));
  await writeFile(path.join(notices, 'dependency-inventory.json'), JSON.stringify({ note: 'Metadata inventory, not a legal compatibility determination. Electron/Chromium, Python, FFmpeg, fonts and model weights have additional notices.', packages }, null, 2) + '\n');
}
