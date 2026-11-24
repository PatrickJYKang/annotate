import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPnLNotices, finalizePnLBundle, inspectPnLBundle, pnlcalibCommit } from '../scripts/bundle-pnlcalib.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotate-pnl-notices-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['model', 'weights', 'sn_calibration', 'examples', 'figures']) await mkdir(path.join(directory, name));
  await writeFile(path.join(directory, 'LICENSE'), 'SPDX-License-Identifier: GPL-2.0-or-later');
  await writeFile(path.join(directory, 'README.md'), 'Weights: CC BY 4.0');
  const model = '# Copyright (c) Microsoft\n# Licensed under the MIT License.\ndef inference(): return 42\n';
  for (const name of ['cls_hrnet.py', 'cls_hrnet_l.py']) await writeFile(path.join(directory, 'model', name), model);
  await writeFile(path.join(directory, 'weights/SV_kp'), 'unchanged test weights');
  return { directory, model };
}

test('pins setup and desktop to the same licence-only revision', async () => {
  const setup = await readFile(fileURLToPath(new URL('../../scripts/setup-pnlcalib.sh', import.meta.url)), 'utf8');
  assert.ok(setup.includes(`PNLCALIB_COMMIT="${pnlcalibCommit}"`));
});

test('retains inference code and weights, adds full notices, removes unused evaluation assets', async (t) => {
  const { directory, model } = await fixture(t);
  await finalizePnLBundle(directory);
  assert.equal((await inspectPnLBundle(directory)).noticesCurrent, true);
  for (const name of ['cls_hrnet.py', 'cls_hrnet_l.py']) assert.equal(await readFile(path.join(directory, 'model', name), 'utf8'), model);
  assert.equal(await readFile(path.join(directory, 'weights/SV_kp'), 'utf8'), 'unchanged test weights');
  for (const name of ['sn_calibration', 'examples', 'figures']) await assert.rejects(access(path.join(directory, name)), { code: 'ENOENT' });
  assert.match(await readFile(path.join(directory, 'licenses/HRNet-MIT.txt'), 'utf8'), /Copyright \(c\) 2019 Microsoft Corporation/);
  assert.match(await readFile(path.join(directory, 'licenses/CC-BY-4.0.txt'), 'utf8'), /Attribution 4.0 International/);
  assert.match(await readFile(path.join(directory, 'licenses/ATTRIBUTION.md'), 'utf8'), /gutierrez4998149pnlcalib/);
});

test('rejects the old ambiguous licence and missing Microsoft headers before stripping files', async (t) => {
  const { directory } = await fixture(t);
  await writeFile(path.join(directory, 'LICENSE'), 'GNU GENERAL PUBLIC LICENSE Version 2');
  await assert.rejects(finalizePnLBundle(directory), /verified licence clarification/);
  await access(path.join(directory, 'sn_calibration'));
  await writeFile(path.join(directory, 'LICENSE'), 'SPDX-License-Identifier: GPL-2.0-or-later');
  await writeFile(path.join(directory, 'model/cls_hrnet.py'), 'def inference(): return 42');
  await assert.rejects(finalizePnLBundle(directory), /HRNet attribution is missing/);
});

test('evidence describes the actual staged bundle without making old installers appear updated', async (t) => {
  const { directory } = await fixture(t);
  const output = path.join(directory, 'collected');
  assert.equal((await collectPnLNotices(directory, output)).noticesCurrent, false);
  await assert.rejects(access(path.join(output, 'licenses/ATTRIBUTION.md')), { code: 'ENOENT' });
  await finalizePnLBundle(directory);
  assert.equal((await collectPnLNotices(directory, output)).noticesCurrent, true);
  await access(path.join(output, 'licenses/CC-BY-4.0.txt'));
  await writeFile(path.join(directory, 'licenses/HRNet-MIT.txt'), 'stale');
  assert.equal((await inspectPnLBundle(directory)).noticesCurrent, false);
  await finalizePnLBundle(directory);
  await mkdir(path.join(directory, 'sn_calibration'));
  assert.equal((await inspectPnLBundle(directory)).noticesCurrent, false);
  await finalizePnLBundle(directory);
  await rm(path.join(directory, 'licenses/CC-BY-4.0.txt'));
  assert.equal((await inspectPnLBundle(directory)).noticesCurrent, false);
});
