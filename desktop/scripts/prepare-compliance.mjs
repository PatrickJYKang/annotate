import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectNotices } from './collect-notices.mjs';
import { stageLicenseSources } from './prepare-license-sources.mjs';
import { sha256File } from '../core/resource-layout.mjs';
import { nativeInventory } from './native-inventory.mjs';

// Evidence only. This does not rebuild, change or publish any installer.
export async function prepareCompliance(root, target) {
  if (!['darwin-arm64', 'win32-x64'].includes(target)) throw new Error('Choose darwin-arm64 or win32-x64.');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const commit = git('rev-parse', 'HEAD').trim();
  const status = git('status', '--porcelain');
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^[\w.-]+$/.test(version)) throw new Error('Invalid product version.');
  const runtime = path.join(root, 'desktop/build', target, 'runtime');
  const sitePackages = path.join(runtime, target === 'win32-x64' ? 'python/Lib/site-packages' : 'python/lib/python3.12/site-packages');
  const parent = path.join(root, 'desktop/artifacts/compliance');
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(path.join(parent, `${version}-${target}-${commit.slice(0, 8)}-`));
  const notices = path.join(output, 'notices');
  const native = await nativeInventory(runtime, target);
  await writeFile(path.join(output, 'native-binaries.json'), JSON.stringify(native, null, 2) + '\n');
  const sourceDirectory = path.join(output, 'sources');
  const sources = await stageLicenseSources(root, sourceDirectory, target, fetch, { evidence: true });
  await collectNotices(root, runtime, sitePackages, notices, sourceDirectory);
  await cp(path.join(root, 'docs/pnlcalib-licence-enquiry.md'), path.join(output, 'pnlcalib-licence-enquiry.md'));
  await cp(path.join(root, 'desktop/compliance/sources.lock.json'), path.join(output, 'sources.lock.json'));
  await cp(path.join(runtime, 'runtime-manifest.json'), path.join(output, 'staged-runtime-manifest.json'));
  if (target === 'darwin-arm64') {
    await cp(path.join(runtime, 'ffmpeg/licenses'), path.join(output, 'media-tools'), { recursive: true });
  } else {
    await mkdir(path.join(output, 'media-tools'), { recursive: true });
    for (const name of ['LICENSE', 'README.txt']) await cp(path.join(runtime, 'ffmpeg', name), path.join(output, 'media-tools', name));
    await cp(path.join(runtime, 'licenses/msvc'), path.join(output, 'msvc'), { recursive: true });
  }
  const archive = path.join(output, 'annotate-committed-source.tar.gz');
  git('archive', '--format=tar.gz', `--output=${archive}`, commit);
  await writeFile(path.join(output, 'working-tree.patch'), git('diff', '--binary', 'HEAD'));
  const inventory = JSON.parse(await readFile(path.join(notices, 'dependency-inventory.json'), 'utf8'));
  const after = await nativeInventory(runtime, target);
  if (JSON.stringify(native) !== JSON.stringify(after)) throw new Error('Staged native binaries changed during compliance collection.');
  const manifest = { schema: 1, version, target, commit, dirty: !!status.trim(), createdAt: new Date().toISOString(),
    completeCorrespondingSource: false, publicationCleared: false,
    runtimeBinariesUnchanged: true, nativeBinaryCount: native.files.length,
    note: 'Review evidence, not a cleared release. The staged runtime may predate the checkout. The source archive contains HEAD; the patch includes tracked edits only. Untracked files are listed, not automatically copied, to avoid exposing unrelated local files.',
    untrackedFilesNotIncluded: untracked, sourceArchiveSha256: await sha256File(archive),
    dependencyCount: inventory.packages.length,
    packagesWithoutNoticeFiles: inventory.packages.filter((item) => item.notices.length === 0).map(({ ecosystem, name, version }) => ({ ecosystem, name, version })),
    upstreamSources: sources.archives.map(({ name, filename, sha256, coverage }) => ({ name, filename, sha256, coverage })),
    openGates: ['PnLCalib code licence version', 'PnLCalib weight terms', 'Windows FFmpeg linked-library sources', 'Native-library corresponding-source and relinking review', 'Microsoft redistribution entitlement'] };
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(manifest, null, 2) + '\n');
  const bundle = `${output}.tar.gz`;
  execFileSync('tar', ['-czf', bundle, '-C', parent, path.basename(output)], { stdio: 'inherit' });
  await writeFile(`${bundle}.sha256`, `${await sha256File(bundle)}  ${path.basename(bundle)}\n`);
  return { output, bundle, dependencyCount: manifest.dependencyCount, publicationCleared: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareCompliance(fileURLToPath(new URL('../../', import.meta.url)), process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
}
