import { createHash } from 'node:crypto';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const name = (bytes, start, length) => bytes.subarray(start, start + length).toString('utf8').split('\0')[0];

// Read Mach-O metadata without loading the library. Wheel relocation changes
// install names/signatures; UUID plus instruction hashes identify the build,
// while the full file hash separately identifies our exact distributed copy.
export function machoEvidence(bytes) {
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf) throw new Error('Expected a thin little-endian 64-bit Mach-O file.');
  const count = bytes.readUInt32LE(16);
  const end = 32 + bytes.readUInt32LE(20);
  if (end > bytes.length || count > 4096) throw new Error('Invalid Mach-O command table.');
  const result = { sha256: digest(bytes), cpuType: bytes.readUInt32LE(4), uuid: null, installName: null, dependencies: [], instructions: [] };
  let offset = 32;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > end) throw new Error('Truncated Mach-O command.');
    const command = bytes.readUInt32LE(offset);
    const size = bytes.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > end) throw new Error('Invalid Mach-O command size.');
    if (command === 0x1b) {
      if (size !== 24 || result.uuid) throw new Error('Invalid Mach-O UUID.');
      result.uuid = bytes.subarray(offset + 8, offset + 24).toString('hex');
    }
    if ([0xd, 0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023].includes(command)) {
      if (size < 24) throw new Error('Truncated Mach-O dylib command.');
      const start = bytes.readUInt32LE(offset + 8);
      if (start < 24 || start >= size) throw new Error('Invalid Mach-O library name.');
      const library = name(bytes, offset + start, size - start);
      if (command === 0xd) result.installName = library;
      else result.dependencies.push(library);
    }
    if (command === 0x19) {
      if (size < 72) throw new Error('Truncated Mach-O segment.');
      const sections = bytes.readUInt32LE(offset + 64);
      if (72 + sections * 80 > size) throw new Error('Invalid Mach-O sections.');
      for (let section = offset + 72; section < offset + 72 + sections * 80; section += 80) {
        const flags = bytes.readUInt32LE(section + 64);
        if (!(flags & 0x80000400)) continue;
        const start = bytes.readUInt32LE(section + 48);
        const length = Number(bytes.readBigUInt64LE(section + 40));
        if (!Number.isSafeInteger(length) || start + length > bytes.length) throw new Error('Invalid Mach-O instruction range.');
        result.instructions.push({ segment: name(bytes, section + 16, 16), section: name(bytes, section, 16), size: length, sha256: digest(bytes.subarray(start, start + length)) });
      }
    }
    offset += size;
  }
  if (offset !== end) throw new Error('Mach-O command count mismatch.');
  return result;
}

export function sameMachOBuild(left, right) {
  return !!left.uuid && left.uuid === right.uuid && left.cpuType === right.cpuType
    && left.instructions.length > 0 && JSON.stringify(left.instructions) === JSON.stringify(right.instructions);
}
