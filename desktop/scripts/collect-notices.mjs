import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Next's output tracing does not promise to retain non-executed license files.
export async function collectNotices(root, runtime, sitePackages) {
  const notices = path.join(runtime, 'licenses');
  await mkdir(notices, { recursive: true });
  await cp(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(notices, 'THIRD_PARTY_NOTICES.md'));
  await cp(path.join(root, 'docs/licence-review.md'), path.join(notices, 'licence-review.md'));
  await cp(path.join(root, 'webapp/node_modules/@fontsource-variable/ibm-plex-sans/LICENSE'), path.join(notices, 'IBM-Plex-Sans-OFL.txt'));
  const packages = [];
  async function scanModules(modules) {
    for (const entry of await readdir(modules, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const directory = path.join(modules, entry.name);
      if (entry.name.startsWith('@')) { await scanModules(directory); continue; }
      let metadata;
      try { metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); } catch { continue; }
      const id = `${metadata.name.replaceAll('/', '__')}@${metadata.version}`;
      const destination = path.join(notices, 'javascript', id);
      await mkdir(destination, { recursive: true });
      // Prefer the complete matching package to supplement traced files.
      let source = path.join(root, 'webapp/node_modules', metadata.name);
      try {
        const original = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
        if (original.version !== metadata.version) source = directory;
      } catch { source = directory; }
      const files = [];
      for (const name of await readdir(source)) {
        if (!/^(licen[cs]e|copying|notice|copyright)([.\-_]|$)/i.test(name)) continue;
        await cp(path.join(source, name), path.join(destination, name), { recursive: true });
        files.push(name);
      }
      packages.push({ ecosystem: 'npm', name: metadata.name, version: metadata.version, license: metadata.license ?? 'REVIEW REQUIRED', notices: files });
      await scanModules(path.join(directory, 'node_modules'));
    }
  }
  await scanModules(path.join(runtime, 'renderer/node_modules'));
  for (const name of await readdir(sitePackages)) {
    if (!name.endsWith('.dist-info')) continue;
    const metadata = await readFile(path.join(sitePackages, name, 'METADATA'), 'utf8');
    const field = (key) => new RegExp(`^${key}: (.+)$`, 'm').exec(metadata)?.[1];
    packages.push({ ecosystem: 'pypi', name: field('Name'), version: field('Version'), license: field('License-Expression') ?? field('License') ?? 'See package classifiers/license files', metadata: path.relative(runtime, path.join(sitePackages, name, 'METADATA')).split(path.sep).join('/') });
  }
  packages.sort((a, b) => `${a.ecosystem}/${a.name}`.localeCompare(`${b.ecosystem}/${b.name}`));
  await writeFile(path.join(notices, 'dependency-inventory.json'), JSON.stringify({ note: 'Metadata inventory, not a legal compatibility determination. Electron/Chromium, Python, FFmpeg, fonts and model weights have additional notices.', packages }, null, 2) + '\n');
}
