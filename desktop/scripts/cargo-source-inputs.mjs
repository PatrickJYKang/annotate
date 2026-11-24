import { createHash } from 'node:crypto';

// Read only Cargo's locked package identities, never resolve versions or run
// build.rs. Reject unsupported registries/git sources instead of losing them.
export function cargoSourceInputs(bytes, parent) {
  if (createHash('sha256').update(bytes).digest('hex') !== parent.sha256) throw new Error('Cargo lock checksum mismatch.');
  const text = bytes.toString('utf8');
  if (!/^version = [234]\s*$/m.test(text)) throw new Error('Unsupported Cargo lock format.');
  const packages = text.split(/^\[\[package\]\]\s*$/m).slice(1);
  if (!packages.length) throw new Error('Cargo lock contains no packages.');
  const inputs = [];
  const identities = new Set();
  for (const block of packages) {
    const field = key => {
      const lines = block.split(/\r?\n/).filter(line => new RegExp(`^${key}\\s*=`).test(line));
      if (lines.length > 1) throw new Error(`Duplicate Cargo ${key}.`);
      if (!lines.length) return null;
      const match = new RegExp(`^${key} = "([^"\\\\]*)"\\s*(?:#.*)?$`).exec(lines[0]);
      if (!match) throw new Error(`Unsupported Cargo ${key}.`);
      return match[1];
    };
    const name = field('name');
    const version = field('version');
    const registry = field('source');
    if (!/^[a-zA-Z0-9][\w-]*$/.test(name ?? '') || !/^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(version ?? '')) throw new Error('Invalid Cargo package identity.');
    if (registry === null) {
      if (field('checksum') !== null) throw new Error('Cargo checksum without a source.');
      continue; // Workspace source is already in the parent archive.
    }
    if (registry !== 'registry+https://github.com/rust-lang/crates.io-index') throw new Error(`Uncollected Cargo source: ${registry}`);
    const sha256 = field('checksum');
    if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new Error(`Missing Cargo checksum: ${name}`);
    const identity = `${name}-${version.replaceAll('+', '_')}`;
    if (identities.has(identity)) throw new Error('Duplicate Cargo package identity.');
    identities.add(identity);
    inputs.push({ name: `${parent.name}-crate-${identity}`, version, kind: 'cargo-crate',
      filename: `cargo-${identity}-${sha256.slice(0, 12)}.crate`,
      url: `https://static.crates.io/crates/${name}/${name}-${encodeURIComponent(version)}.crate`, sha256,
      ...(parent.targets ? { targets: parent.targets } : {}), evidenceOnly: true, collectNotices: true,
      cargoParent: { name: parent.name, sha256: parent.sha256 },
      coverage: 'Exact checksummed source from the archived Cargo.lock. Includes all locked packages conservatively, not only the active target/features. No dependency resolution or build scripts are executed.' });
  }
  return inputs;
}
