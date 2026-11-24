import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cargoSourceInputs } from '../scripts/cargo-source-inputs.mjs';

const registry = 'registry+https://github.com/rust-lang/crates.io-index';
const fixture = `version = 3

[[package]]
name = "project"
version = "1.0.0"

[[package]]
name = "example"
version = "0.11.0+wasi-snapshot-preview1"
source = "${registry}"
checksum = "${'a'.repeat(64)}"
dependencies = ["project"]
`;
const parent = bytes => ({ name: 'opencv-cargo', sha256: createHash('sha256').update(bytes).digest('hex'), targets: ['darwin-arm64'] });

test('collects only exact checksummed registry sources, without resolving or executing anything', () => {
  const input = Buffer.from(fixture);
  const [crate] = cargoSourceInputs(input, parent(input));
  assert.equal(crate.kind, 'cargo-crate');
  assert.equal(crate.evidenceOnly, true);
  assert.equal(crate.collectNotices, true);
  assert.deepEqual(crate.targets, ['darwin-arm64']);
  assert.equal(crate.filename, `cargo-example-0.11.0_wasi-snapshot-preview1-${'a'.repeat(12)}.crate`);
  assert.match(crate.url, /0\.11\.0%2Bwasi-snapshot-preview1\.crate$/);
  assert.deepEqual(crate.cargoParent, { name: 'opencv-cargo', sha256: parent(input).sha256 });
  assert.equal(cargoSourceInputs(input, parent(input)).length, 1);
});

test('rejects altered locks, unpinned or non-registry sources and ambiguous identities', () => {
  assert.throws(() => cargoSourceInputs(Buffer.from(fixture + '# change'), parent(fixture)), /checksum mismatch/);
  for (const text of [
    fixture.replace(registry, 'git+https://example.test/unpinned'),
    fixture.replace(registry, ''),
    fixture.replace(`checksum = "${'a'.repeat(64)}"`, ''),
    fixture.replace('name = "example"', 'name = "../outside"'),
    fixture.replace('name = "example"', 'name = "example"\nname = "duplicate"'),
    fixture + fixture.slice(fixture.lastIndexOf('[[package]]')),
  ]) assert.throws(() => cargoSourceInputs(Buffer.from(text), parent(text)));
});

test('the expansion is tied to an archived lock, never the current upstream dependency graph', async () => {
  const pins = JSON.parse(await readFile(new URL('../compliance/sources.lock.json', import.meta.url)));
  const lock = pins.archives.find(item => item.name === 'opencv-macos-rav1e-cargo-lock');
  assert.equal(lock.expandCargoLock, true);
  assert.equal(lock.sha256, '4482976bfb7647d707f9a01fa1a3848366988f439924b5c8ac7ab085fba24240');
});
