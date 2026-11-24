import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';

const recordName = 'ANNOTATE-PACKAGING.json';
const configPath = '.next-desktop/required-server-files.json';
export const imageOptimizerPackage = name => name === 'sharp' || name.startsWith('@img/');

async function configuration(renderer) {
  const file = path.join(renderer, configPath);
  const { config } = JSON.parse(await readFile(file, 'utf8'));
  if (config?.images?.unoptimized !== true) throw new Error('Image optimization must be disabled in the built renderer before removing sharp.');
  return { file, sha256: await sha256File(file) };
}

export async function pruneUnusedImageOptimizer(renderer) {
  const config = await configuration(renderer);
  const modules = path.join(renderer, 'node_modules');
  const omittedPackages = [];
  const candidates = ['sharp'];
  try { candidates.push(...(await readdir(path.join(modules, '@img'))).map(name => `@img/${name}`)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of candidates) {
    try {
      const metadata = JSON.parse(await readFile(path.join(modules, name, 'package.json'), 'utf8'));
      omittedPackages.push({ name: metadata.name, version: metadata.version });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of ['sharp', '@img']) await rm(path.join(modules, name), { recursive: true, force: true });
  const record = { schema: 1, imageOptimization: false, configSha256: config.sha256, omittedPackages,
    reason: 'Annotate serves its own images and uses no Next image optimization. No application media codecs or CV dependencies are removed.' };
  await mkdir(renderer, { recursive: true });
  await writeFile(path.join(renderer, recordName), JSON.stringify(record, null, 2) + '\n');
  return record;
}

// Old staging must keep its source/notices obligations. Only a verified,
// explicitly unoptimized build with the libraries absent can omit them.
export async function inspectRendererPackaging(renderer) {
  let record;
  try { record = JSON.parse(await readFile(path.join(renderer, recordName), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (record.schema !== 1 || record.imageOptimization !== false) throw new Error('Invalid renderer packaging record.');
  if ((await configuration(renderer)).sha256 !== record.configSha256) throw new Error('Renderer packaging configuration changed.');
  for (const name of ['sharp', '@img']) {
    try { await access(path.join(renderer, 'node_modules', name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Excluded image optimizer is still present: ${name}`);
  }
  return record;
}
