import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';

export const pnlcalibCommit = '42088864170f75ea02e76d20e9a9a1db59edb3e3';
const supplements = fileURLToPath(new URL('../compliance/pnlcalib/', import.meta.url));
const omittedDirectories = ['examples', 'figures', 'sn_calibration'];
const bundledNotices = ['ATTRIBUTION.md', 'HRNet-MIT.txt', 'CC-BY-4.0.txt', 'provenance.json'];
const recordedFiles = ['LICENSE', 'README.md', 'model/cls_hrnet.py', 'model/cls_hrnet_l.py', ...bundledNotices.map((name) => `licenses/${name}`)];

// Called after git archive of the pinned revision; never changes inference code
// or weights. Remove leftovers too when reusing an older staging directory.
export async function finalizePnLBundle(directory) {
  const license = await readFile(path.join(directory, 'LICENSE'), 'utf8');
  const readme = await readFile(path.join(directory, 'README.md'), 'utf8');
  if (!license.includes('SPDX-License-Identifier: GPL-2.0-or-later') || !readme.includes('CC BY 4.0')) {
    throw new Error('PnLCalib source is missing the verified licence clarification.');
  }
  for (const file of ['model/cls_hrnet.py', 'model/cls_hrnet_l.py']) {
    const source = await readFile(path.join(directory, file), 'utf8');
    if (!source.includes('Copyright (c) Microsoft') || !source.includes('Licensed under the MIT License.')) {
      throw new Error(`PnLCalib HRNet attribution is missing: ${file}`);
    }
  }
  const provenance = JSON.parse(await readFile(path.join(supplements, 'provenance.json'), 'utf8'));
  if (provenance.sourceCommit !== pnlcalibCommit) throw new Error('PnLCalib notice provenance is stale.');
  for (const file of provenance.files) {
    if (await sha256File(path.join(supplements, file.filename)) !== file.sha256) throw new Error(`PnLCalib notice checksum mismatch: ${file.filename}`);
  }
  for (const name of omittedDirectories) await rm(path.join(directory, name), { recursive: true, force: true });
  await mkdir(path.join(directory, 'licenses'), { recursive: true });
  for (const name of bundledNotices) await cp(path.join(supplements, name), path.join(directory, 'licenses', name));
  const hashes = {};
  for (const file of recordedFiles) hashes[file] = await sha256File(path.join(directory, file));
  await writeFile(path.join(directory, 'ANNOTATE-PROVENANCE.json'), JSON.stringify({
    sourceCommit: pnlcalibCommit, codeLicense: 'GPL-2.0-or-later', hrnetLicense: 'MIT', weightsLicense: 'CC-BY-4.0',
    omittedDirectories, hashes,
    note: 'Notice verification, not blanket distribution clearance. Weight checksums are verified separately by staging.',
  }, null, 2) + '\n');
}

// Old staged installers must not appear updated just because checkout docs are.
export async function inspectPnLBundle(directory) {
  try {
    const record = JSON.parse(await readFile(path.join(directory, 'ANNOTATE-PROVENANCE.json'), 'utf8'));
    if (record.sourceCommit !== pnlcalibCommit) return { noticesCurrent: false, reason: 'PnLCalib source pin is stale.' };
    for (const file of recordedFiles) {
      if (record.hashes?.[file] !== await sha256File(path.join(directory, file))) return { noticesCurrent: false, reason: `PnLCalib notice/source mismatch: ${file}` };
    }
    for (const name of omittedDirectories) {
      try { await access(path.join(directory, name)); return { noticesCurrent: false, reason: `PnLCalib still contains ${name}.` }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return { noticesCurrent: true, sourceCommit: record.sourceCommit };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return { noticesCurrent: false, reason: 'PnLCalib staging needs refreshed licence material.' };
    throw error;
  }
}

export async function collectPnLNotices(directory, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const status = await inspectPnLBundle(directory);
  // Keep actual staged evidence, including pre-clarification bundles, rather than
  // silently substituting current upstream notices for old package contents.
  for (const name of ['LICENSE', 'README.md', 'ANNOTATE-PROVENANCE.json', 'licenses']) {
    try { await cp(path.join(directory, name), path.join(destination, name), { recursive: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(path.join(destination, 'staging-status.json'), JSON.stringify(status, null, 2) + '\n');
  return status;
}
